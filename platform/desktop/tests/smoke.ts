// Purpose: Verify the packaged app hosts its backend, persists chats, and preserves renderer isolation.
import { CLAUDE_CODE, CODEX } from "@openchart/models/model-tiers";

import { createInstallations } from "@openchart/server/models/onboarding/installation";
import { PROVIDER_MANIFEST } from "@openchart/server/models/onboarding/manifest";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
} from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  _electron,
  expect as playwrightExpect,
  type ElectronApplication,
  type Page,
  type Request,
} from "@playwright/test";
import { writeNativeExecutable } from "./native-executable.ts";

// Packaged UI readiness includes backend I/O and may run under emulation.
// Keep assertions bounded consistently with page actions; native waits stay separate.
const expect = playwrightExpect.configure({ timeout: 30_000 });

const sourceExecutable = process.argv[2];
assert(
  sourceExecutable && isAbsolute(sourceExecutable),
  "Supply an absolute Electron executable path",
);
const buildHost = `${process.platform}-${process.arch}`;
// Select managed fixture identities from the supplied executable. Reading the
// single Mach-O slice and Windows PE header never executes application code
// and does not depend on Electron's RunAsNode fuse.
let runtime: { platform: string; arch: string };
if (process.platform === "darwin") {
  const { stdout } = await promisify(execFile)(
    "/usr/bin/lipo",
    ["-archs", sourceExecutable],
    { timeout: 10_000 },
  );
  const architectures = stdout.trim().split(/\s+/);
  assert.equal(
    architectures.length,
    1,
    "Smoke requires one supported Mac architecture",
  );
  const arch = architectures[0] === "x86_64" ? "x64" : architectures[0];
  assert(
    arch === "arm64" || arch === "x64",
    "Unsupported Mac executable architecture",
  );
  runtime = { platform: "darwin", arch };
} else if (process.platform === "win32") {
  const file = await open(sourceExecutable, "r");
  try {
    const header = Buffer.alloc(64);
    const dos = await file.read(header, 0, header.length, 0);
    assert.equal(dos.bytesRead, 64, "Truncated Windows executable header");
    assert.equal(
      header.toString("ascii", 0, 2),
      "MZ",
      "Expected a Windows executable",
    );
    const signature = Buffer.alloc(6);
    const pe = await file.read(
      signature,
      0,
      signature.length,
      header.readUInt32LE(60),
    );
    assert.equal(pe.bytesRead, 6, "Truncated Windows PE signature");
    assert.equal(
      signature.readUInt32LE(0),
      0x4550,
      "Expected a Windows PE signature",
    );
    assert.equal(
      signature.readUInt16LE(4),
      0x8664,
      "Smoke requires a Windows x64 executable",
    );
    runtime = { platform: "win32", arch: "x64" };
  } finally {
    await file.close();
  }
} else throw new Error("Desktop release smoke supports macOS and Windows");
assert.equal(
  runtime.platform,
  process.platform,
  "Smoke requires the executable's native operating system",
);
assert.equal(
  typeof runtime.arch,
  "string",
  "Electron did not report its architecture",
);
const runtimeTarget = `${runtime.platform}-${runtime.arch}`;
const environment = process.argv[3] ?? "production";
assert(environment === "development" || environment === "production");
const keychain = process.argv[4] ?? "mock";
assert(keychain === "mock" || keychain === "system");
const development = environment === "development";
const artifacts = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  ".artifacts",
);
await mkdir(artifacts, { recursive: true });
// Relocate the whole package outside the checkout so omitted runtime files
// cannot resolve through the repository's ancestor node_modules directories.
const profile = await realpath(
  await mkdtemp(join(tmpdir(), "openchart-desktop-smoke-")),
);
const sourceBundle =
  runtime.platform === "darwin"
    ? dirname(dirname(dirname(sourceExecutable)))
    : dirname(sourceExecutable);
const bundle = join(profile, basename(sourceBundle));
const executable = join(bundle, relative(sourceBundle, sourceExecutable));
const home = join(profile, "home");
const userData = join(profile, "browser");
const errors: string[] = [];
const processErrors: string[] = [];
let application: ElectronApplication | undefined;
let passed = false;
let packagedConpty: boolean | null = null;
const nativeState = join(profile, "native-state");
const nativeBin = join(profile, "bin");

