// Purpose: Define the native operations and release information Desktop supplies to the application.
import { createContext, useContext } from "react";

/** One shipped release in Desktop's bundled changelog. */
export type ChangelogEntry = {
  /** Released version, e.g. "0.1.5". */
  readonly version: string;
  /** Release date as YYYY-MM-DD. */
  readonly date: string;
  /** User-facing changes, one sentence each. */
  readonly items: readonly string[];
};

/** Desktop supplies every operation; Electron dependencies stay outside the app. */
export type AppHost = {
  /** Opens a single-folder picker; cancellation returns null and failures reject. */
  pickDirectory: () => Promise<string | null>;
  /** Opens an absolute local path with the system's default app; failures reject. */
  openPath: (path: string) => Promise<void>;
  /** Opens a validated Stripe link in the browser; failures reject. */
  openBilling: (url: string) => Promise<void>;
  /** Subscribes to billing return notifications; returns the unsubscribe. */
  onBillingReturn: (listener: () => void) => () => void;
  /** Releases shipped with this build, newest first. */
  changelog: readonly ChangelogEntry[];
  /**
   * Calls back with the release name, e.g. "OpenChart 0.1.6", once an update has
   * downloaded, including one downloaded before subscribing. Returns the unsubscribe.
   */
  onUpdateReady: (listener: (release: string) => void) => () => void;
  /** Quits through the normal path, which may still be cancelled, then installs the update. */
  restartToUpdate: () => Promise<void>;
  /**
   * Shows a system notification confirming notifications are on. The first
   * one OpenChart shows is what lets macOS ask the user to allow them; the
   * answer is the system's and is not reported back. Failures reject.
   */
  enableNotifications: () => Promise<void>;
};

const AppHostContext = createContext<AppHost | undefined>(undefined);

/**
 * Shares Desktop's native operations throughout the app without owning state.
 * @example <AppHostProvider value={host}>{children}</AppHostProvider>
 */
export const AppHostProvider = AppHostContext.Provider;

/**
 * Reads the native operations supplied at the app entry; throws without its provider.
 * @example const { pickDirectory } = useAppHost();
 */
export function useAppHost(): AppHost {
  const host = useContext(AppHostContext);
  if (!host) throw new Error("useAppHost requires AppHostProvider");
  return host;
}
