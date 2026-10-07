// Purpose: Verify Electron main never bypasses backend shutdown, resumes startup after Quit, or mishandles backend notifications.

import { temporaryHome } from "@openchart/server/home.test-utils";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test, vi } from "vitest";
import type { Notify } from "./host-protocol";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function host(
  configurationError?: Error,
  production = false,
  switches: readonly string[] = [],
  environment: {
    platform?: NodeJS.Platform;
    arch?: string;
    argv?: readonly string[];
    updateRoot?: string | null;
    earlyNotification?: boolean;
  } = {},
) {
  vi.resetModules();
  const runtimePlatform = environment.platform ?? "darwin";
  const runtimeArch = environment.arch ?? "arm64";
  vi.doMock("node:os", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:os")>()),
    platform: () => runtimePlatform,
    arch: () => runtimeArch,
  }));
  const previousArgv = process.argv;
  process.argv = ["OpenChart.exe", ...(environment.argv ?? [])];
  const resourcesPath = Object.getOwnPropertyDescriptor(
    process,
    "resourcesPath",
  );
  Object.defineProperty(process, "resourcesPath", {
    value: "/app/Contents/Resources",
    configurable: true,
  });
  vi.stubEnv("OPENCHART_DESKTOP_DEV_URL", "http://127.0.0.1:5173");
  vi.stubEnv(
    "OPENCHART_DESKTOP_BUILD",
    production ? "production" : "development",
  );
  vi.stubEnv(
    "OPENCHART_UPDATE_ROOT",
    environment.updateRoot === null
      ? undefined
      : (environment.updateRoot ?? "https://downloads.longsurf.ai/openchart"),
  );
  const signals = (["SIGINT", "SIGTERM"] as const).map((signal) => ({
    signal,
    listeners: process.listeners(signal),
  }));
  cleanup = () => {
    process.argv = previousArgv;
    if (resourcesPath)
      Object.defineProperty(process, "resourcesPath", resourcesPath);
    else Reflect.deleteProperty(process, "resourcesPath");
    for (const { signal, listeners } of signals)
      for (const listener of process.listeners(signal))
        if (!listeners.includes(listener))
          process.removeListener(signal, listener);
  };
  const key = deferred<Uint8Array>();
  const ready = deferred<number>();
  const stopped = deferred<void>();
  const stop = vi.fn(() => stopped.promise);
  const startBackend = vi.fn<
    (input: { onNotify: (notification: Notify) => void }) => {
      ready: Promise<number>;
      stop: () => Promise<void>;
    }
  >(() => ({ ready: ready.promise, stop }));
  const opened = vi.fn();
  const windows: Window[] = [];
  class Window extends EventEmitter {
    static getAllWindows() {
      return windows;
    }
    static fromWebContents(contents: unknown) {
      return windows.find((window) => window.webContents === contents) ?? null;
    }
    readonly webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      send: vi.fn(),
      mainFrame: { url: "http://127.0.0.1:5173/app" },
    });
    readonly loadURL = vi.fn(async () => {});
    readonly show = vi.fn();
    readonly isMinimized = vi.fn(() => true);
    readonly restore = vi.fn();
    readonly focus = vi.fn();
    constructor() {
      super();
      windows.push(this);
      opened();
    }
  }
  const notifications: SystemNotification[] = [];
  const notificationsSupported = vi.fn(() => true);
  const handleActivation = vi.fn<
    (callback: (details: unknown) => void) => void
  >((callback) => {
    if (environment.earlyNotification) callback({ type: "click" });
  });
  class SystemNotification extends EventEmitter {
    static isSupported = notificationsSupported;
    static handleActivation = handleActivation;
    readonly show = vi.fn();
    readonly options: unknown;
    constructor(options: unknown) {
      super();
      this.options = options;
      notifications.push(this);
    }
  }
  const home = temporaryHome();
  const app = Object.assign(new EventEmitter(), {
    commandLine: {
      getSwitchValue: () => home,
      hasSwitch: (name: string) => switches.includes(name),
    },
    isPackaged: true,
    setName: vi.fn(),
    setAppUserModelId: vi.fn(),
    setAsDefaultProtocolClient: vi.fn(() => true),
    removeAsDefaultProtocolClient: vi.fn(() => true),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: async () => {},
    getPath: () => "/profile",
    getAppPath: () => "/app",
    quit: vi.fn(),
    exit: vi.fn(),
  });
  const showErrorBox = vi.fn();
  const showMessageBox = vi.fn(async () => ({ response: 0 }));
  const quitAndInstall = vi.fn();
  const stopUpdates = vi.fn();
  const updateElectronApp = vi.fn<
    (options: unknown) => { stopUpdates: () => void }
  >(() => ({ stopUpdates }));
  vi.doMock("update-electron-app", () => ({
    updateElectronApp,
    UpdateSourceType: { StaticStorage: 1 },
  }));
  const showMessageBoxSync = vi.fn(() => 0);
  const showOpenDialog = vi.fn(async () => ({
    canceled: false,
    filePaths: ["/chosen/folder"],
  }));
  const handle = vi.fn();
  const setPermissionRequestHandler = vi.fn();
  const openPath = vi.fn(async () => "");
  const openExternal = vi.fn(async () => {});
  vi.doMock("electron", () => ({
    app,
    autoUpdater: { quitAndInstall },
    BrowserWindow: Window,
    dialog: {
      showErrorBox,
      showMessageBoxSync,
      showMessageBox,
      showOpenDialog,
    },
    ipcMain: { handle },
    net: {},
    Notification: SystemNotification,
    session: {
      defaultSession: {
        protocol: { handle: vi.fn() },
        setPermissionRequestHandler,
        setPermissionCheckHandler: vi.fn(),
      },
    },
    shell: { openPath, openExternal },
    protocol: { registerSchemesAsPrivileged: vi.fn() },
  }));
  vi.doMock("./credentials", () => ({ loadCredentialKey: () => key.promise }));
  const configureClerk = vi.fn(() => {
    if (configurationError) throw configurationError;
    return {
      publishableKey: "configured-test-key",
      origin: "https://test.clerk.accounts.dev",
      cleanup: vi.fn(),
    };
  });
  vi.doMock("./clerk", () => ({
    configureClerk,
    connectClerkSession: vi.fn(),
  }));
  const installer = deferred<{ stdout: string; stderr: string }>();
  const executeInstaller = vi.fn(() => installer.promise);
  vi.doMock("node:child_process", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:child_process")>()),
    execFile: Object.assign(vi.fn(), { [promisify.custom]: executeInstaller }),
  }));
  vi.doMock("./backend-process", () => ({ startBackend }));
  await import("./main");
  return {
    app,
    key,
    ready,
    stopped,
    stop,
    startBackend,
    opened,
    showErrorBox,
    showMessageBoxSync,
    windows,
    notifications,
    notificationsSupported,
    showOpenDialog,
    handle,
    setPermissionRequestHandler,
    openPath,
    openExternal,
    updateElectronApp,
    quitAndInstall,
    stopUpdates,
    showMessageBox,
    handleActivation,
    configureClerk,
    executeInstaller,
    installer,
  };
}

