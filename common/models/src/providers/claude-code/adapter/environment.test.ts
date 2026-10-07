// Purpose: Preserve native Windows process environment names without widening POSIX inheritance.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, vi } from "vitest";

const { platform } = vi.hoisted(() => ({ platform: vi.fn() }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  platform,
}));

async function environment(
  host: NodeJS.Platform,
  inherited: NodeJS.ProcessEnv,
  overrides: Record<string, string> = {},
) {
  platform.mockReturnValue(host);
  vi.resetModules();
  const { claudeEnvironment } = await import("./environment");
  const original = process.env;
  try {
    // Only the synchronous construction reads this fixture. Restore the real
    // environment before assertions, awaits, or any subprocess can observe it.
    process.env = inherited;
    return claudeEnvironment(overrides);
  } finally {
    process.env = original;
  }
}

test("Windows inherits mixed-case process paths needed by the CLI and its children", async () => {
  expect(
    await environment("win32", {
      Path: "C:\\Windows\\System32;C:\\Tools",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      UserProfile: "C:\\Users\\Test User",
      AppData: "C:\\Users\\Test User\\AppData\\Roaming",
      LocalAppData: "C:\\Users\\Test User\\AppData\\Local",
      TEMP: "C:\\Users\\Test User\\AppData\\Local\\Temp",
      UNRELATED_SECRET: "excluded",
    }),
  ).toEqual({
    PATH: "C:\\Windows\\System32;C:\\Tools",
    SYSTEMROOT: "C:\\Windows",
    COMSPEC: "C:\\Windows\\System32\\cmd.exe",
    USERPROFILE: "C:\\Users\\Test User",
    APPDATA: "C:\\Users\\Test User\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\Test User\\AppData\\Local",
    TEMP: "C:\\Users\\Test User\\AppData\\Local\\Temp",
  });
});

test("Windows matches named configuration and provider credentials case-insensitively", async () => {
  expect(
    await environment("win32", {
      Claude_Config_Dir: "C:\\Claude",
      Https_Proxy: "https://proxy.example",
      http_proxy: "http://proxy.example",
      Node_Extra_Ca_Certs: "C:\\certs\\root.pem",
      Anthropic_Api_Key: "fixture-token",
      aws_profile: "fixture-profile",
      Google_Cloud_Project: "fixture-project",
      CLAUDE_EXPORTED_FUNCTION: "() { echo excluded; }",
      UNRELATED_SECRET: "excluded",
    }),
  ).toEqual({
    CLAUDE_CONFIG_DIR: "C:\\Claude",
    HTTPS_PROXY: "https://proxy.example",
    HTTP_PROXY: "http://proxy.example",
    NODE_EXTRA_CA_CERTS: "C:\\certs\\root.pem",
    ANTHROPIC_API_KEY: "fixture-token",
    AWS_PROFILE: "fixture-profile",
    GOOGLE_CLOUD_PROJECT: "fixture-project",
  });
});

test("the sanitized Windows names reach a real child process", async () => {
  const env = await environment(
    "win32",
    {
      Path: process.env.PATH ?? process.env.Path ?? "",
      SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
      ComSpec: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
    },
    { MCP_TOOL_TIMEOUT: "7200000" },
  );
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify({ PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, COMSPEC: process.env.COMSPEC, MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT }))",
    ],
    { env, windowsHide: true, timeout: 5_000 },
  );
  expect(JSON.parse(stdout)).toEqual(env);
});

test("Windows emits one key per variable, honoring native alias order and explicit overrides", async () => {
  const inherited = {
    Path: "mixed",
    PATH: "uppercase",
    path: "lower",
    SystemRoot: "C:\\Windows",
  };
  expect(await environment("win32", inherited)).toEqual({
    PATH: "uppercase",
    SYSTEMROOT: "C:\\Windows",
  });
  expect(
    await environment("win32", inherited, {
      Path: "explicit",
      mcp_tool_timeout: "7200000",
    }),
  ).toEqual({
    PATH: "explicit",
    SYSTEMROOT: "C:\\Windows",
    MCP_TOOL_TIMEOUT: "7200000",
  });
  expect(
    await environment("win32", inherited, {
      Path: "mixed override",
      PATH: "uppercase override",
    }),
  ).toEqual({
    PATH: "uppercase override",
    SYSTEMROOT: "C:\\Windows",
  });
});

test.each(["darwin", "linux"] as const)(
  "%s retains case-sensitive filtering and overrides",
  async (host) => {
    expect(
      await environment(
        host,
        {
          HOME: "/home/test",
          PATH: "/usr/bin",
          Path: "excluded",
          SystemRoot: "excluded",
          ComSpec: "excluded",
          ANTHROPIC_API_KEY: "fixture-token",
          anthropic_api_key: "excluded",
          Claude_Config_Dir: "excluded",
          HTTP_PROXY: "http://upper.example",
          http_proxy: "http://lower.example",
          CLAUDE_EXPORTED_FUNCTION: "() { echo excluded; }",
        },
        { Path: "explicit", MCP_TOOL_TIMEOUT: "7200000" },
      ),
    ).toEqual({
      HOME: "/home/test",
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "fixture-token",
      HTTP_PROXY: "http://upper.example",
      http_proxy: "http://lower.example",
      Path: "explicit",
      MCP_TOOL_TIMEOUT: "7200000",
    });
  },
);
