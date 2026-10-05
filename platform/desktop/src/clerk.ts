// Purpose: Configure Clerk's native transport and secure SDK storage for the shared desktop app.
import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import { app, session } from "electron";

/**
 * Registers Clerk's native bridge before ready using the bundled publishable key.
 * Tooling validates and embeds the key at build time. SDK tokens use the SDK's
 * OS-encrypted storage; the returned cleanup releases the bridge.
 * @example const clerk = configureClerk('openchart');
 */
export function configureClerk(scheme: string) {
  // Replaced with a string literal by tooling, never read from the installed user's environment.
  const publishableKey = process.env.OPENCHART_CLERK_PUBLISHABLE_KEY!;
  const host = Buffer.from(publishableKey.split("_")[2]!, "base64")
    .toString()
    .replace(/\$$/, "");
  const origin = new URL(`https://${host}`).origin;
  const bridge = createClerkBridge({
    storage: storage({ path: app.getPath("userData") }),
    renderer: {
      scheme,
      host: "app",
      privileges: { allowServiceWorkers: true },
    },
    oauthRedirectUrl:
      scheme === "openchart-dev"
        ? "https://longsurf.ai/auth/return/?app=development"
        : "https://longsurf.ai/auth/return/",
    manageSingleInstanceLock: false,
    userAgent: "OpenChart/Desktop",
  });
  return { publishableKey, origin, cleanup: bridge.cleanup };
}

/**
 * Adapts native Clerk API responses for the sandboxed renderer, as proven in
 * demo/access. Only this Clerk origin's native requests receive CORS overrides.
 * @example connectClerkSession(clerk.origin, rendererOrigin);
 */
export function connectClerkSession(
  origin: string,
  rendererOrigin: string,
): void {
  const filter = { urls: [`${origin}/*`] };
  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      const headers = details.requestHeaders;
      if (new URL(details.url).searchParams.get("_is_native") === "1") {
        for (const name of Object.keys(headers))
          if (name.toLowerCase() === "origin") delete headers[name];
      }
      callback({ requestHeaders: headers });
    },
  );
  session.defaultSession.webRequest.onHeadersReceived(
    filter,
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      if (new URL(details.url).searchParams.get("_is_native") === "1") {
        for (const name of Object.keys(headers))
          if (name.toLowerCase().startsWith("access-control-"))
            delete headers[name];
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
      callback({ responseHeaders: headers });
    },
  );
}