async function connection(switches: readonly string[]) {
  const runtime = await host(undefined, false, switches);
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
  const window = runtime.windows[0]!;
  const [, read] = runtime.handle.mock.calls.find(
    ([name]) => name === "desktop.connection",
  )!;
  return read({
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  });
}

test("the test-account switch makes development sign in the shared test user", async () => {
  expect(await connection(["openchart-test-account"])).toMatchObject({
    testAccount: "openchart-dev+clerk_test@longsurf.ai",
  });
});

test("development signs in normally without the test-account switch", async () => {
  expect((await connection([])).testAccount).toBeUndefined();
});

test("development packages never start automatic updates", async () => {
  const runtime = await host();
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
  expect(runtime.updateElectronApp).not.toHaveBeenCalled();
  expect(runtime.windows[0]!.loadURL).toHaveBeenCalledWith(
    "http://127.0.0.1:5173/app/dashboards/dsh_88JOx0yX7TH65p",
  );
  expect(runtime.startBackend).toHaveBeenCalledWith(
    expect.objectContaining({
      init: expect.objectContaining({
        documentationDirectory: join("/app/Contents/Resources", "docs"),
      }),
    }),
  );
});

test.each([
  ["darwin", "arm64"],
  ["darwin", "x64"],
  ["win32", "x64"],
] as const)(
  "%s-%s update restart respects cancellation and waits for backend exit",
  async (platform, arch) => {
    const runtime = await host(undefined, true, [], { platform, arch });
    runtime.key.resolve(new Uint8Array(32));
    runtime.ready.resolve(4321);
    await vi.waitFor(() =>
      expect(runtime.updateElectronApp).toHaveBeenCalledOnce(),
    );
    const options = runtime.updateElectronApp.mock.calls[0]![0] as unknown as {
      updateSource: { baseUrl: string };
      onNotifyUser: (info: { releaseName: string }) => void;
    };
    expect(options.updateSource.baseUrl).toBe(
      `https://downloads.longsurf.ai/openchart/${platform}/${arch}`,
    );
    const window = runtime.windows[0]!;
    // Release builds load the bundled app, not the development server.
    window.webContents.mainFrame.url = "openchart://app/app";
    const trusted = {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    };
    const channel = (name: string) =>
      runtime.handle.mock.calls.find(([candidate]) => candidate === name)![1];
    const readyUpdate = channel("desktop.updateReady");
    const restartToUpdate = channel("desktop.restartToUpdate");
    // Nothing can restart before a download finishes.
    expect(readyUpdate(trusted)).toBeNull();
    restartToUpdate(trusted);
    expect(runtime.app.quit).not.toHaveBeenCalled();
    options.onNotifyUser({
      releaseName: platform === "win32" ? "0.1.6" : "OpenChart 0.1.6",
    });
    expect(runtime.showMessageBox).not.toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
      "desktop.updateReady",
      "OpenChart 0.1.6",
    );
    // A page that loads later still learns about the waiting update.
    expect(readyUpdate(trusted)).toBe("OpenChart 0.1.6");
    expect(() => restartToUpdate({ ...trusted, senderFrame: null })).toThrow(
      "untrusted frame",
    );
    restartToUpdate(trusted);
    expect(runtime.app.quit).toHaveBeenCalledOnce();
    const event = { preventDefault: vi.fn() };
    runtime.app.emit("before-quit", event);
    window.webContents.emit("will-prevent-unload", event);
    expect(runtime.stop).not.toHaveBeenCalled();
    expect(runtime.quitAndInstall).not.toHaveBeenCalled();
    // Request again after cancellation; repeated Quit cannot bypass shutdown.
    restartToUpdate(trusted);
    expect(runtime.app.quit).toHaveBeenCalledTimes(2);
    runtime.windows.length = 0;
    runtime.app.emit("will-quit", event);
    runtime.app.emit("will-quit", event);
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(runtime.stopUpdates).toHaveBeenCalled();
    expect(runtime.quitAndInstall).not.toHaveBeenCalled();
    runtime.stopped.resolve();
    await vi.waitFor(() =>
      expect(runtime.quitAndInstall).toHaveBeenCalledOnce(),
    );
  },
);

