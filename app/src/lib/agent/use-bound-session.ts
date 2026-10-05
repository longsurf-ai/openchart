// Purpose: Observe an existing bound Session without creating or executing one.
import { useQuery } from "@tanstack/react-query";

import type { AppTransport } from "@openchart/app/lib/transport/transport";

import { useAgentContext } from "./provider";
import { boundSessionQueryOptions } from "./queries";
import { selectSessionProgress } from "./session-progress";
import type { SessionSnapshot } from "./session-store";
import { useSessionSnapshot } from "./use-session-snapshot";

/**
 * Reads an opaque binding and observes its Session through the shared Agent.
 * Missing bindings have no progress; mounting never creates or submits a Session.
 * Query errors expose a retry; execution failures come from the Session snapshot.
 * The shared SessionStore reports observation failures through Sonner.
 * Unmount detaches this consumer without cancelling backend execution.
 * @example const session = useBoundSession(transport, `drawing:${drawingId}`);
 */
export function useBoundSession(transport: AppTransport, bindingKey: string) {
  const { agent } = useAgentContext();
  const bound = useQuery(boundSessionQueryOptions(transport, bindingKey));
  const { progress, error } = useSessionSnapshot(
    agent,
    bound.data?.id,
    selectProgressAndError,
  );
  return {
    progress,
    error: bound.error ?? (error ? new Error(error) : null),
    retry: bound.error
      ? () => {
          void bound.refetch();
        }
      : undefined,
  };
}

function selectProgressAndError(snapshot: SessionSnapshot) {
  return {
    progress: selectSessionProgress(snapshot),
    error: snapshot.error,
  };
}
