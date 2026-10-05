// Purpose: The app's only Tea client access: read, describe and run declarative Tea sources.
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { defer, scan } from "rxjs";
import * as Tea from "@openchart/tea";
import { mergeByTime, type DataFrame } from "@openchart/timeseries";
import { writeNodeConfig } from "@openchart/app/lib/tea";
import { workspaceQueryKeys } from "@openchart/app/lib/workspace/workspace";
import { useTeaClient } from "./use-tea-client";

/**
 * A declarative Tea node: what to run, how to bind it, which window to show
 * and how many bars to warm before it (see {@link Tea.ObserveRequest}).
 * `inputs`, `map` and `requests` are the {@link Tea.NodeConfig} parts, such
 * as `{ ...Tea.barsInputs(series), requests: {} }`.
 */
export type Node = {
  readonly source: Tea.CompileRequest;
  /** Explicit values; the program declares every other parameter's default. */
  readonly parameters: Tea.ParameterOverrides;
  readonly inputs: Tea.NodeConfig["inputs"];
  readonly map: Tea.NodeConfig["map"];
  readonly requests: Tea.NodeConfig["requests"];
  readonly from: Tea.ObserveRequest["from"];
  readonly to: Tea.ObserveRequest["to"];
  readonly countBack: Tea.ObserveRequest["countBack"];
  readonly warmupBars: Tea.ObserveRequest["warmupBars"];
};
// `config` is the run's filled-in config, kept with the data it produced.
type Observation =
  | {
      status: "loading";
      data: DataFrame | undefined;
      config: Tea.NodeConfig | undefined;
      error?: undefined;
    }
  | {
      status: "ready";
      data: DataFrame;
      config: Tea.NodeConfig;
      error?: undefined;
    }
  | {
      status: "error";
      data: DataFrame | undefined;
      config: Tea.NodeConfig | undefined;
      error: Error;
    };
const errorOf = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

/**
 * A source's current content. Complete content passes through. A Workspace path
 * is read with every file its imports reach as a Workspace program read, so a
 * change to any of those files re-reads it while mounted; an equal re-read
 * keeps the same `program`. Every mount reads again and stays `pending` until
 * that read settles, so a consumer never sees content older than itself, such
 * as a snapshot cached before a save. A failed read reports `error` without a
 * `program`; `retry` reads again. Failures are the consumer's to report.
 * @example const { program } = useTeaSource({ workspaceId, path: "sma.tea" });
 */
export function useTeaSource(source: Tea.CompileRequest): {
  program?: Tea.SnapshotSources;
  error?: Error;
  pending: boolean;
  retry(): void;
} {
  const tea = useTeaClient();
  const file = "path" in source ? source : undefined;
  const read = useQuery({
    meta: { silent: true },
    queryKey: file
      ? workspaceQueryKeys.program(tea.url, file.workspaceId, file.path)
      : ["tea.snapshot"],
    queryFn: file ? ({ signal }) => tea.snapshot(file, { signal }) : skipToken,
    // Always stale: every mount and every newly followed path reads again.
    staleTime: 0,
  });
  if (!("path" in source))
    return { program: source, pending: false, retry: () => {} };
  const settled = read.isFetchedAfterMount;
  const error = settled ? (read.error ?? undefined) : undefined;
  const program = settled && !error ? read.data : undefined;
  return {
    program,
    error,
    pending: !program && !error,
    retry: () => void read.refetch(),
  };
}

/** Compile a source's current content once per content; changed content or unmount releases it, even when it arrives late. */
function useCompilation(source: Tea.CompileRequest) {
  const client = useTeaClient();
  const live = useTeaSource(source);
  const [attempt, setAttempt] = useState(0);
  const entry = live.program?.entry;
  const files = live.program?.sources;
  // Stringify once per files reference; Query keeps an equal refetch's reference.
  const contentKey = useMemo(
    () => (files ? JSON.stringify({ entry, sources: files }) : undefined),
    [entry, files],
  );
  // Returning A -> B -> A creates a new lifetime, even when identities match.
  const key = useMemo(
    () =>
      contentKey === undefined ? undefined : { contentKey, attempt, client },
    [contentKey, attempt, client],
  );
  const [compilation, setCompilation] = useState<{
    key: typeof key;
    result:
      | { value: Tea.CompileResponse; error?: undefined }
      | { value?: undefined; error: Error };
  }>();
  useEffect(() => {
    if (!key) return;
    let active = true;
    const pending = key.client.compile(
      JSON.parse(key.contentKey) as Tea.SnapshotSources,
    );
    void pending.then(
      (value) => {
        if (active) setCompilation({ key, result: { value } });
      },
      (error) => {
        if (active) setCompilation({ key, result: { error: errorOf(error) } });
      },
    );
    return () => {
      active = false;
      // Aborting the request can lose the retained ID; wait and release it instead.
      void pending.then(
        (value) =>
          key.client.dispose({ id: value.id }).catch((error: unknown) => {
            toast.error("Couldn’t release indicator resources", {
              id: `tea-dispose:${value.id}`,
              description: errorOf(error).message,
            });
          }),
        // Compilation failures already belong to the observed state.
        () => {},
      );
    };
  }, [key]);
  const retained =
    key && compilation?.key === key ? compilation.result : undefined;
  const error = live.error ?? retained?.error;
  return {
    compilation: retained?.value,
    error,
    pending: !retained?.value && !error,
    retry: () => {
      if (live.error) live.retry();
      setAttempt((value) => value + 1);
    },
  };
}

