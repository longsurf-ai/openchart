// Purpose: Start the backend, open app windows, and stop the backend when the app quits.

import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { arch, platform } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  Notification,
  session,
  shell,
  protocol,
} from "electron";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import { notificationSounds } from "@openchart/notification";
import { z } from "zod";

import { origin, resolveAsset } from "./assets";
import { startBackend, type Backend } from "./backend-process";
import { loadCredentialKey } from "./credentials";
import { configureClerk, connectClerkSession } from "./clerk";
import type { Notify } from "./host-protocol";
import { prepareOnboardingContent } from "./onboarding/content/content";
import { BillingLink, isBillingReturn } from "./billing";
import { cloudEndpoints, developmentTestAccount } from "./cloud";
import { updateFeedUrl } from "./targets";
import { handleSquirrelStartup, windowsAppId } from "./squirrel";

const hostPlatform = platform();
const hostArch = arch();

// The name determines the app's data folder and macOS Keychain entry.
// Give development runs their own name to keep their data separate.
// tooling replaces this flag at build time; release bundles cannot enable Vite.
const developmentBuild =
  !app.isPackaged || process.env.OPENCHART_DESKTOP_BUILD === "development";
/** Report command-line failures directly; packaged launches show an error after ready. */
function fail(cause: unknown): void {
  console.error(cause);
  if (developmentBuild) {
    app.exit(1);
    return;
  }
  void app.whenReady().then(() => {
    dialog.showErrorBox("OpenChart could not start", String(cause));
    app.exit(1);
  });
}