test.each([
  { platform: "linux", arch: "x64" },
  { platform: "win32", arch: "arm64" },
  { platform: "darwin", arch: "x64", updateRoot: "" },
  { platform: "darwin", arch: "arm64", updateRoot: null },
  { platform: "win32", arch: "x64", argv: ["--squirrel-firstrun"] },
] as const)(
  "disables automatic updates for $platform-$arch with $updateRoot / $argv",
  async (environment) => {
    const runtime = await host(undefined, true, [], environment);
    runtime.key.resolve(new Uint8Array(32));
    runtime.ready.resolve(4321);
    await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
    expect(runtime.updateElectronApp).not.toHaveBeenCalled();
    expect(runtime.executeInstaller).not.toHaveBeenCalled();
  },
);

test.each(["--squirrel-install", "--squirrel-updated", "--squirrel-uninstall"])(
  "%s completes installer work without starting Clerk, backend or windows",
  async (event) => {
    const runtime = await host(undefined, true, [], {
      platform: "win32",
      arch: "x64",
      argv: [event, "0.1.6"],
    });
    expect(runtime.executeInstaller).toHaveBeenCalledOnce();
    expect(runtime.app.quit).not.toHaveBeenCalled();
    expect(runtime.app.requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(runtime.configureClerk).not.toHaveBeenCalled();
    expect(runtime.startBackend).not.toHaveBeenCalled();
    expect(runtime.opened).not.toHaveBeenCalled();
    expect(runtime.handleActivation).not.toHaveBeenCalled();
    runtime.installer.resolve({ stdout: "", stderr: "" });
    await vi.waitFor(() => expect(runtime.app.quit).toHaveBeenCalledOnce());
  },
);

test("an obsolete Windows package quits without initialization", async () => {
  const runtime = await host(undefined, true, [], {
    platform: "win32",
    argv: ["--squirrel-obsolete"],
  });
  expect(runtime.app.quit).toHaveBeenCalledOnce();
  expect(runtime.executeInstaller).not.toHaveBeenCalled();
  expect(runtime.configureClerk).not.toHaveBeenCalled();
  expect(runtime.startBackend).not.toHaveBeenCalled();
  expect(runtime.opened).not.toHaveBeenCalled();
});

test("Windows notification activation waits for readiness, survives dismissal, and respects shutdown", async () => {
  const runtime = await host(undefined, true, [], {
    platform: "win32",
    arch: "x64",
    earlyNotification: true,
  });
  expect(runtime.app.setAppUserModelId).toHaveBeenCalledExactlyOnceWith(
    "com.squirrel.OpenChart.OpenChart",
  );
  await vi.waitFor(() =>
    expect(runtime.handleActivation).toHaveBeenCalledOnce(),
  );
  expect(runtime.opened).not.toHaveBeenCalled();
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() =>
    expect(runtime.windows[0]?.focus).toHaveBeenCalledOnce(),
  );
  const activation = runtime.handleActivation.mock.calls[0]![0];
  const first = runtime.windows[0]!;
  const { onNotify } = runtime.startBackend.mock.calls[0]![0];
  onNotify({ type: "notify", title: "Alert", body: "Ready", sound: "system" });
  runtime.notifications[0]!.emit("close");
  activation({ type: "click" });
  expect(first.focus).toHaveBeenCalledTimes(2);
  // An instance event accompanies handleActivation; it must not focus twice.
  runtime.notifications[0]!.emit("click");
  expect(first.focus).toHaveBeenCalledTimes(2);
  runtime.windows.length = 0;
  activation({ type: "click" });
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledTimes(2));
  const reopened = runtime.windows[0]!;
  await vi.waitFor(() => expect(reopened.focus).toHaveBeenCalledOnce());
  runtime.app.emit("before-quit", { preventDefault: vi.fn() });
  activation({ type: "click" });
  expect(reopened.focus).toHaveBeenCalledOnce();
  runtime.windows.length = 0;
  activation({ type: "click" });
  expect(runtime.opened).toHaveBeenCalledTimes(2);
});