/**
 * What a source's program declares: its `definition` (parameters, inputs,
 * outputs, requests) and its `indicator()` `declaration`. Compiles once per
 * content of {@link useTeaSource}; changed content or unmount releases the
 * compilation. `pending` holds until this mount's read and compile settle; a
 * read or compile failure reports `error` without `compiled`. `retry` re-reads
 * a failed source and recompiles.
 * @example const { compiled, error, pending } = useTeaDefinition({ workspaceId, path: "sma.tea" });
 */
export function useTeaDefinition(source: Tea.CompileRequest): {
  compiled?: Pick<Tea.CompileResponse, "definition" | "declaration">;
  error?: Error;
  pending: boolean;
  retry(): void;
} {
  const { compilation, ...state } = useCompilation(source);
  return { compiled: compilation, ...state };
}

/**
 * Run a Tea node and observe complete replacement rows. The program's content
 * is its compilation identity: a Workspace file is read with its imports and
 * followed through Workspace changes, and only different content recompiles.
 * Parameters, inputs, map, requests and window (`from`, `to`, `countBack`,
 * `warmupBars`) re-observe the same compilation; the config's encoded JSON
 * decides whether it changed. Window changes retain the last frame until a
 * replacement snapshot arrives, including on refresh failure; other changes
 * clear it. `retry` re-reads a failed source and recompiles. Unmount cancels
 * observation and disposes even a late compilation. With `samples`, the run
 * reads only supplied history: the service reads nothing from Feed, refuses
 * Bars inputs, and fills request children from these Samples or refuses
 * them (see {@link Tea.ObserveRequest}).
 * @example const tea = useTea({source: {workspaceId, path: "sma.tea"}, parameters: {}, ...Tea.barsInputs(series), requests: {}, from, to: "now", countBack: 500, warmupBars: Tea.standardWarmupBars});
 */
export function useTea(
  node: Node,
  options: { samples?: readonly Tea.Samples[] } = {},
) {
  const client = useTeaClient();
  const { source, from, to, countBack, warmupBars, ...config } = node;
  const {
    compilation: current,
    error: failure,
    retry,
  } = useCompilation(source);
  // The config's JSON says whether it changed; observing uses the latest object,
  // because Arrow schemas don't survive a JSON round trip.
  const configKey = writeNodeConfig(config);
  const latest = useRef(config);
  latest.current = config;
  const { samples } = options;
  // A window can reuse its preceding result; A -> B -> A is a new execution identity.
  const execution = useMemo(
    () => ({ compilation: current, configKey, client, samples }),
    [current, configKey, client, samples],
  );
  const request = useMemo(
    () => ({ execution, from, to, countBack, warmupBars }),
    [execution, from, to, countBack, warmupBars],
  );
  const [observation, setObservation] = useState<{
    request: typeof request;
    state: Observation;
  }>();
  useEffect(() => {
    const {
      execution: { compilation: current, client },
      from,
      to,
      countBack,
      warmupBars,
    } = request;
    if (!current) return;
    const subscription = defer(() => {
      const { parameters, ...binding } = latest.current;
      return client.observe({
        ...binding,
        id: current.id,
        from,
        to,
        countBack,
        warmupBars,
        parameters: Tea.teaParameters(current.definition, parameters),
        nodes: {},
        ...(request.execution.samples
          ? { samples: request.execution.samples }
          : {}),
      });
    })
      .pipe(
        scan(
          (
            frame: { data: DataFrame; config: Tea.NodeConfig } | undefined,
            message,
          ) => {
            if (message.type === "snapshot")
              return { data: message.snapshot.data, config: message.config };
            if (!frame)
              throw new Error("Tea update arrived before its snapshot.");
            return { ...frame, data: mergeByTime(frame.data, message.data) };
          },
          undefined,
        ),
      )
      .subscribe({
        next: (frame) => {
          if (frame)
            setObservation({
              request,
              state: { status: "ready", ...frame },
            });
        },
        error: (error) =>
          setObservation((previous) => {
            const kept = previous?.request.execution === request.execution;
            return {
              request,
              state: {
                status: "error",
                data: kept ? previous.state.data : undefined,
                config: kept ? previous.state.config : undefined,
                error: errorOf(error),
              },
            };
          }),
      });
    return () => subscription.unsubscribe();
  }, [request]);
  const kept = observation?.request.execution === execution;
  const state: Observation = failure
    ? { status: "error", data: undefined, config: undefined, error: failure }
    : observation?.request === request
      ? observation.state
      : {
          status: "loading",
          data: kept ? observation.state.data : undefined,
          config: kept ? observation.state.config : undefined,
        };
  const compiled:
    Pick<Tea.CompileResponse, "definition" | "declaration"> | undefined =
    current;
  return { ...state, compiled, retry };
}
