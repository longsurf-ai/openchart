// Purpose: Observe the local account independently of Clerk's browser session.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** Reads public account state and refreshes after credential changes; unmount unsubscribes. @example const account = useAccount(transport); */
export function useAccount(transport: AppTransport) {
  const queries = useQueryClient();
  const account = useQuery({
    queryKey: ["account"],
    queryFn: ({ signal }) =>
      transport.rpc.access.auth.getState.query(undefined, { signal }),
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(() => {
    const subscription = transport.events.subscribe({
      next(frame) {
        if (
          frame.kind === "ready" ||
          (frame.kind === "event" && frame.event.type === "integration.updated")
        )
          void queries.invalidateQueries({ queryKey: ["account"] });
      },
      error() {},
    });
    return () => subscription.unsubscribe();
  }, [queries, transport]);
  return account;
}