// Register protocols before ready, while catching synchronous configuration errors too.
function start(): void {
  app.setName(developmentBuild ? "OpenChart Development" : "OpenChart");
  if (hostPlatform === "win32" && !developmentBuild)
    app.setAppUserModelId(windowsAppId);
  const clerk = configureClerk(
    developmentBuild ? "openchart-dev" : "openchart",
  );

  // openchart://app addresses the files shipped with the app.
  // Register it before Electron is ready so these pages can use browser features.
  if (developmentBuild)
    protocol.registerSchemesAsPrivileged([
      {
        scheme: "openchart",
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          allowServiceWorkers: true,
          stream: true,
        },
      },
    ]);

  // Development loads Vite's local server; an installed app loads bundled files.
  const development = developmentBuild && process.env.OPENCHART_DESKTOP_DEV_URL;
  const address = new URL(development || origin);
  if (
    development &&
    (address.protocol !== "http:" || address.hostname !== "127.0.0.1")
  )
    throw new Error("Desktop development requires an HTTP loopback URL");

  /** Returns the address without its page path, including for openchart:// URLs. */
  function originOf(url: URL): string {
    return `${url.protocol}//${url.host}`;
  }
  const rendererOrigin = originOf(address);

  // All windows share this backend and its database.
  let backend: Backend | undefined;
  let quitting = false;
  let stopping = false;
  let installUpdateOnQuit = false;
  let updates: ReturnType<typeof updateElectronApp> | undefined;
  /** The downloaded release waiting for a restart, e.g. "OpenChart 0.1.6". */
  let readyUpdate: string | undefined;
  let hostReady = false;
  let notificationActivationPending = false;
  let billingReturnPending = process.argv.some((value) =>
    isBillingReturn(value, developmentBuild),
  );

  async function returnFromBilling(): Promise<void> {
    billingReturnPending = true;
    if (!hostReady || quitting) return;
    let window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      await createWindow("/app/settings/subscription");
      window = BrowserWindow.getAllWindows()[0];
    }
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send("desktop.billingReturn");
  }
  app.on("open-url", (event, value) => {
    if (!isBillingReturn(value, developmentBuild)) return;
    event.preventDefault();
    void returnFromBilling().catch(fail);
  });
  app.on("second-instance", (_event, argv) => {
    if (argv.some((value) => isBillingReturn(value, developmentBuild)))
      void returnFromBilling().catch(fail);
  });

  /** Offers a fresh app start after the backend exits; saved data stays on disk. */
  async function backendExited(code: number): Promise<void> {
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: "OpenChart stopped",
      message: `The OpenChart backend exited unexpectedly (${code}).`,
      buttons: ["Relaunch", "Quit"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) app.relaunch();
    app.exit(1);
  }

  // Electron withdraws a notification once its object is garbage collected.
  const notifications = new Set<Notification>();

  /** Notification activations may arrive before the backend or after a window closes. */
  async function activateNotification(): Promise<void> {
    notificationActivationPending = true;
    if (!hostReady || quitting) return;
    notificationActivationPending = false;
    let window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      await createWindow();
      window = BrowserWindow.getAllWindows()[0];
    }
    if (!window || quitting) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** Shows what the backend asked for; a click brings the open window forward. */
  function showNotification({ title, body, sound }: Notify): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title,
      body,
      silent: sound === "none",
      // macOS reads custom sounds from the app's Resources, outside ASAR.
      // Other platforms retain their system sound; Electron's sound option is macOS-only.
      ...(hostPlatform === "darwin"
        ? { sound: notificationSounds.find((item) => item.id === sound)?.file }
        : {}),
    });
    notifications.add(notification);
    const release = () => notifications.delete(notification);
    notification.on("close", release);
    notification.on("failed", (_event, error) => {
      release();
      console.error("Notification failed", error);
    });
    notification.on("click", () => {
      release();
      // Windows also invokes the activation handler; process the click once.
      if (hostPlatform !== "win32") void activateNotification().catch(fail);
    });
    notification.show();
  }

  /** Opens web links in the user's browser. */
  function openExternal(value: string): void {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:")
      void shell.openExternal(url.href).catch(console.error);
  }

  /** Opens the shared app in a window; closing it leaves saved data intact. */
  async function createWindow(path = "/app"): Promise<void> {
    if (quitting) return;
    const window = new BrowserWindow({
      title: "OpenChart",
      width: 1280,
      height: 840,
      minWidth: 800,
      minHeight: 600,
      show: false,
      // Let the page fill the top of the Mac window, keeping Apple's three buttons.
      titleBarStyle: hostPlatform === "darwin" ? "hiddenInset" : "default",
      trafficLightPosition:
        hostPlatform === "darwin" ? { x: 20, y: 23 } : undefined,
      webPreferences: {
        // Expose the connection and folder picker without letting page scripts
        // read files or run programs directly.
        preload: join(import.meta.dirname, "../preload/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });
    window.on("page-title-updated", (event) => event.preventDefault());
    window.webContents.on("will-prevent-unload", (event) => {
      const discard = dialog.showMessageBoxSync(window, {
        type: "warning",
        message: "Discard unsaved file changes?",
        detail: "Return to the editor to save your files before leaving.",
        buttons: ["Keep editing", "Discard changes"],
        defaultId: 0,
        cancelId: 0,
      });
      if (discard === 1) event.preventDefault();
      else {
        quitting = false;
        installUpdateOnQuit = false;
      }
    });
    // Open external links in the browser, keeping this window on our app pages.
    window.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event) => {
      const target = new URL(event.url);
      if (target.protocol === address.protocol && target.host === address.host)
        return;
      event.preventDefault();
      openExternal(event.url);
    });
    // Show the window once it can draw, avoiding a blank window during loading.
    window.once("ready-to-show", () => window.show());
    await window.loadURL(new URL(path, address).href);
  }

  // On macOS, closing the last window leaves the app running in the Dock.
  app.on("window-all-closed", () => {
    if (hostPlatform !== "darwin") app.quit();
  });

  function stopBeforeQuit(event: Electron.Event): void {
    // Wait for the backend to exit before allowing Electron to quit.
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    quitting = true;
    updates?.stopUpdates();
    clerk.cleanup();
    void Promise.resolve(backend?.stop()).then(() => {
      // The backend has exited; let the next Quit request close Electron.
      app.removeListener("before-quit", beforeQuit);
      app.removeListener("will-quit", stopBeforeQuit);
      if (installUpdateOnQuit) autoUpdater.quitAndInstall();
      else app.quit();
    }, fail);
  }
  function beforeQuit(event: Electron.Event): void {
    quitting = true;
    // Open editors must get their beforeunload decision while saving is still available.
    if (BrowserWindow.getAllWindows().length === 0) stopBeforeQuit(event);
  }
  app.on("before-quit", beforeQuit);
  app.on("will-quit", stopBeforeQuit);
  // Stopping the development command should follow the same cleanup path.
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => app.quit());

  // Allow one running app per data folder so two backends cannot share its database.
  if (app.requestSingleInstanceLock())
    void app
      // Electron must be ready before we use windows or OS-protected storage.
      .whenReady()
      .then(async () => {
        if (hostPlatform === "win32")
          Notification.handleActivation(() => {
            void activateNotification().catch(fail);
          });
        connectClerkSession(clerk.origin, rendererOrigin);
        // App pages may write to the clipboard, which Copy buttons need. They
        // get no camera, microphone, or other device permissions.
        session.defaultSession.setPermissionRequestHandler(
          (_contents, permission, callback) =>
            callback(permission === "clipboard-sanitized-write"),
        );
        session.defaultSession.setPermissionCheckHandler(() => false);
        // Browser/Clerk storage stays in userData; application files share home.
        const home = resolve(
          app.commandLine.getSwitchValue("openchart-home") ||
            join(
              app.getPath("home"),
              developmentBuild ? ".openchart-dev" : ".openchart",
            ),
        );
        await mkdir(home, { recursive: true });
        const key = await loadCredentialKey(join(home, "credential.key"));
        if (quitting) return;
        const onboarding = await prepareOnboardingContent(home);
        if (quitting) return;
        // A fresh secret lets the backend reject requests from other local programs.
        const token = randomBytes(32).toString("base64url");
        // Start the database and application services in a separate process.
        backend = startBackend({
          modulePath: join(import.meta.dirname, "backend.js"),
          init: {
            type: "init",
            token,
            credentialKey: Buffer.from(key).toString("base64"),
            home,
            documentationDirectory: join(process.resourcesPath, "docs"),
            rendererOrigin,
            ...cloudEndpoints[developmentBuild ? "development" : "production"],
          },
          onExit: (code) => void backendExited(code),
          onNotify: showNotification,
        });
        // Wait until the backend can answer requests before opening a window.
        const port = await backend.ready;
        if (quitting) return;
        // Electron userData isolates browser storage; this identity survives backend port changes.
        const connection = {
          origin: `http://127.0.0.1:${port}`,
          token,
          profileID: "desktop",
          publishableKey: clerk.publishableKey,
          // Development-only: `--openchart-test-account` signs in the shared test user.
          testAccount:
            developmentBuild &&
            app.commandLine.hasSwitch("openchart-test-account")
              ? developmentTestAccount
              : undefined,
          initialLocalStorage: onboarding?.localStorage,
        };
        function assertTrustedFrame(event: Electron.IpcMainInvokeEvent): void {
          const frame = event.senderFrame;
          // Answer only our window's own page, not embedded pages or other sites.
          if (
            !frame ||
            frame !== event.sender.mainFrame ||
            originOf(new URL(frame.url)) !== rendererOrigin
          )
            throw new Error("Desktop operation refused for an untrusted frame");
        }
        // The preload script asks for this address and secret on the page's behalf.
        ipcMain.handle("desktop.connection", (event) => {
          assertTrustedFrame(event);
          return connection;
        });
        ipcMain.handle("desktop.pickDirectory", async (event) => {
          assertTrustedFrame(event);
          const window = BrowserWindow.fromWebContents(event.sender);
          if (!window)
            throw new Error("Directory picker requires an app window");
          const result = await dialog.showOpenDialog(window, {
            title: "Create workspace",
            message: "Choose a folder to open as a workspace.",
            buttonLabel: "Open folder",
            properties: ["openDirectory"],
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        });
        ipcMain.handle("desktop.openPath", async (event, input: unknown) => {
          assertTrustedFrame(event);
          const path = z
            .string()
            .refine(
              (value) =>
                isAbsolute(value) &&
                !/^[\\/]{2}/.test(value) &&
                !value.includes("\0"),
              "Expected an absolute local path",
            )
            .parse(input);
          const error = await shell.openPath(path);
          if (error) throw new Error(error);
        });
        ipcMain.handle("desktop.openBilling", async (event, input: unknown) => {
          assertTrustedFrame(event);
          await shell.openExternal(BillingLink.parse(input));
        });
        // Preserve early returns until the renderer has subscribed after bootstrap.
        ipcMain.handle("desktop.billingReturn", (event) => {
          assertTrustedFrame(event);
          const pending = billingReturnPending;
          billingReturnPending = false;
          return pending;
        });
        // Pages loaded after the download ask here; open pages also receive a message.
        ipcMain.handle("desktop.updateReady", (event) => {
          assertTrustedFrame(event);
          return readyUpdate ?? null;
        });
        ipcMain.handle("desktop.restartToUpdate", (event) => {
          assertTrustedFrame(event);
          if (!readyUpdate || quitting) return;
          // Normal Quit resolves unsaved editors and stops the backend first.
          installUpdateOnQuit = true;
          app.quit();
        });
        // Electron has no permission request; macOS asks when the app first notifies.
        ipcMain.handle("desktop.enableNotifications", (event) => {
          assertTrustedFrame(event);
          showNotification({
            type: "notify",
            title: "Notifications are on",
            body: "OpenChart will notify you here when your alerts fire.",
            sound: "system",
          });
        });
        if (!development) {
          // Serve packaged pages from disk when the browser asks for openchart://app.
          const directory = join(app.getAppPath(), "renderer");
          session.defaultSession.protocol.handle(
            new URL(origin).protocol.slice(0, -1),
            async (request) => {
              const file = await resolveAsset(directory, request);
              if (!file) return new Response("Not found", { status: 404 });
              const response = await net.fetch(pathToFileURL(file).href);
              const headers = new Headers(response.headers);
              // Limit the page to bundled files and connections to our local backend.
              headers.set(
                "Content-Security-Policy",
                "default-src 'self'; " +
                  `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' ${clerk.origin} https://challenges.cloudflare.com; ` +
                  "style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://img.clerk.com; media-src 'self' blob: data:; font-src 'self' data:; " +
                  `connect-src 'self' blob: http://127.0.0.1:${port} ws://127.0.0.1:${port} ${clerk.origin}; ` +
                  "worker-src 'self' blob:; " +
                  "object-src 'none'; frame-src 'self' https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'",
              );
              headers.set("X-Content-Type-Options", "nosniff");
              return new Response(
                request.method === "HEAD" ? null : response.body,
                {
                  status: response.status,
                  headers,
                },
              );
            },
          );
        }
        // Reopen the window when the user clicks the Dock icon after closing it.
        app.on("activate", () => {
          if (BrowserWindow.getAllWindows().length === 0)
            void createWindow().catch(fail);
        });
        // The backend and page access rules are ready; load the first window.
        await createWindow(
          billingReturnPending
            ? "/app/settings/subscription"
            : onboarding?.path,
        );
        hostReady = true;
        if (billingReturnPending) await returnFromBilling();
        if (notificationActivationPending) await activateNotification();
        const updateUrl = developmentBuild
          ? undefined
          : updateFeedUrl(
              process.env.OPENCHART_UPDATE_ROOT,
              hostPlatform,
              hostArch,
            );
        if (
          !developmentBuild &&
          updateUrl &&
          !process.argv.includes("--squirrel-firstrun") &&
          !quitting
        ) {
          updates = updateElectronApp({
            updateSource: {
              type: UpdateSourceType.StaticStorage,
              baseUrl: updateUrl,
            },
            updateInterval: "1 hour",
            // The sidebar offers the restart instead of an interrupting dialog.
            // Mac installs on quit; Windows applies updates during download.
            onNotifyUser: ({ releaseName }) => {
              updates?.stopUpdates();
              readyUpdate =
                hostPlatform === "win32" &&
                /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(releaseName)
                  ? `OpenChart ${releaseName}`
                  : releaseName;
              for (const window of BrowserWindow.getAllWindows())
                window.webContents.send("desktop.updateReady", readyUpdate);
            },
          });
        }
      })
      .catch((cause: unknown) => {
        if (!quitting) fail(cause);
      });
  else app.quit();
}

try {
  const installer = handleSquirrelStartup({
    app,
    platform: hostPlatform,
    argv: process.argv,
    executable: process.execPath,
  });
  if (installer)
    void installer.catch((cause: unknown) => {
      console.error(cause);
      app.exit(1);
    });
  else start();
} catch (cause) {
  fail(cause);
}
