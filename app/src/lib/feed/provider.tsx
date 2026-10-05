import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
// Purpose: Keep one Feed client while independently observing availability versions.
import {
  type ClientFailure,
  type FeedError,
  type FeedVersion,
} from "@openchart/feed";
import { createContext, useEffect, useState, type ReactNode } from "react";

import type { FeedClient } from "./client";
import { feedError, type FeedTransport } from "./transport";

/** Stable client injection; version changes do not replace it. */
export const FeedReactContext = createContext<FeedClient | undefined>(
  undefined,
);
/** Finite-query cache identity, separate from transport and live-session lifetimes. */
export const FeedVersionContext = createContext<FeedVersion | undefined>(
  undefined,
);
/** Application connection and children that share its Feed client. */
export interface FeedProviderProps {
  readonly transport: FeedTransport;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}
/** Own the client and observe versions without delaying children on network readiness. Version changes never cancel queries or sessions; unmount closes the client. @example <FeedProvider transport={transport}><Dashboard /></FeedProvider> */
export function FeedProvider({
  transport,
  children,
  fallback,
}: FeedProviderProps) {
  const [current, setCurrent] = useState<{
    transport: FeedTransport;
    client: FeedClient;
  }>();
  const [version, setVersion] = useState<{
    transport: FeedTransport;
    value: FeedVersion;
  }>();
  const [error, setError] = useState<FeedError | ClientFailure>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const client = transport.client();
    setCurrent({ transport, client });
    setVersion(undefined);
    return () => client.close();
  }, [transport]);
  useEffect(() => {
    setError(undefined);
    const subscription = transport.watchVersion().subscribe({
      next: (next) => {
        setVersion({ transport, value: next });
        setError(undefined);
      },
      error: (cause) => setError(feedError(cause)),
    });
    return () => subscription.unsubscribe();
  }, [transport, attempt]);
  useErrorToast(error, {
    id: "feed-notifications",
    title: "Feed connection interrupted",
    // Resubscribing to versions is always safe, whatever the failure.
    retry: () => setAttempt((value) => value + 1),
  });
  if (current?.transport !== transport)
    return <>{fallback ?? <p role="status">Connecting to data feeds…</p>}</>;
  return (
    <FeedReactContext.Provider value={current.client}>
      <FeedVersionContext.Provider
        value={version?.transport === transport ? version.value : undefined}
      >
        {children}
      </FeedVersionContext.Provider>
    </FeedReactContext.Provider>
  );
}
