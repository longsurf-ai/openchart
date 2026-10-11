// Purpose: Verify Squirrel events maintain Windows integration without starting application services.
import { beforeEach, expect, test, vi } from "vitest";
import { handleSquirrelStartup } from "./squirrel";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) };
});

beforeEach(() => {
  execute.mockReset().mockResolvedValue({ stdout: "", stderr: "" });
});

function fixture(platform: NodeJS.Platform = "win32") {
  return {
    app: {
      quit: vi.fn(),
      setAsDefaultProtocolClient: vi.fn(() => true),
      removeAsDefaultProtocolClient: vi.fn(() => true),
    },
    platform,
    executable:
      "C:\\Users\\Test User\\AppData\\Local\\OpenChart\\app-0.1.6\\OpenChart.exe",
  };
}

test.each(["--squirrel-install", "--squirrel-updated", "--squirrel-uninstall"])(
  "%s awaits shortcut changes and maintains the native protocol",
  async (event) => {
    const options = fixture();
    let done!: () => void;
    execute.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        done = resolve;
      }),
    );
    const pending = handleSquirrelStartup({
      ...options,
      argv: [options.executable, event, "0.1.6"],
    });
    expect(pending).toBeInstanceOf(Promise);
    const uninstall = event === "--squirrel-uninstall";
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      "C:\\Users\\Test User\\AppData\\Local\\OpenChart\\Update.exe",
      [uninstall ? "--removeShortcut" : "--createShortcut", "OpenChart.exe"],
      { windowsHide: true, timeout: 10_000 },
    );
    expect(options.app.quit).not.toHaveBeenCalled();
    if (uninstall) {
      expect(
        options.app.removeAsDefaultProtocolClient,
      ).toHaveBeenCalledExactlyOnceWith("openchart", options.executable);
      expect(options.app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    } else {
      expect(
        options.app.setAsDefaultProtocolClient,
      ).toHaveBeenCalledExactlyOnceWith("openchart", options.executable);
      expect(options.app.removeAsDefaultProtocolClient).not.toHaveBeenCalled();
    }
    done();
    await pending;
    expect(options.app.quit).toHaveBeenCalledOnce();
  },
);

test("obsolete versions quit without touching current registration or shortcuts", async () => {
  const options = fixture();
  await handleSquirrelStartup({
    ...options,
    argv: [options.executable, "--squirrel-obsolete"],
  });
  expect(options.app.quit).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(options.app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  expect(options.app.removeAsDefaultProtocolClient).not.toHaveBeenCalled();
});

test.each([
  ["win32", "--squirrel-firstrun"],
  ["win32", "--unknown"],
  ["darwin", "--squirrel-install"],
  ["linux", "--squirrel-uninstall"],
] as const)("%s %s continues ordinary startup", (platform, argument) => {
  const options = fixture(platform);
  expect(
    handleSquirrelStartup({ ...options, argv: [options.executable, argument] }),
  ).toBeUndefined();
  expect(execute).not.toHaveBeenCalled();
  expect(options.app.quit).not.toHaveBeenCalled();
});

test("installer failures are reported after ending the installer-only process", async () => {
  const options = fixture();
  execute.mockRejectedValueOnce(new Error("shortcut failed"));
  await expect(
    handleSquirrelStartup({
      ...options,
      argv: [options.executable, "--squirrel-install"],
    }),
  ).rejects.toThrow("shortcut failed");
  expect(options.app.quit).toHaveBeenCalledOnce();
});
