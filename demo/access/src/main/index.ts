// Purpose: Own the access demo's Electron window, lifecycle, and renderer isolation.

import { join, resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClerkBridge } from "@clerk/electron";
import { z } from "zod";
import {
  app,
  BrowserWindow,
  dialog,
  session,
  net,
  protocol,
  ipcMain,
  shell,
} from "electron";
import { BillingLink, isBillingReturn } from "./billing";
import { startRuntime, type DemoRuntime } from "./runtime";

// safeStorage's macOS Keychain item is named after the app, not userData.
// Bare Electron tests/development must not share the packaged app's item.
app.setName(
  app.isPackaged
    ? "OpenChart Access Demo"
    : "OpenChart Access Demo Development",
);
const renderer = { scheme: "openchart-access", host: "app" };
// Clerk's interactive session is process-local. Only the backend API key persists.
const sessionTokens = new Map<string, string>();
const clerk = createClerkBridge({
  storage: {
    getItem: (key) => sessionTokens.get(key) ?? null,
    setItem: (key, value) => {
      sessionTokens.set(key, value);
    },
    removeItem: (key) => {
      sessionTokens.delete(key);
    },
  },
  renderer,
  userAgent: "OpenChart/AccessDemo",
});
let publishableKey: string;

let backend: Promise<DemoRuntime> | undefined;
let quitting = false;
let billingReturnPending = false;
let readyForBilling = false;

async function returnFromBilling(): Promise<void> {
  billingReturnPending = true;
  if (!backend || !readyForBilling || quitting) return;
  const { port } = await backend;
  if (quitting) return;
  let window = BrowserWindow.getAllWindows()[0];
  if (!window) {
    await createWindow(port);
    window = BrowserWindow.getAllWindows()[0];
  }
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send("billing:return");
  billingReturnPending = false;
}
app.on("open-url", (event, url) => {
  if (!isBillingReturn(url)) return;
  event.preventDefault();
  void returnFromBilling().catch(fail);
});
app.on("second-instance", (_event, argv) => {
  if (argv.some(isBillingReturn)) void returnFromBilling().catch(fail);
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  clerk.cleanup();
  sessionTokens.clear();
  void backend
    ?.then((runtime) => runtime.stop())
    .then(() => app.quit())
    .catch(fail);
  if (!backend) app.quit();
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => app.quit());
}

const developmentURL = !app.isPackaged && process.env.ELECTRON_RENDERER_URL;
if (developmentURL) {
  const url = new URL(developmentURL);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("Access demo development requires an HTTP loopback URL");
  }
}

/** Report a startup failure and terminate instead of leaving an empty window. */
function fail(cause: unknown): void {
  console.error(cause);
  dialog.showErrorBox("Access demo could not start", String(cause));
  app.exit(1);
}

