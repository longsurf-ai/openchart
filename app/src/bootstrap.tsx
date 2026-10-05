// Purpose: Mount the shared application against one backend connection without development mocks.

import "@openchart/app/styles/globals.css";

import { StrictMode, type ComponentType, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { bootstrapTheme } from "./lib/theme/theme";
import type { BackendConnection } from "./lib/transport/transport";
import type { AppHost } from "./lib/host/host";

/**
 * Mounts the application into its HTML root. Desktop supplies the backend
 * connection, configured Clerk provider and native operations. The workspace
 * opens only after sign-in. Throws when the HTML root is missing.
 * @example bootstrap(connection, AccountProvider, host);
 */
export function bootstrap(
  connection: BackendConnection,
  accountProvider: ComponentType<PropsWithChildren>,
  host: AppHost,
): void {
  const initialTheme = bootstrapTheme(connection);
  const root = document.getElementById("root");
  if (!root) throw new Error("App root is missing");
  createRoot(root).render(
    <StrictMode>
      <App
        connection={connection}
        initialTheme={initialTheme}
        accountProvider={accountProvider}
        host={host}
      />
    </StrictMode>,
  );
}
