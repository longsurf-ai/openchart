// Purpose: Open the shared app using the backend started by Electron main.
import type { BackendConnection } from "@openchart/app/lib/transport/transport";
import changelog from "./changelog/changelog.json";
import { createClerkProvider } from "./clerk-provider";
import "./renderer.css";

declare global {
  interface Window {
    /** Added by preload.ts to supply the connection, folder picker and update restart. */
    readonly desktop: {
      readonly connection: () => Promise<
        BackendConnection & {
          publishableKey: string;
          testAccount?: string;
          initialLocalStorage?: Readonly<Record<string, string>>;
        }
      >;
      readonly pickDirectory: () => Promise<string | null>;
      readonly openPath: (path: string) => Promise<void>;
      readonly openBilling: (url: string) => Promise<void>;
      readonly onBillingReturn: (listener: () => void) => () => void;
      readonly onUpdateReady: (
        listener: (release: string) => void,
      ) => () => void;
      readonly restartToUpdate: () => Promise<void>;
    };
  }
}

// Only Mac desktop pages need to leave room for the system's window buttons.
if (navigator.platform.startsWith("Mac"))
  document.documentElement.classList.add("desktop-macos");

// Get the connection details before rendering; the page then calls the backend directly.
void window.desktop
  .connection()
  .then(
    async ({
      publishableKey,
      testAccount,
      initialLocalStorage,
      ...connection
    }) => {
      for (const [key, value] of Object.entries(initialLocalStorage ?? {})) {
        if (localStorage.getItem(key) === null)
          localStorage.setItem(key, value);
      }
      // App modules may read storage as they load, so they load after seeding.
      const { bootstrap } = await import("@openchart/app/bootstrap");
      bootstrap(connection, createClerkProvider(publishableKey, testAccount), {
        pickDirectory: () => window.desktop.pickDirectory(),
        openPath: (path) => window.desktop.openPath(path),
        openBilling: (url) => window.desktop.openBilling(url),
        onBillingReturn: (listener) => window.desktop.onBillingReturn(listener),
        changelog,
        onUpdateReady: (listener) => window.desktop.onUpdateReady(listener),
        restartToUpdate: () => window.desktop.restartToUpdate(),
      });
    },
  );
