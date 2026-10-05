// Purpose: Own the app's shared transport, subscriptions, and reconnect lifecycle.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { createTeaClient, type TeaClient } from "@openchart/app/lib/tea";
import { toast } from "sonner";
import {
  configQueryKey,
  subscribeConfigInvalidation,
} from "@openchart/app/lib/config/config";
import { subscribeResourceInvalidation } from "@openchart/app/lib/resource/invalidation";
import { subscribeSymbologyInvalidation } from "@openchart/app/lib/feed/invalidation";
import { subscribeWorkspaceInvalidation } from "@openchart/app/lib/workspace/workspace";
import { subscribeMonitoringInvalidation } from "@openchart/app/features/alerts/api/monitoring";
import {
  createTransport,
  type AppTransport,
  type BackendConnection,
} from "@openchart/app/lib/transport/transport";

/**
 * Mount once in the app layout to share transport across child routes.
 * `services` is undefined until the initial effect creates it. Event-stream
 * failures set `connectionError`; a ready frame clears it.
 * Reconnect replaces the transport and increments `attempt`, used as the consumer
 * remount key. Cleanup releases app observers, the shared Hose socket and cached
 * Config. Tea shutdown releases its server nodes before the old socket closes;
 * unrelated durable backend executions retain their independent lifetimes.
 * @example const { services, connectionError, attempt, reconnect } = useBackendConnection(connection);
 */
export function useBackendConnection(connection: BackendConnection) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState<{
    connection: BackendConnection;
    attempt: number;
    transport: AppTransport;
    tea: TeaClient;
  }>();
  const [connectionError, setConnectionError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const reportError = useCallback((error: unknown) => {
    setConnectionError(String(error));
  }, []);
  useEffect(() => {
    const transport = createTransport(connection);
    const tea = createTeaClient(transport);
    setConnectionError(undefined);
    const resources = subscribeResourceInvalidation(
      transport,
      queryClient,
      reportError,
    );
    const symbology = subscribeSymbologyInvalidation(
      transport,
      queryClient,
      reportError,
    );
    const config = subscribeConfigInvalidation(
      transport,
      queryClient,
      reportError,
    );
    const workspaces = subscribeWorkspaceInvalidation(
      transport,
      queryClient,
      reportError,
    );
    const monitoring = subscribeMonitoringInvalidation(
      transport,
      queryClient,
      reportError,
    );
    const readiness = transport.events.subscribe({
      next: (frame) => {
        if (frame.kind === "ready") setConnectionError(undefined);
      },
      error: reportError,
    });
    setCurrent({ connection, attempt, transport, tea });
    return () => {
      resources.unsubscribe();
      symbology.unsubscribe();
      config.unsubscribe();
      workspaces.unsubscribe();
      monitoring.unsubscribe();
      readiness.unsubscribe();
      // React does not await effect cleanup. Keep this captured transport alive
      // until its client has drained late allocations and released server nodes.
      void tea
        .close()
        .catch((error) => {
          toast.error("Couldn’t release indicator resources", {
            description: String(error),
          });
        })
        .finally(() => transport.hose.disconnect());
      queryClient.removeQueries({ queryKey: configQueryKey });
    };
  }, [connection, queryClient, attempt, reportError]);
  return {
    services:
      current?.connection === connection && current.attempt === attempt
        ? current
        : undefined,
    connectionError,
    attempt,
    reconnect: () => setAttempt((value) => value + 1),
  };
}