/** Completes the real first-launch pages and tour before entering a new chat. */
async function verifyOnboarding(page: Page) {
  const agents = page.getByRole("dialog", {
    name: "Connect your agent",
    exact: true,
  });
  await expect(agents).toBeVisible({ timeout: 30_000 });
  for (const name of ["Claude Code", "Codex", "Antigravity"])
    await expect(
      agents.getByRole("region", { name, exact: true }),
    ).toBeVisible();
  await page.screenshot({
    path: join(artifacts, "desktop-onboarding-agents.png"),
  });
  await agents
    .getByRole("button", { name: /^(Continue|Skip for now)$/ })
    .click();
  const notifications = page.getByRole("dialog", {
    name: "Turn on notifications",
    exact: true,
  });
  await expect(notifications).toBeVisible();
  await notifications
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  const dashboard = "/app/dashboards/dsh_88JOx0yX7TH65p";
  const steps = [
    ["Watch the market from your dashboard", dashboard],
    ["Make the chart yours", dashboard],
    ["Ask the Agent for an indicator", dashboard],
    ["All your agents, in one place", "/app/sessions/ses_rrbFx6CsSf2Xk8"],
    ["Alerts put agents to work", "/app/alerts/rules/alr_88PH5QdFSkCg4R"],
    ["Star us on GitHub", dashboard],
  ] as const;
  for (const [index, [name, route]] of steps.entries()) {
    const card = page.getByRole("dialog", { name, exact: true });
    await expect(card).toBeVisible();
    await expect(card).toContainText(`${index + 1} of ${steps.length}`);
    await expect(page).toHaveURL(`openchart://app${route}`);
    await card
      .getByRole("button", {
        name: index === steps.length - 1 ? "Done" : "Next",
        exact: true,
      })
      .click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^New Chat/ }).click();
  await expect(page).toHaveURL("openchart://app/app");
  return { agentPage: true, notificationPage: true, tourSteps: steps.length };
}