/** Create the local renderer; closing it leaves the macOS application running. */
async function createWindow(port: number): Promise<void> {
  const window = new BrowserWindow({
    title: "OpenChart Access Demo",
    width: 960,
    height: 720,
    minWidth: 480,
    minHeight: 360,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      additionalArguments: [
        `--access-demo-port=${port}`,
        `--clerk-publishable-key=${publishableKey}`,
      ],
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => {
    // Vite may reload the current document when an entry module changes.
    if (event.url !== window.webContents.getURL()) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());

  if (developmentURL) await window.loadURL(developmentURL);
  else await window.loadURL(`${renderer.scheme}://${renderer.host}/`);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

if (clerk.isPrimaryInstance)
  void app
    .whenReady()
    .then(async () => {
      const configPath =
        process.env.OPENCHART_CLERK_CONFIG ??
        join(app.getPath("appData"), "OpenChart Access Demo", "clerk.json");
      const config = z
        .object({
          publishableKey: z.string().regex(/^pk_(test|live)_[A-Za-z0-9+/=]+$/),
          billingUrl: z.url().optional(),
        })
        .parse(JSON.parse(await readFile(configPath, "utf8")));
      publishableKey = config.publishableKey;
      const fapiHost = Buffer.from(publishableKey.split("_")[2]!, "base64")
        .toString()
        .replace(/\$$/, "");
      const clerkOrigin = new URL(`https://${fapiHost}`).origin;
      const rendererOrigin = developmentURL
        ? new URL(developmentURL).origin
        : `${renderer.scheme}://${renderer.host}`;
      session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: [`${clerkOrigin}/*`] },
        (details, callback) => {
          // Clerk's native SDK authenticates with Authorization, not Origin.
          const headers = details.requestHeaders;
          if (new URL(details.url).searchParams.get("_is_native") === "1") {
            for (const name of Object.keys(headers)) {
              if (name.toLowerCase() === "origin") delete headers[name];
            }
          }
          callback({ requestHeaders: headers });
        },
      );
      const assets = resolve(import.meta.dirname, "../renderer");
      protocol.handle(renderer.scheme, (request) => {
        const url = new URL(request.url);
        if (url.host !== renderer.host)
          return new Response(null, { status: 404 });
        const file = resolve(
          assets,
          `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`,
        );
        if (!file.startsWith(assets + sep))
          return new Response(null, { status: 403 });
        return net.fetch(pathToFileURL(file).href);
      });
      backend = startRuntime(
        join(app.getPath("userData"), "home"),
        rendererOrigin,
        fail,
        config.billingUrl,
      );
      const { port } = await backend;
      if (quitting) return;
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onHeadersReceived(
        (details, callback) => {
          const url = new URL(details.url);
          const headers = { ...details.responseHeaders };
          if (
            url.origin === clerkOrigin &&
            url.searchParams.get("_is_native") === "1"
          ) {
            // Native Clerk responses omit browser CORS headers. Expose them only
            // to this local renderer, including the SDK's client JWT header.
            for (const name of Object.keys(headers)) {
              if (name.toLowerCase().startsWith("access-control-"))
                delete headers[name];
            }
            headers["Access-Control-Allow-Origin"] = [rendererOrigin];
            headers["Access-Control-Allow-Credentials"] = ["true"];
            headers["Access-Control-Allow-Headers"] = [
              "Authorization, Content-Type",
            ];
            headers["Access-Control-Allow-Methods"] = [
              "GET, POST, PATCH, DELETE, OPTIONS",
            ];
            headers["Access-Control-Expose-Headers"] = ["Authorization"];
          }
          const scripts = `'self' 'unsafe-inline' ${clerkOrigin} https://challenges.cloudflare.com${developmentURL ? " 'unsafe-eval'" : ""}`;
          const connections = [
            "'self'",
            `http://127.0.0.1:${port}`,
            clerkOrigin,
            ...(developmentURL
              ? [new URL(developmentURL).origin.replace("http:", "ws:")]
              : []),
          ].join(" ");
          callback({
            responseHeaders: {
              ...headers,
              "Content-Security-Policy": [
                `default-src 'self'; script-src ${scripts}; ` +
                  `style-src 'self' 'unsafe-inline'; connect-src ${connections}; ` +
                  "img-src 'self' https://img.clerk.com data:; object-src 'none'; " +
                  "worker-src 'self' blob:; frame-src 'self' https://challenges.cloudflare.com; " +
                  "base-uri 'none'; form-action 'self'",
              ],
            },
          });
        },
      );
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0)
          void createWindow(port).catch(fail);
      });
      ipcMain.handle("billing:open", async (event, value: unknown) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || event.senderFrame !== event.sender.mainFrame)
          throw new Error("Untrusted billing caller");
        const current = event.senderFrame.url;
        if (
          developmentURL
            ? new URL(current).origin !== rendererOrigin
            : !current.startsWith(`${rendererOrigin}/`)
        )
          throw new Error("Untrusted billing caller");
        await shell.openExternal(BillingLink.parse(value));
      });
      // Development must not replace the installed product's protocol handler.
      if (app.isPackaged) app.setAsDefaultProtocolClient("openchart");
      await createWindow(port);
      readyForBilling = true;
      if (billingReturnPending || process.argv.some(isBillingReturn))
        await returnFromBilling();
    })
    .catch(fail);
