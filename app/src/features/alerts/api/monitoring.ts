// Purpose: Read backend monitoring and derive each alert's health; a lost connection never shows green.
import {
  queryOptions,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { filter } from "rxjs";
import type {
  AppTransport,
  MonitoringOutputs,
} from "@openchart/app/lib/transport/transport";

/** One monitored key (an alert or a backend service) and its checks. */
export type MonitoringStatus = MonitoringOutputs["status"][number];
/** Health shared by a Status and each of its checks. */
export type Health = MonitoringStatus["health"];
/**
 * What the app shows for one rule: paused intent, or current monitoring health.
 * `retrying` is true only when the rule's own observation failed; the alert
 * runner failing affects every rule but retries nothing.
 */
export type AlertHealth =
  | { readonly state: "paused" }
  | (Health & {
      readonly since?: number;
      readonly checks: MonitoringStatus["checks"];
      readonly retrying: boolean;
    });

const statusKey = [["monitoring", "status"]] as const;
const rank = { healthy: 0, unknown: 1, degraded: 2, failed: 3 } as const;

/** Every backend Status, keyed like `alert/<ruleId>`. @example useQuery(monitoringStatusQueryOptions(transport)); */
export function monitoringStatusQueryOptions(
  transport: Pick<AppTransport, "rpc" | "url">,
) {
  return queryOptions({
    queryKey: [...statusKey, transport.url] as const,
    queryFn: ({ signal }) =>
      transport.rpc.monitoring.status.query(undefined, { signal }),
  });
}

/** Refetch statuses on (re)connection and each `monitoring.changed`. @example subscribeMonitoringInvalidation(transport, queryClient); */
export function subscribeMonitoringInvalidation(
  transport: Pick<AppTransport, "events">,
  queryClient: QueryClient,
  onError: (error: unknown) => void = console.error,
) {
  return transport.events
    .pipe(
      filter(
        (frame) =>
          frame.kind === "ready" ||
          (frame.kind === "event" && frame.event.type === "monitoring.changed"),
      ),
    )
    .subscribe({
      next: () => {
        void queryClient
          .invalidateQueries({ queryKey: statusKey })
          .catch(onError);
      },
      error: onError,
    });
}

/**
 * The shared event connection: `connecting` before the first ready frame,
 * `lost` once a ready connection drops, until it is ready again.
 */
export type Connection = "connecting" | "ready" | "lost";

/**
 * Health for one rule. Disabled rules are paused. Until the connection and the
 * first status read land, health is unknown with code `checking` (nothing is
 * wrong yet). A lost connection or a failed read (`null`) is unknown with code
 * `disconnected`. An enabled rule without a Status is unknown too: the app never
 * shows green it cannot currently prove. A failed alert service affects every rule.
 * @example alertHealth(rule, statuses, "ready").state;
 */
export function alertHealth(
  rule: { readonly id: string; readonly enabled: boolean },
  statuses: readonly MonitoringStatus[] | null | undefined,
  connection: Connection,
): AlertHealth {
  if (!rule.enabled) return { state: "paused" };
  if (connection === "lost" || statuses === null)
    return {
      state: "unknown",
      reason: {
        code: "disconnected",
        message: "Can't reach OpenChart's alert service.",
      },
      checks: [],
      retrying: false,
    };
  if (connection === "connecting" || statuses === undefined)
    return {
      state: "unknown",
      reason: { code: "checking", message: "Checking monitoring…" },
      checks: [],
      retrying: false,
    };
  const own = statuses.find((status) => status.key === `alert/${rule.id}`);
  const service = statuses.find((status) => status.key === "service/alerts");
  const candidates = [
    own ?? {
      health: {
        state: "unknown" as const,
        reason: { code: "not_running", message: "Monitoring hasn't started." },
      },
      since: undefined,
      checks: [],
    },
    ...(service && service.health.state !== "healthy" ? [service] : []),
  ];
  const worst = candidates.reduce((a, b) =>
    rank[b.health.state] > rank[a.health.state] ? b : a,
  );
  return {
    ...worst.health,
    since: worst.since,
    checks: candidates.flatMap((status) => status.checks),
    retrying: worst === own && own.health.state === "failed",
  };
}

type ConnectionSource = Pick<AppTransport, "events" | "ready" | "wasReady">;

function connectionOf(transport: ConnectionSource): Connection {
  return transport.ready ? "ready" : transport.wasReady ? "lost" : "connecting";
}

/** Tracks the shared event connection as a {@link Connection}. @example const connection = useConnection(transport); */
export function useConnection(transport: ConnectionSource): Connection {
  const [connection, setConnection] = useState<Connection>(() =>
    connectionOf(transport),
  );
  useEffect(() => {
    // The transport remembers readiness, so a page mounted mid-outage sees `lost`.
    let wasReady = transport.wasReady;
    setConnection(connectionOf(transport));
    const subscription = transport.events.subscribe({
      next: (frame) => {
        if (frame.kind === "ready") {
          wasReady = true;
          setConnection("ready");
        } else if (frame.kind === "connecting")
          setConnection(wasReady ? "lost" : "connecting");
      },
      error: () => setConnection("lost"),
    });
    return () => subscription.unsubscribe();
  }, [transport]);
  return connection;
}

/** Returns each rule's current {@link AlertHealth}. @example const healthOf = useAlertHealth(transport); healthOf(rule); */
export function useAlertHealth(transport: AppTransport) {
  const statuses = useQuery(monitoringStatusQueryOptions(transport));
  const connection = useConnection(transport);
  const data = statuses.isError ? null : statuses.data;
  return useCallback(
    (rule: { readonly id: string; readonly enabled: boolean }) =>
      alertHealth(rule, data, connection),
    [data, connection],
  );
}
