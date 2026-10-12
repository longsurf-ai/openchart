// Purpose: Scope shared Tea compilations and latest-row observations to one consumer group.
import * as Tea from "@openchart/tea";
import { hashKey } from "@tanstack/react-query";
import { mergeByTime, takeRows, type DataFrame } from "@openchart/timeseries";
import {
  BehaviorSubject,
  Observable,
  Subject,
  defer,
  mergeMap,
  scan,
  Subscription,
} from "rxjs";
import { writeNodeConfig, type TeaClient } from "./index";

/** A consumer's independent identity and complete saved program execution. */
export type TeaGroupRequest = {
  readonly key: string;
  readonly node: Tea.NodeConfig &
    Pick<Tea.ObserveRequest, "from" | "to" | "countBack" | "warmupBars"> & {
      readonly source: Tea.SnapshotSources;
    };
};

/**
 * The latest complete output row, including provisional updates. Empty means
 * the run has no rows; null/nonfinite cells remain unchanged for the consumer
 * to interpret. Errors clear the value so a failed stream cannot look current.
 */
export type TeaLatestState = {
  readonly status: "loading" | "ready" | "empty" | "error";
  /** Group-local execution identity; stable across ticks and shared consumers. */
  readonly executionKey?: string;
  readonly data?: DataFrame;
  readonly config?: Tea.NodeConfig;
  readonly compiled?: Pick<Tea.CompileResponse, "definition" | "declaration">;
  readonly time?: number;
  readonly error?: Error;
};

const errorOf = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));
const loading: TeaLatestState = { status: "loading" };

// Values are JSON, including encoded Arrow schemas.
const canonical = (value: unknown) => hashKey([value]);

function execution(node: TeaGroupRequest["node"]) {
  const { source, from, to, countBack, warmupBars, ...config } = node;
  return {
    source,
    config,
    window: { from, to, countBack, warmupBars },
  };
}

function effectiveConfig(
  definition: Tea.CompileResponse["definition"],
  config: Tea.NodeConfig,
): Tea.NodeConfig {
  return {
    ...config,
    parameters: Tea.teaParameters(definition, config.parameters),
    requests: Object.fromEntries(
      Object.entries(config.requests).map(([name, child]) => [
        name,
        definition.requests[name]
          ? effectiveConfig(definition.requests[name], child)
          : child,
      ]),
    ),
  };
}

/**
 * Compare complete group requests without making record insertion order part
 * of their identity. Invalid configs throw before execution; no resources are
 * retained. This raw identity tracks React inputs; run sharing additionally
 * resolves declared parameter defaults after compilation.
 * @example const key = teaGroupRequestKey(requests);
 */
export function teaGroupRequestKey(
  requests: readonly TeaGroupRequest[],
): string {
  const sources = new Map<string, number>();
  const consumers = requests.map(({ key, node }) => {
    const { source, config, window } = execution(node);
    const content = canonical(source);
    if (!sources.has(content)) sources.set(content, sources.size);
    return {
      key,
      source: sources.get(content),
      config: JSON.parse(writeNodeConfig(config)),
      window,
    };
  });
  return canonical({ sources: [...sources.keys()], consumers });
}

/** A startup slot ends at the first snapshot, so live channels do not block it. */
function startupQueue() {
  const jobs = new Subject<() => Observable<never>>();
  const subscription = jobs.pipe(mergeMap((start) => start(), 4)).subscribe();
  return {
    add(start: (done: () => void) => void) {
      let cancelled = false;
      jobs.next(
        () =>
          new Observable((subscriber) => {
            const done = () => subscriber.complete();
            if (cancelled) done();
            else start(done);
          }),
      );
      return () => {
        cancelled = true;
      };
    },
    close: () => subscription.unsubscribe(),
  };
}

type Compilation = {
  identity: number;
  active: boolean;
  cancelQueued?: () => void;
  result?: Tea.CompileResponse;
  error?: Error;
};
type Run = {
  active: boolean;
  state: TeaLatestState;
  cancelQueued?: () => void;
  releaseStartup?: () => void;
  subscription: Subscription;
};

