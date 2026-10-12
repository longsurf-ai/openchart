// Purpose: Scope one intent router to a mounted owner, such as a Dashboard.
import { createContext, useState, type PropsWithChildren } from "react";

import { createIntentRouter, type IntentRouter } from "./intent";

/** The router of the nearest WidgetIntentProvider; null where intents are not routed. */
export const IntentRouterContext = createContext<IntentRouter | null>(null);

/**
 * Create one router for this subtree's lifetime. Remount (for example with a
 * Dashboard ID key) to start a new scope; unmounting drops waiting requests.
 * Without a provider, raises settle as `unavailable` and handlers register nothing.
 * @example <WidgetIntentProvider key={dashboardId}>{children}</WidgetIntentProvider>
 */
export function WidgetIntentProvider({ children }: PropsWithChildren) {
  const [router] = useState(createIntentRouter);
  return (
    <IntentRouterContext.Provider value={router}>
      {children}
    </IntentRouterContext.Provider>
  );
}
