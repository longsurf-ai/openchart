// Purpose: Complete Windows installer lifecycle events before starting the application host.
import { execFile } from "node:child_process";
import { win32 } from "node:path";
import { promisify } from "node:util";
import type { App } from "electron";

const execute = promisify(execFile);
const events = new Set([
  "--squirrel-install",
  "--squirrel-updated",
  "--squirrel-uninstall",
  "--squirrel-obsolete",
]);

/** Permanent Windows identity matching Squirrel's package ID and executable. */
export const windowsAppId = "com.squirrel.OpenChart.OpenChart";

/**
 * Handles installer events without acquiring the app lock, opening a window,
 * or starting Clerk/backend services. Returns undefined for an ordinary launch.
 * Recognized events register/remove the protocol and await Update.exe's shortcut
 * operation, then quit even on failure. The caller reports rejected operations;
 * shortcut work has a ten-second timeout. Saved application data is untouched.
 * @example const handled = handleSquirrelStartup({ app, platform: process.platform, argv: process.argv, executable: process.execPath });
 */
export function handleSquirrelStartup(options: {
  app: Pick<
    App,
    "quit" | "setAsDefaultProtocolClient" | "removeAsDefaultProtocolClient"
  >;
  platform: NodeJS.Platform;
  argv: readonly string[];
  executable: string;
}): Promise<void> | undefined {
  if (options.platform !== "win32") return undefined;
  const event = options.argv.find((argument) => events.has(argument));
  if (!event) return undefined;
  const { app, executable } = options;
  return (async () => {
    try {
      if (event === "--squirrel-obsolete") return;
      const uninstall = event === "--squirrel-uninstall";
      if (uninstall) app.removeAsDefaultProtocolClient("openchart", executable);
      else app.setAsDefaultProtocolClient("openchart", executable);
      await execute(
        win32.resolve(win32.dirname(executable), "..", "Update.exe"),
        [
          uninstall ? "--removeShortcut" : "--createShortcut",
          win32.basename(executable),
        ],
        { windowsHide: true, timeout: 10_000 },
      );
    } finally {
      app.quit();
    }
  })();
}