test("development startup failures exit visibly without a pre-ready native dialog", async () => {
  const failure = new Error("Native authentication bridge failed");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const runtime = await host(failure);
    expect(error).toHaveBeenCalledWith(failure);
    expect(runtime.app.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(runtime.showErrorBox).not.toHaveBeenCalled();
    expect(runtime.startBackend).not.toHaveBeenCalled();
    expect(runtime.opened).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});

test("native picker selects one directory, handles cancellation, and rejects untrusted frames", async () => {
  const runtime = await host();
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
  const pick = runtime.handle.mock.calls.find(
    ([channel]) => channel === "desktop.pickDirectory",
  )![1];
  const window = runtime.windows[0]!;
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  await expect(pick(event)).resolves.toBe("/chosen/folder");
  expect(runtime.showOpenDialog).toHaveBeenCalledWith(
    window,
    expect.objectContaining({
      properties: ["openDirectory"],
    }),
  );
  runtime.showOpenDialog.mockResolvedValueOnce({
    canceled: true,
    filePaths: [],
  });
  await expect(pick(event)).resolves.toBeNull();
  runtime.showOpenDialog.mockClear();
  await expect(pick({ ...event, senderFrame: null })).rejects.toThrow(
    "untrusted frame",
  );
  await expect(
    pick({ ...event, senderFrame: { url: event.senderFrame.url } }),
  ).rejects.toThrow("untrusted frame");
  window.webContents.mainFrame.url = "https://untrusted.example/app";
  await expect(pick(event)).rejects.toThrow("untrusted frame");
  expect(runtime.showOpenDialog).not.toHaveBeenCalled();
});

test("native file open validates local paths and the calling frame, and propagates OS failures", async () => {
  const runtime = await host();
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
  const open = runtime.handle.mock.calls.find(
    ([channel]) => channel === "desktop.openPath",
  )![1];
  const window = runtime.windows[0]!;
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  await expect(open(event, "/other/€ note.pdf")).resolves.toBeUndefined();
  expect(runtime.openPath).toHaveBeenCalledExactlyOnceWith("/other/€ note.pdf");
  runtime.openPath.mockResolvedValueOnce("File not found");
  await expect(open(event, "/other/missing.pdf")).rejects.toThrow(
    "File not found",
  );
  runtime.openPath.mockClear();
  for (const path of [
    null,
    42,
    "",
    "relative.pdf",
    "file:///other/note.pdf",
    "https://example.com",
    "//remote/file.pdf",
    "\\\\remote\\file.pdf",
    "/\\remote\\file.pdf",
    "/other/bad\0.pdf",
  ])
    await expect(open(event, path)).rejects.toThrow();
  await expect(
    open({ ...event, senderFrame: null }, "/other/note.pdf"),
  ).rejects.toThrow("untrusted frame");
  await expect(
    open(
      { ...event, senderFrame: { url: event.senderFrame.url } },
      "/other/note.pdf",
    ),
  ).rejects.toThrow("untrusted frame");
  window.webContents.mainFrame.url = "https://untrusted.example/app";
  await expect(open(event, "/other/note.pdf")).rejects.toThrow(
    "untrusted frame",
  );
  expect(runtime.openPath).not.toHaveBeenCalled();
});

test("pages may write to the clipboard and get no other permission", async () => {
  const runtime = await host();
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
  const [decide] = runtime.setPermissionRequestHandler.mock.calls[0]!;
  const granted = (permission: string) => {
    const callback = vi.fn();
    decide({}, permission, callback);
    return callback.mock.calls[0]![0];
  };
  expect(granted("clipboard-sanitized-write")).toBe(true);
  expect(granted("clipboard-read")).toBe(false);
  expect(granted("media")).toBe(false);
});

test("a backend notification is shown and its click brings the window forward", async () => {
  const runtime = await host();
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
  const { onNotify } = runtime.startBackend.mock.calls[0]![0];
  onNotify({
    type: "notify",
    title: "BTC breakout",
    body: "exceeded 70000",
    sound: "glass",
  });
  expect(runtime.notifications).toHaveLength(1);
  const notification = runtime.notifications[0]!;
  // The protocol tag stays out of what Electron is asked to display.
  expect(notification.options).toEqual({
    title: "BTC breakout",
    body: "exceeded 70000",
    silent: false,
    sound: "openchart-glass.wav",
  });
  expect(notification.show).toHaveBeenCalledOnce();
  const window = runtime.windows[0]!;
  expect(window.focus).not.toHaveBeenCalled();
  notification.emit("click");
  expect(window.restore).toHaveBeenCalledOnce();
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.focus).toHaveBeenCalledOnce();
  // restore() would un-maximize a window that is not minimized.
  window.isMinimized.mockReturnValue(false);
  notification.emit("click");
  expect(window.restore).toHaveBeenCalledOnce();
  expect(window.focus).toHaveBeenCalledTimes(2);
  // A click after the user closed the window must not throw.
  runtime.windows.length = 0;
  onNotify({ type: "notify", title: "ETH breakout", body: "", sound: "none" });
  expect(runtime.notifications[1]!.options).toMatchObject({ silent: true });
  expect(() => runtime.notifications[1]!.emit("click")).not.toThrow();
  runtime.notificationsSupported.mockReturnValue(false);
  onNotify({ type: "notify", title: "Unsupported", body: "", sound: "system" });
  expect(runtime.notifications).toHaveLength(2);
});