/**
 * Own a bounded group of Tea consumers. Equal complete snapshots compile
 * once; equal effective parameters, inputs, bindings, requests and windows
 * share one observation. Consumer IDs and chosen output fields do not affect
 * execution. No sharing crosses this group's lifetime.
 *
 * Call `reconcile` with all current consumers, subscribe to `states` for changes,
 * and `close` when the owner leaves. Removing the final consumer cancels its
 * observation and disposes its compilation, including a late compile result.
 * At most four compiles/history starts run concurrently. The first snapshot
 * frees a startup slot while its live subscription remains active. Compilation
 * and execution failures belong to the relevant state; `retry(key)` retries
 * the failed shared operation. Release errors go to `onReleaseError`; the
 * connection-owned client retains failed IDs for its shutdown retry.
 *
 * @example
 * const group = createTeaGroup(client, reportReleaseError);
 * const subscription = group.states.subscribe(render);
 * group.reconcile(requests);
 * // Cleanup: subscription.unsubscribe(); group.close();
 */
export function createTeaGroup(
  client: Pick<TeaClient, "compile" | "observe" | "dispose">,
  onReleaseError: (error: Error) => void,
) {
  const queue = startupQueue();
  const compilations = new Map<string, Compilation>();
  const runs = new Map<string, Run>();
  let requests: readonly TeaGroupRequest[] = [];
  let consumers = new Map<string, { compilation: string; run?: string }>();
  const states = new BehaviorSubject<ReadonlyMap<string, TeaLatestState>>(
    new Map(),
  );
  let closed = false;
  let reconciling = false;
  let changedWhileReconciling = false;
  let nextCompilationIdentity = 0;

  const release = (result: Tea.CompileResponse) => {
    void client
      .dispose({ id: result.id })
      .catch((error: unknown) => onReleaseError(errorOf(error)));
  };
  const stopRun = (run: Run) => {
    run.active = false;
    run.cancelQueued?.();
    run.subscription.unsubscribe();
    run.releaseStartup?.();
  };
  const stopCompilation = (compilation: Compilation) => {
    compilation.active = false;
    compilation.cancelQueued?.();
    if (compilation.result) release(compilation.result);
  };
  const publish = (next: ReadonlyMap<string, TeaLatestState>) => {
    if (
      next.size === states.value.size &&
      [...next].every(([key, state]) => states.value.get(key) === state)
    )
      return;
    states.next(next);
  };
  const publishRun = (runKey: string, run: Run) => {
    if (closed || !run.active) return;
    if (reconciling) {
      changedWhileReconciling = true;
      return;
    }
    const next = new Map(states.value);
    for (const [key, consumer] of consumers)
      if (consumer.run === runKey) next.set(key, run.state);
    publish(next);
  };

  function refresh() {
    if (closed) return;
    if (reconciling) {
      changedWhileReconciling = true;
      return;
    }
    reconciling = true;
    try {
      const wantedCompilations = new Set<string>();
      const wantedRuns = new Set<string>();
      const nextConsumers = new Map<
        string,
        { compilation: string; run?: string }
      >();
      const next = new Map<string, TeaLatestState>();
      for (const { key, node } of requests) {
        const { source, config: overrides, window } = execution(node);
        const compilationKey = canonical(source);
        wantedCompilations.add(compilationKey);
        let compilation = compilations.get(compilationKey);
        if (!compilation) {
          compilation = { identity: nextCompilationIdentity++, active: true };
          compilations.set(compilationKey, compilation);
          const owned = compilation;
          owned.cancelQueued = queue.add((done) => {
            if (closed || !owned.active) {
              done();
              return;
            }
            void Promise.resolve()
              .then(() => client.compile(source))
              .then(
                (result) => {
                  if (owned.active) owned.result = result;
                  else release(result);
                },
                (error: unknown) => {
                  if (owned.active) owned.error = errorOf(error);
                },
              )
              .finally(() => {
                done();
                refresh();
              });
          });
        }
        nextConsumers.set(key, { compilation: compilationKey });
        if (compilation.error) {
          const previous = states.value.get(key);
          next.set(
            key,
            previous?.error === compilation.error
              ? previous
              : {
                  status: "error",
                  error: compilation.error,
                },
          );
          continue;
        }
        const compiled = compilation.result;
        if (!compiled) {
          next.set(key, loading);
          continue;
        }
        try {
          const config = effectiveConfig(compiled.definition, overrides);
          const runKey = canonical({
            compilation: compilation.identity,
            config: JSON.parse(writeNodeConfig(config)),
            window,
          });
          nextConsumers.set(key, { compilation: compilationKey, run: runKey });
          wantedRuns.add(runKey);
          let run = runs.get(runKey);
          if (!run) {
            run = {
              active: true,
              state: { status: "loading", compiled },
              subscription: new Subscription(),
            };
            runs.set(runKey, run);
            const owned = run;
            owned.cancelQueued = queue.add((done) => {
              if (closed || !owned.active) {
                done();
                return;
              }
              owned.releaseStartup = done;
              owned.subscription.add(
                defer(() =>
                  client.observe({
                    ...config,
                    ...window,
                    id: compiled.id,
                    nodes: {},
                  }),
                )
                  .pipe(
                    scan(
                      (previous: TeaLatestState, message): TeaLatestState => {
                        const incoming =
                          message.type === "snapshot"
                            ? message.snapshot.data
                            : message.data;
                        const latest = takeRows(
                          incoming,
                          incoming.numRows ? [incoming.numRows - 1] : [],
                        );
                        const combined =
                          message.type === "updates" && previous.data
                            ? mergeByTime(previous.data, latest)
                            : latest;
                        const data = takeRows(
                          combined,
                          combined.numRows ? [combined.numRows - 1] : [],
                        );
                        return {
                          status: data.numRows ? "ready" : "empty",
                          executionKey: runKey,
                          data,
                          config:
                            message.type === "snapshot"
                              ? message.config
                              : previous.config,
                          compiled,
                          time: data.get(0)?.time,
                        };
                      },
                      owned.state,
                    ),
                  )
                  .subscribe({
                    next: (state) => {
                      if (!owned.active) return;
                      owned.state = state;
                      done();
                      publishRun(runKey, owned);
                    },
                    error: (error: unknown) => {
                      if (owned.active) {
                        owned.state = {
                          status: "error",
                          compiled,
                          error: errorOf(error),
                        };
                        done();
                        publishRun(runKey, owned);
                      }
                    },
                    complete: done,
                  }),
              );
            });
          }
          next.set(key, run.state);
        } catch (error) {
          const failure = errorOf(error);
          const previous = states.value.get(key);
          next.set(
            key,
            previous?.compiled === compiled &&
              previous.error?.message === failure.message
              ? previous
              : { status: "error", compiled, error: failure },
          );
        }
      }
      consumers = nextConsumers;
      for (const [key, run] of runs)
        if (!wantedRuns.has(key)) {
          run.active = false;
          run.cancelQueued?.();
        }
      for (const [key, compilation] of compilations)
        if (!wantedCompilations.has(key)) {
          compilation.active = false;
          compilation.cancelQueued?.();
        }
      for (const [key, run] of runs)
        if (!wantedRuns.has(key)) {
          runs.delete(key);
          stopRun(run);
        }
      for (const [key, compilation] of compilations)
        if (!wantedCompilations.has(key)) {
          compilations.delete(key);
          stopCompilation(compilation);
        }
      publish(next);
    } finally {
      reconciling = false;
      if (changedWhileReconciling) {
        changedWhileReconciling = false;
        refresh();
      }
    }
  }

  return {
    /** Replace the current consumers; absent keys release their subscriptions. */
    reconcile(next: readonly TeaGroupRequest[]) {
      if (closed) return;
      requests = next;
      refresh();
    },
    /** Read the immutable map last published by this group. */
    getSnapshot: () => states.value,
    /** Observe the current immutable map, then changes; unsubscribe removes that observer. */
    states: states.asObservable(),
    /** Retry the failed compilation or observation shared by this consumer. */
    retry(key: string) {
      const consumer = consumers.get(key);
      if (!consumer || closed) return;
      const compilation = compilations.get(consumer.compilation);
      if (compilation?.error) {
        compilations.delete(consumer.compilation);
        stopCompilation(compilation);
      } else if (consumer.run) {
        const run = runs.get(consumer.run);
        if (run?.state.status === "error") {
          runs.delete(consumer.run);
          stopRun(run);
        }
      }
      refresh();
    },
    /** Stop every consumer and release compiled IDs, including pending results. */
    close() {
      if (closed) return;
      closed = true;
      queue.close();
      for (const run of runs.values()) stopRun(run);
      for (const compilation of compilations.values())
        stopCompilation(compilation);
      runs.clear();
      compilations.clear();
      consumers.clear();
      requests = [];
      states.next(new Map());
      states.complete();
    },
  };
}