/** Exercises Settings through the renderer, including native CLI setup and model requests. */
async function verifySettings(page: Page) {
  const filename = join(home, "settings.json");
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(filename, "utf8")).appearance?.theme,
    )
    .toBe("dark");
  await page.getByRole("link", { name: "Data Providers", exact: true }).click();
  const binance = page.getByRole("switch", {
    name: "Enable Binance",
    exact: true,
  });
  await expect(binance).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Enable Yahoo Finance", exact: true }),
  ).toBeChecked();
  await binance.click();
  await expect(binance).not.toBeChecked();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(filename, "utf8")).providers?.binance
          ?.enabled,
    )
    .toBe(false);

  const applicationDirectory = await application!.evaluate(({ app }) =>
    app.getAppPath(),
  );
  const siblingReady = application!.waitForEvent("window");
  await application!.evaluate(
    ({ BrowserWindow }, preload) => {
      const sibling = new BrowserWindow({
        show: true,
        webPreferences: {
          preload,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      void sibling.loadURL("openchart://app/app");
    },
    join(applicationDirectory, "preload/preload.cjs"),
  );
  const sibling = await siblingReady;
  sibling.on("pageerror", (cause) => errors.push(cause.message));
  sibling.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await sibling.goto("openchart://app/app/settings/providers");
    await expect(
      sibling.getByRole("switch", { name: "Enable Binance", exact: true }),
    ).not.toBeChecked();
    await binance.click();
    await expect(
      sibling.getByRole("switch", { name: "Enable Binance", exact: true }),
    ).toBeChecked();
    const saved = JSON.parse(await readFile(filename, "utf8"));
    saved.appearance.theme = "light";
    saved.providers.yfinance = { enabled: false };
    const replacement = join(home, "settings.next.json");
    await writeFile(replacement, JSON.stringify(saved));
    await rename(replacement, filename);
    await expect(page.locator("html")).toHaveClass(/light/);
    await expect(sibling.locator("html")).toHaveClass(/light/);
    await expect(
      page.getByRole("switch", { name: "Enable Yahoo Finance", exact: true }),
    ).not.toBeChecked();
    await expect(
      sibling.getByRole("switch", {
        name: "Enable Yahoo Finance",
        exact: true,
      }),
    ).not.toBeChecked();
  } catch (cause) {
    await writeFile(
      join(artifacts, "desktop-sibling-failure.txt"),
      `${sibling.url()}\n${await sibling.content()}`,
    );
    throw cause;
  } finally {
    await sibling.close();
  }

  await page.getByRole("link", { name: "Models", exact: true }).click();
  for (const name of ["Codex", "Claude Code"]) {
    await expect(page.getByRole("switch", { name, exact: true })).toHaveCount(
      0,
    );
  }
  await page
    .getByRole("button", { name: "Check again", exact: true })
    .first()
    .click();
  await page
    .getByRole("region", { name: "Codex", exact: true })
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Authorization code for Codex" })
    .fill("smoke-code");
  await page
    .getByRole("region", { name: "Codex", exact: true })
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Codex", exact: true })
      .getByText("Ready", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Codex", exact: true }),
  ).toBeChecked();
  await expect(
    page
      .getByRole("region", { name: "Codex", exact: true })
      .getByText("1 models available", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Default model", exact: true })
    .click();
  await page
    .getByRole("menuitem", {
      name: "codex / smoke-model",
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(filename, "utf8")).models?.defaultModel
          ?.modelID,
    )
    .toBe("tier1");
  await page.screenshot({
    path: join(artifacts, "desktop-model-settings.png"),
  });
  await page.goto("openchart://app/app");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Reply with CONFIG_NATIVE_OK.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page
      .locator('[data-aui-quote-selectable=""]')
      .getByText("CONFIG_NATIVE_OK", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop generating" }),
  ).toHaveCount(0);
  assert(
    (await readFile(join(nativeState, "requests"), "utf8")).includes("chat"),
  );
  const sessionId = new URL(page.url()).pathname.split("/").at(-1);
  // Auto-title can finish after the reply; resolve the active row at click time.
  await page
    .locator('[data-sidebar="menu-item"]')
    .filter({
      has: page.locator('[data-sidebar="menu-button"][aria-current="page"]'),
    })
    .getByRole("button", { name: /^Options for / })
    .click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const sessionTitle = "Native provider smoke";
  await page
    .getByRole("textbox", { name: "Chat name", exact: true })
    .fill(sessionTitle);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert(sessionId && sessionTitle);
  await page.screenshot({
    path: join(artifacts, "desktop-configured-chat.png"),
  });
  const workspaceRoot = join(home, "workspaces/default");
  assert.deepEqual((await readdir(workspaceRoot)).sort(), [
    "indicators",
    "studies",
    "workflows",
  ]);
  await writeFile(
    join(workspaceRoot, "workspace-smoke.workflow.ts"),
    `
import { defineWorkflow, Schema, agent, textPrompt } from "@openchart/workflow";
export default defineWorkflow({
  description: "Smoke a workspace-authored child agent",
  args: Schema.Struct({ question: Schema.String }),
  run: ({ question }, { parentPrompt }) => agent(textPrompt("SDK_CHILD:" + question, parentPrompt.model, parentPrompt.agent)),
});`,
  );
  await page.getByRole("button", { name: /^New Chat/ }).click();
  await expect(page).not.toHaveURL(`openchart://app/app/sessions/${sessionId}`);
  await expect(
    page.getByRole("heading", { name: "Where should we begin?" }),
  ).toBeVisible();
  const composer = page.getByRole("textbox", {
    name: "Message",
    exact: true,
  });
  await composer.fill("@workspace-smoke");
  await expect(
    page.getByRole("option", { name: /workspace-smoke.workflow.ts/ }),
  ).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toContainText("workspace-smoke.workflow.ts");
  await composer.press("End");
  await composer.pressSequentially(
    " WORKSPACE_RUN: execute this workflow for NVDA.",
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("main").getByText("WORKSPACE_WORKFLOW_OK", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Stop generating" }),
  ).toHaveCount(0);
  const nativeCalls = (await readFile(join(nativeState, "requests"), "utf8"))
    .trim()
    .split("\n");
  const workflowCalls = nativeCalls.filter(
    (call) => call === "workflow",
  ).length;
  const workflowChildren = nativeCalls.filter(
    (call) => call === "child",
  ).length;
  assert.equal(workflowCalls, 1);
  assert.equal(workflowChildren, 1);
  assert.deepEqual((await readdir(workspaceRoot)).sort(), [
    "indicators",
    "studies",
    "workflows",
    "workspace-smoke.workflow.ts",
  ]);
  await page.screenshot({
    path: join(artifacts, "desktop-workspace-workflow.png"),
  });
  return {
    sessionId,
    sessionTitle,
    crossWindow: true,
    externalReplacement: true,
    nativeCalls,
    nativeSetup: true,
    workspaceWorkflow: {
      workflowCalls,
      workflowChildren,
      workspaceFiles: await readdir(workspaceRoot),
    },
  };
}

/** Exercises normal Quit, observes backend exit, and then releases Electron. */
async function quit() {
  // Closing the server aborts the renderer's live SSE request by design.
  for (const page of application!.windows()) page.removeAllListeners("console");
  const stopped = await application!.evaluate(({ app }) => {
    const backend = app
      .getAppMetrics()
      .find((metric) => metric.name === "OpenChart Backend");
    if (!backend) throw new Error("Packaged backend process is missing");
    return new Promise<{ pid: number; elapsed: number }>((resolve, reject) => {
      const start = Date.now();
      let poll: ReturnType<typeof setInterval> | undefined;
      const timeout = setTimeout(() => {
        clearInterval(poll);
        reject(new Error("Backend did not exit during Quit"));
      }, 10_000);
      app.on("child-process-gone", (_event, details) => {
        if (
          details.name === "OpenChart Backend" &&
          details.reason !== "clean-exit"
        )
          reject(new Error(`Backend exited abnormally: ${details.reason}`));
      });
      // Hold only the final main-process exit until Playwright reads the result.
      app.on("will-quit", function onQuit(event) {
        // Main prevents the first event while it waits for backend cleanup.
        if (event.defaultPrevented) return;
        app.removeListener("will-quit", onQuit);
        event.preventDefault();
        // macOS process reaping can trail Electron's exit event. Observe the OS,
        // not the cached process metrics, while still enforcing the Quit budget.
        poll = setInterval(() => {
          try {
            process.kill(backend.pid, 0);
          } catch (cause) {
            clearInterval(poll);
            clearTimeout(timeout);
            if (
              cause instanceof Error &&
              "code" in cause &&
              cause.code === "ESRCH"
            )
              resolve({ pid: backend.pid, elapsed: Date.now() - start });
            else reject(cause);
          }
        }, 10);
      });
      app.quit();
    });
  });
  assert(stopped.elapsed < 5_000, "Backend exceeded the graceful Quit budget");
  await application!.close();
  application = undefined;
  assert.throws(() => process.kill(stopped.pid, 0), { code: "ESRCH" });
  return stopped;
}

/** Starts only the supplied package and observes renderer runtime errors. */
async function launch(): Promise<Page> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  delete env.OPENCHART_DESKTOP_DEV_URL;
  env.PATH = `${nativeBin}${delimiter}${env.PATH ?? ""}`;
  env.OPENCHART_SMOKE_STATE = nativeState;
  application = await _electron.launch({
    executablePath: executable,
    cwd: profile,
    args: [
      `--user-data-dir=${userData}`,
      `--openchart-home=${home}`,
      ...(runtime.platform === "darwin" && keychain === "mock"
        ? ["--use-mock-keychain"]
        : []),
    ],
    // Only release builds must ignore a supplied development URL.
    env: development
      ? env
      : { ...env, OPENCHART_DESKTOP_DEV_URL: "https://untrusted.test" },
    timeout: 30_000,
  });
  application.process().stdout?.on("data", (chunk: Buffer) => {
    processErrors.push(chunk.toString());
  });
  application.process().stderr?.on("data", (chunk: Buffer) => {
    processErrors.push(chunk.toString());
  });
  assert(await application.evaluate(({ app }) => app.isPackaged));
  assert.deepEqual(
    await application.evaluate(() => ({
      platform: process.platform,
      arch: process.arch,
    })),
    runtime,
    "Launched Electron must match the executable used to seed native providers",
  );
  const appPath = await application.evaluate(({ app }) => app.getAppPath());
  assert.equal(
    appPath,
    join(
      bundle,
      runtime.platform === "darwin" ? "Contents/Resources" : "resources",
      "app.asar",
    ),
  );
  if (runtime.platform === "win32") {
    // Resolve from the relocated ASAR inside the real Electron main process:
    // this verifies node-pty's native addon, DLL and worker packaging together.
    packagedConpty = await application.evaluate(({ app }) => {
      const { createRequire } = process.getBuiltinModule("node:module");
      const { join } = process.getBuiltinModule("node:path");
      const require = createRequire(join(app.getAppPath(), "package.json"));
      const pty = require("node-pty") as typeof import("node-pty");
      return new Promise<boolean>((resolve, reject) => {
        const terminal = pty.spawn(
          join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"),
          ["/d", "/c", "echo OPENCHART_PTY_READY"],
          {
            name: "xterm-color",
            cols: 80,
            rows: 24,
            cwd: app.getPath("temp"),
            useConpty: true,
          },
        );
        let output = "";
        let settled = false;
        const finish = (cause?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          data.dispose();
          exit.dispose();
          if (cause) {
            try {
              terminal.kill();
            } catch {
              // An already exited terminal needs no further cleanup.
            }
            reject(cause);
          } else resolve(true);
        };
        const timeout = setTimeout(() => {
          finish(
            new Error(
              `Packaged ConPTY did not exit within 10 seconds: ${output}`,
            ),
          );
        }, 10_000);
        const data = terminal.onData((chunk) => {
          output = (output + chunk).slice(-4096);
        });
        const exit = terminal.onExit(({ exitCode }) => {
          finish(
            exitCode === 0 && output.includes("OPENCHART_PTY_READY")
              ? undefined
              : new Error(`Packaged ConPTY failed (${exitCode}): ${output}`),
          );
        });
      });
    });
    assert.equal(packagedConpty, true);
  }
  assert.equal(
    await application.evaluate(({ app }) => app.getName()),
    development ? "OpenChart Development" : "OpenChart",
  );
  const page = await application.firstWindow();
  page.setDefaultTimeout(15_000);
  assert.equal(
    await application.evaluate(({ app }) => app.getPath("userData")),
    userData,
  );
  assert((await readFile(join(home, "openchart.sqlite3"))).byteLength > 0);
  assert((await readFile(join(home, "credential.key"))).byteLength > 0);
  await assert.rejects(readFile(join(userData, "openchart.sqlite3")), {
    code: "ENOENT",
  });
  page.on("pageerror", (cause) => errors.push(cause.stack ?? cause.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 600));
  });
  page.setDefaultTimeout(30_000);
  await expect(page).toHaveURL(/^openchart:\/\/app\//);
  return page;
}

/** Checks Mac header spacing and clicks its controls with the sidebar open and closed. */
async function verifyMacHeader(page: Page, route: "chat" | "settings") {
  if (runtime.platform !== "darwin") return;
  const header = page.locator(".jan-chat-header");
  const sidebarHeader = page.locator(
    '[data-sidebar="header"] > div:first-child',
  );
  const sidebar = page.locator('[data-side="left"][data-state]');
  await expect(header).toHaveCSS("app-region", "drag");
  await expect(sidebarHeader).toHaveCSS("app-region", "drag");
  const collapse = sidebarHeader.getByRole("button", {
    name: "Toggle Sidebar",
  });
  await expect(collapse).toHaveCSS("app-region", "no-drag");
  const expanded = await collapse.boundingBox();
  assert(
    expanded && expanded.x >= 88,
    "Sidebar control overlaps native buttons",
  );
  await collapse.click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect.poll(async () => (await header.boundingBox())?.x).toBe(0);
  const expand = header.getByRole("button", { name: "Toggle Sidebar" });
  await expect(expand).toHaveCSS("app-region", "no-drag");
  const collapsed = await header.getByRole("button").first().boundingBox();
  assert(
    collapsed && collapsed.x >= 88,
    "Header control overlaps native buttons",
  );
  await page.screenshot({
    path: join(artifacts, `desktop-${route}-collapsed.png`),
  });
  await expand.click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect(collapse).toBeVisible();
  return { expandedControlX: expanded.x, collapsedControlX: collapsed.x };
}

try {
  await cp(sourceBundle, bundle, { recursive: true, verbatimSymlinks: true });
  await mkdir(home, { recursive: true });
  await mkdir(nativeState, { recursive: true });
  await mkdir(nativeBin, { recursive: true });
  await writeFile(
    join(nativeState, "version"),
    PROVIDER_MANIFEST[CODEX][runtimeTarget]!.version,
  );
  const fixture = await readFile(
    new URL("./native-cli-fixture.cjs", import.meta.url),
    "utf8",
  );
  const executableSuffix = runtime.platform === "win32" ? ".exe" : "";
  await writeNativeExecutable(
    join(nativeBin, `codex${executableSuffix}`),
    fixture,
  );
  // Claude remains explicitly signed out; no real native account is used.
  await writeNativeExecutable(
    join(nativeBin, `claude${executableSuffix}`),
    `console.log(process.argv.includes("--version") ? "${PROVIDER_MANIFEST[CLAUDE_CODE][runtimeTarget]!.version} (Claude Code)" : JSON.stringify({loggedIn: false}));`,
  );
  // Seed completed managed fixtures before startup reconciliation can download real CLIs.
  const installations = createInstallations(
    join(home, "model-providers"),
    PROVIDER_MANIFEST,
    runtimeTarget,
  );
  for (const [providerID, filename] of [
    [CODEX, "codex"],
    [CLAUDE_CODE, "claude"],
  ] as const) {
    const target = installations.executables[providerID];
    const artifact = PROVIDER_MANIFEST[providerID][runtimeTarget]!;
    const root = target.slice(0, -artifact.executable.length);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(nativeBin, `${filename}${executableSuffix}`), target);
    await writeFile(join(root, ".installed"), basename(root));
    assert(await installations.installed(providerID));
  }
  await writeFile(join(home, "settings.json"), JSON.stringify({}));
  let page = await launch();
  const onboarding = await verifyOnboarding(page);

  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  // Observe the app's normal discovery request; no prompt or market query is sent.
  // Only completed requests started by the new document qualify. React can
  // cancel discovery during mount; old-document responses have stale CDP handles.
  const models = page
    .waitForEvent("framenavigated", {
      predicate: (frame) => frame === page.mainFrame(),
    })
    .then(async () => {
      const requests = new Set<Request>();
      const remember = (request: Request) => {
        if (new URL(request.url()).pathname === "/trpc/models.list")
          requests.add(request);
      };
      page.on("request", remember);
      try {
        const request = await page.waitForEvent("requestfinished", {
          predicate: (request) => requests.has(request),
        });
        const response = await request.response();
        assert(response, "Packaged model discovery did not receive a response");
        return { status: response.status(), body: await response.json() };
      } finally {
        page.off("request", remember);
      }
    });
  await page.reload();
  const modelResponse = await models;
  assert.equal(modelResponse.status, 200);
  assert(Array.isArray(modelResponse.body.result.data));
  await expect(
    page.getByRole("dialog", { name: "Connect your agent", exact: true }),
  ).toHaveCount(0);
  const windowButtons =
    runtime.platform === "darwin"
      ? await application!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.getWindowButtonPosition(),
        )
      : undefined;
  if (runtime.platform === "darwin")
    assert.deepEqual(windowButtons, { x: 20, y: 23 });
  const chatHeader = await verifyMacHeader(page, "chat");

  const transports = await page.evaluate(async () => {
    const { origin, token } = await (
      window as unknown as {
        desktop: { connection(): Promise<{ origin: string; token: string }> };
      }
    ).desktop.connection();
    const response = await fetch(`${origin}/trpc/events.subscribe`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !response.body)
      throw new Error("Packaged SSE connection failed");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let frames = "";
    try {
      while (!frames.includes('"kind":"ready"')) {
        const { done, value } = await reader.read();
        if (done) throw new Error("Packaged SSE closed before ready");
        frames += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
    const hose = await new Promise<unknown>((resolve, reject) => {
      const socket = new WebSocket(
        `${origin.replace(/^http/, "ws")}/hose?token=${encodeURIComponent(token)}`,
      );
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Packaged Hose did not answer"));
      }, 10_000);
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            type: "open",
            id: "smoke",
            body: { type: "smoke.unknown" },
          }),
        );
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Packaged Hose connection failed"));
      };
      socket.onmessage = (event) => {
        clearTimeout(timeout);
        socket.close();
        resolve(JSON.parse(event.data));
      };
    });
    return { sseReady: true, hose };
  });
  assert.deepEqual(transports, {
    sseReady: true,
    hose: {
      type: "error",
      id: "smoke",
      code: "not_found",
    },
  });

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  const settingsHeader = await verifyMacHeader(page, "settings");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("menuitem", { name: "Dark", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Theme", exact: true }),
  ).toHaveText("Dark");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Theme", exact: true }),
  ).toHaveText("Dark");
  await page.screenshot({ path: join(artifacts, "desktop-settings.png") });
  const settings = await verifySettings(page);
  await page.goto("openchart://app/app");
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: join(artifacts, "desktop-chat.png") });
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();

  // New Chat opens a fresh draft; the earlier chat remains navigable.
  await page.getByRole("button", { name: /^New Chat/ }).click();
  await expect(page).toHaveURL("openchart://app/app");
  const session = settings.sessionId;
  const thread = page.getByRole("button", {
    name: settings.sessionTitle,
    exact: true,
  });
  await expect(thread).toBeVisible();
  await thread.click();
  await expect(page).toHaveURL(`openchart://app/app/sessions/${session}`);

  const isolation = await application!.evaluate(({ app, BrowserWindow }) => {
    const pid = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId();
    return app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed;
  });
  // Electron exposes OS sandbox status on macOS and Windows.
  assert.equal(isolation, true);
  assert.deepEqual(
    await page.evaluate("({require: typeof require, process: typeof process})"),
    {
      require: "undefined",
      process: "undefined",
    },
  );

  const boundary = await application!.evaluate(async ({ net }) => {
    const missing = await net.fetch("openchart://app/assets/missing.js");
    const escape = await net.fetch("openchart://app/..%2fpackage.json");
    const mockWorker = await net.fetch("openchart://app/mockServiceWorker.js");
    const document = await net.fetch("openchart://app/app", {
      headers: { accept: "text/html" },
    });
    return {
      missing: missing.status,
      escape: escape.status,
      mockWorker: mockWorker.status,
      csp: document.headers.get("content-security-policy"),
    };
  });
  assert.equal(boundary.missing, 404);
  assert.equal(boundary.escape, 404);
  assert.equal(boundary.mockWorker, 404);
  assert(boundary.csp?.includes("script-src 'self'"));
  assert.match(boundary.csp ?? "", /connect-src [^;]*http:\/\/127\.0\.0\.1:/);

  await page.evaluate(() => window.open("about:blank"));
  assert.equal(
    await application!.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
    1,
  );
  assert.deepEqual(errors, []);
  const stopped = await quit();

  page = await launch();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: settings.sessionTitle, exact: true })
    .click();
  await expect(page).toHaveURL(`openchart://app/app/sessions/${session}`);
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Data Providers", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Enable Yahoo Finance", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Codex", exact: true })
      .getByText("1 models available", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);

  const result = {
    executable: sourceExecutable,
    runtimeTarget,
    buildHost,
    keychain,
    relocatedBundle: bundle,
    packagedConpty,
    onboarding,
    titlebar: { windowButtons, chatHeader, settingsHeader },
    isolation,
    boundary,
    session,
    transports,
    stopped,
    settings,
    tests:
      "first-launch agent and notification pages, starter tour, chat shell, settings, native window buttons, draggable headers, clickable header controls, sidebar collapse/expand spacing, theme persistence, no mock worker, models, SSE ready, Hose protocol, hosted backend, new chat, reload, graceful backend exit, restart with persisted chat, renderer isolation",
  };
  await writeFile(
    join(artifacts, "smoke-result.json"),
    JSON.stringify(result, null, 2),
  );
  passed = true;
  console.log("Electron smoke passed:", result);
} catch (cause) {
  console.error("Renderer errors:", errors);
  await writeFile(
    join(artifacts, "desktop-process-failure.txt"),
    processErrors.join(""),
  );
  const page = application?.windows()[0];
  if (page) {
    // The packaged fixture owns this synthetic conversation. Open failed tool
    // details before capturing so CI reports the actual workflow diagnostic.
    try {
      const failedWorkflows = page.getByRole("button", {
        name: /^Failed: workflow/,
      });
      for (const button of await failedWorkflows.all())
        if ((await button.getAttribute("aria-expanded")) === "false")
          await button.click({ timeout: 3_000 });
      const detail = (
        await page.getByRole("main").innerText({ timeout: 3_000 })
      ).slice(-16_000);
      console.error("Packaged smoke main content:\n", detail);
      await writeFile(join(artifacts, "desktop-main-failure.txt"), detail);
    } catch (diagnosticError) {
      console.error(
        "Could not capture failed workflow details",
        diagnosticError,
      );
    }
    await Promise.allSettled([
      page.screenshot({ path: join(artifacts, "desktop-failure.png") }),
      page
        .locator("body")
        .innerText()
        .then((text) =>
          writeFile(join(artifacts, "desktop-failure.txt"), text),
        ),
    ]);
  }
  throw cause;
} finally {
  await application?.close();
  if (passed) await rm(profile, { recursive: true, force: true });
  else console.error("Smoke failure profile:", profile);
}