test("turning notifications on shows one so macOS can ask, only for the app's own page", async () => {
  const runtime = await host();
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
  const enable = runtime.handle.mock.calls.find(
    ([channel]) => channel === "desktop.enableNotifications",
  )![1];
  const window = runtime.windows[0]!;
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  enable(event);
  expect(runtime.notifications).toHaveLength(1);
  expect(runtime.notifications[0]!.options).toEqual({
    title: "Notifications are on",
    body: "OpenChart will notify you here when your alerts fire.",
    silent: false,
  });
  expect(runtime.notifications[0]!.show).toHaveBeenCalledOnce();
  expect(() => enable({ ...event, senderFrame: null })).toThrow(
    "untrusted frame",
  );
  expect(runtime.notifications).toHaveLength(1);
});

test("Quit during credential loading never starts a backend or window", async () => {
  const runtime = await host();
  const event = { preventDefault: vi.fn() };
  runtime.app.emit("before-quit", event);
  runtime.key.resolve(new Uint8Array(32));
  await vi.waitFor(() => expect(runtime.app.quit).toHaveBeenCalledOnce());
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(runtime.startBackend).not.toHaveBeenCalled();
  expect(runtime.opened).not.toHaveBeenCalled();
  expect(runtime.showErrorBox).not.toHaveBeenCalled();
});

test.each([false, true])(
  "repeated Quit waits for stop and prevents windows (already ready: %s)",
  async (alreadyReady) => {
    const runtime = await host();
    runtime.key.resolve(new Uint8Array(32));
    await vi.waitFor(() => expect(runtime.startBackend).toHaveBeenCalledOnce());
    if (alreadyReady) {
      runtime.ready.resolve(4321);
      await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
    }
    const event = { preventDefault: vi.fn() };
    runtime.app.emit("before-quit", event);
    runtime.app.emit("before-quit", event);
    if (alreadyReady) {
      expect(runtime.stop).not.toHaveBeenCalled();
      runtime.windows.length = 0;
      runtime.app.emit("will-quit", event);
      runtime.app.emit("will-quit", event);
    }
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(runtime.app.quit).not.toHaveBeenCalled();
    runtime.ready.resolve(4321);
    await runtime.ready.promise;
    runtime.app.emit("activate");
    expect(runtime.opened).toHaveBeenCalledTimes(alreadyReady ? 1 : 0);
    expect(runtime.app.quit).not.toHaveBeenCalled();
    runtime.stopped.resolve();
    await vi.waitFor(() => expect(runtime.app.quit).toHaveBeenCalledOnce());
    expect(runtime.app.listenerCount("before-quit")).toBe(0);
    expect(runtime.showErrorBox).not.toHaveBeenCalled();
  },
);

test("canceling an unsaved editor's close keeps the backend available for saving", async () => {
  const runtime = await host();
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
  runtime.app.emit("before-quit", { preventDefault: vi.fn() });
  const event = { preventDefault: vi.fn() };
  runtime.windows[0]!.webContents.emit("will-prevent-unload", event);
  expect(runtime.showMessageBoxSync).toHaveBeenCalledOnce();
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(runtime.stop).not.toHaveBeenCalled();
  runtime.showMessageBoxSync.mockReturnValue(1);
  runtime.windows[0]!.webContents.emit("will-prevent-unload", event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
});

test("billing IPC validates the caller and destination, and passes the sandbox endpoint to backend", async () => {
  const runtime = await host();
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
  expect(runtime.startBackend).toHaveBeenCalledWith(
    expect.objectContaining({
      init: expect.objectContaining({
        billingUrl: "https://ysufdj6lyh.execute-api.us-west-2.amazonaws.com",
        openchartUrl: "https://api.sandbox.longsurf.ai",
      }),
    }),
  );
  const [, openBilling] = runtime.handle.mock.calls.find(
    ([channel]) => channel === "desktop.openBilling",
  )!;
  const window = runtime.windows[0]!;
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  await openBilling(event, "https://checkout.stripe.com/c/pay/cs_test_fixture");
  expect(runtime.openExternal).toHaveBeenCalledOnce();
  await expect(openBilling(event, "https://attacker.test/")).rejects.toThrow();
  await expect(
    openBilling(
      { ...event, senderFrame: { url: "https://attacker.test/" } },
      "https://billing.stripe.com/p/session/test_fixture",
    ),
  ).rejects.toThrow("untrusted frame");
  expect(runtime.openExternal).toHaveBeenCalledOnce();
});

test("billing returns during startup open subscription once and later returns focus the existing window", async () => {
  const runtime = await host();
  const event = { preventDefault: vi.fn() };
  runtime.app.emit("open-url", event, "openchart-dev://billing/return");
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(runtime.opened).not.toHaveBeenCalled();
  runtime.key.resolve(new Uint8Array(32));
  runtime.ready.resolve(4321);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledOnce());
  const window = runtime.windows[0]!;
  expect(window.loadURL).toHaveBeenCalledWith(
    "http://127.0.0.1:5173/app/settings/subscription",
  );
  runtime.app.emit("open-url", event, "openchart-dev://billing/return");
  expect(window.webContents.send).toHaveBeenCalledWith("desktop.billingReturn");
  const count = window.webContents.send.mock.calls.length;
  runtime.app.emit("open-url", event, "openchart://billing/return");
  runtime.app.emit(
    "open-url",
    event,
    "openchart-dev://billing/return?paid=true",
  );
  expect(window.webContents.send).toHaveBeenCalledTimes(count);
  expect(runtime.opened).toHaveBeenCalledOnce();
  runtime.windows.length = 0;
  runtime.app.emit("second-instance", {}, [
    "app",
    "openchart-dev://billing/return",
  ]);
  await vi.waitFor(() => expect(runtime.opened).toHaveBeenCalledTimes(2));
  expect(runtime.windows[0]!.loadURL).toHaveBeenCalledWith(
    "http://127.0.0.1:5173/app/settings/subscription",
  );
});
