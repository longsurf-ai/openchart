// Purpose: Run: open a built graph's Sources, push their rows in order, and bridge the root's output to a snapshot and live updates.
import { Cause, Effect, Queue, Stream } from "effect";
import type { Datum } from "tea";
import {
  fromRows,
  type DataFrame,
  type DataFrameRow,
  type Range,
} from "@openchart/timeseries";
import * as Tea from "@openchart/tea";
import type { FeedServices } from "@openchart/server/feed/service";
import { teaError, upstream } from "./errors";
import type { NodeGraph } from "./node-graph";
import {
  openSource,
  type Source,
  type SourceHistory,
  type SourceWindow,
} from "./source";

const executionError = teaError("invalid_data", "Tea execution failed");
const invalidData = (message: string) =>
  new Tea.Error({ code: "invalid_data", message });
// Run synchronous Tea work in the invalid_data channel.
const attempt = <A>(body: () => A) =>
  Effect.try({ try: body, catch: executionError });

// How many history rows Run pushes between yields: enough that yielding
// costs nothing, few enough that other work waits only milliseconds.
const historySlice = 500;

// The window a top-level Source reads: the request's. A Source on finer bars
// than the chart's counts back 1: `countBack` counts the chart's bars, which
// [from, to) already spans on a market that trades around the clock;
// elsewhere the run can start after the chart's first bar. Warmup counts the
// Source's own bars.
function topWindow(
  { chart }: Source,
  window: Pick<Tea.ObserveRequest, keyof Range | "warmupBars">,
): SourceWindow {
  const { from, to, countBack, warmupBars: warmup } = window;
  return { from, to, countBack: chart === undefined ? countBack : 1, warmup };
}

/**
 * Run a built graph over the request's window: one snapshot, then for a live
 * run a bounded Effect stream of update frames.
 *
 * Opening: a live window with any Samples fails with invalid_request before
 * anything opens. Each top-level Source opens over the request's window with
 * `warmupBars` warmup rows. One that an auto script reads on finer bars
 * ({@link Source.chart}) covers the same window and counts back 1; its
 * warmup counts its own bars. Then the request children's Sources open, up
 * to 8 at once, each from the earliest point a top-level Source starts
 * executing (its first warmup row, else its window), with countBack 1 and the
 * same warmup. At warmup 0 a child adds no warmup rows; countBack 1 still
 * returns the one row before that point when none opens inside the child's
 * window. Otherwise a higher-timeframe `request.security` reads na until its
 * next bar opens, and `request.security_lower_tf`, whose first parent bar
 * collects every earlier child row, sees only the window's bars. Bars Sources
 * read Feed through `feed`; Samples never do.
 *
 * Pushing: every Node subscribed when the graph was built, so each sees every
 * pushed row. Request children are pushed first, so a parent finds its
 * child's rows when it steps. History goes in slices of 500 rows with a yield
 * between them, so other work keeps running during a long run and closing the
 * Scope stops it at the next slice. The snapshot range runs from the earliest
 * `from` to the earliest `to` of the top-level Sources. Outputs before `from`
 * are warmup and never published; rows at or after `to` wait for the live
 * phase; the snapshot keeps the latest attempt per index. A historical row
 * with a known successor runs once as final; the last one uses its final
 * flag, else it is provisional only when live. Each Source's last history row
 * and every live row is the newest, which Pine reads as `barstate.islast`
 * (see {@link NodeGraph.newest}); earlier rows, warmup included, are not.
 *
 * A finite run completes every Source and fails with invalid_data if the root
 * does not complete, or if its last step is not at the last row of every
 * top-level Source: Tea ends a node with its shortest input and drops the
 * rows the others still hold. A live run then sets {@link NodeGraph.live},
 * pushes the deferred rows and consumes every Source's updates concurrently.
 * Each output row is one frame; more than 1024 unread frames fail the run.
 * Data failures are invalid_data and Feed failures upstream; a failure ends
 * the update stream. The caller's Scope owns the sessions, the output
 * subscription and the queue.
 * @example const { snapshot, updates } = yield* run(graph, request, feed);
 */
export const run = Effect.fn("Tea.run")(function* (
  graph: NodeGraph,
  window: Pick<Tea.ObserveRequest, keyof Range | "warmupBars">,
  feed: Effect.Effect<FeedServices>,
) {
  const { top, children } = graph.sources;
  const live = window.to === "now";
  if (
    live &&
    [...top, ...children].some(({ declared }) => declared._tag === "Samples")
  )
    return yield* Effect.fail(
      new Tea.Error({
        code: "invalid_request",
        message: "Samples require a finite historical window",
      }),
    );
  const tops = yield* Effect.forEach(top, (source) =>
    openSource(source, topWindow(source, window), feed),
  );
  const start = Math.min(
    ...tops.map(
      ({ prefix, snapshot }) => prefix?.get(0)?.time ?? snapshot.range.from,
    ),
  );
  const kids = yield* Effect.forEach(
    children,
    (source) =>
      openSource(
        source,
        {
          from: start,
          to: window.to,
          countBack: 1,
          warmup: window.warmupBars,
        },
        feed,
      ),
    { concurrency: 8 },
  );

  const queue = yield* Effect.acquireRelease(
    Queue.bounded<DataFrame, Tea.Error | Cause.Done>(1024),
    (queue) => Queue.end(queue),
  );
  const range = {
    from: Math.min(...tops.map(({ snapshot }) => snapshot.range.from)),
    to: Math.min(...tops.map(({ snapshot }) => snapshot.range.to)),
  };
  const rows = new Map<number, Datum>();
  let failure: Tea.Error | undefined;
  let completed = false;
  // The time of the root's latest step, warmup included.
  let latest: number | undefined;
  const fail = (cause: unknown) => {
    failure ??= executionError(cause);
    Queue.failCauseUnsafe(queue, Cause.fail(failure));
  };
  const materialize = (rows: readonly Datum[]) =>
    fromRows(graph.root.module.outputs.schema, rows);
  yield* Effect.acquireRelease(
    attempt(() =>
      graph.root.to({
        next: (row) => {
          if (row.time == null || !Number.isSafeInteger(row.time))
            throw invalidData(
              "Tea output requires an exact millisecond timestamp",
            );
          latest = row.time;
          if (row.time < range.from) return;
          if (!graph.live) rows.set(row.index, row);
          else if (!Queue.offerUnsafe(queue, materialize([row])))
            throw invalidData("Tea output buffer overflowed");
        },
        error: fail,
        complete: () => {
          completed = true;
          Queue.endUnsafe(queue);
        },
      }),
    ),
    (subscription) => Effect.sync(() => subscription.unsubscribe()),
  );

  // A failing step reaches the root observer synchronously, so check after
  // every attempt and stop there. Every Node that steps on this push reads
  // `newest` as barstate.islast: only a Source's last history row and live
  // rows are its newest.
  const send = (
    source: Source,
    row: DataFrameRow,
    provisional = row.final !== true,
    newest = true,
  ) => {
    graph.newest = newest;
    source.send(row, provisional);
    if (failure) throw failure;
  };
  const deferred: [Source, DataFrameRow][] = [];
  // Push one Source's history before `range.to`, yielding between slices so
  // the backend stays responsive and a replaced run stops early, and return
  // its last row's time; later rows wait for the live phase.
  const push = Effect.fn("Tea.pushHistory")(function* ({
    source,
    prefix,
    snapshot,
  }: SourceHistory) {
    const history = (function* () {
      yield* prefix ?? [];
      yield* snapshot.data;
    })();
    let pending: DataFrameRow | undefined;
    let done = false;
    while (!done) {
      yield* attempt(() => {
        for (let pushed = 0; pushed < historySlice; pushed++) {
          const next = history.next();
          if (next.done) {
            done = true;
            return;
          }
          const row = next.value;
          if (row.time >= range.to) deferred.push([source, row]);
          else {
            // A known successor closes this historical row before its only
            // attempt, and makes it not the newest.
            if (pending) send(source, pending, false, false);
            pending = row;
          }
        }
      });
      // Other work runs between slices, and a replaced run stops here.
      yield* Effect.yieldNow;
    }
    const last = pending;
    yield* attempt(() => {
      if (last)
        send(
          source,
          last,
          typeof last.final === "boolean" ? !last.final : live,
        );
      if (!live) source.complete();
      if (failure) throw failure;
    });
    return last?.time;
  });
  yield* Effect.forEach(kids, push, { discard: true });
  const ends = (yield* Effect.forEach(tops, push)).flatMap((end) => end ?? []);
  const data = yield* attempt(() => {
    if (!live && !completed)
      throw invalidData("Finite Tea execution did not complete");
    if (!live && ends.some((end) => end !== latest))
      throw invalidData("Inputs of one node end at different times");
    return materialize([...rows.values()]);
  });
  rows.clear();
  const snapshot: Tea.Snapshot = { range, data };
  if (!live) return { snapshot };
  const opened = [...kids, ...tops];
  if (opened.some(({ updates }) => updates === undefined))
    return yield* Effect.fail(
      new Tea.Error({
        code: "upstream",
        message: "Live input updates are unavailable",
      }),
    );
  graph.live = true;
  yield* attempt(() => {
    for (const [source, row] of deferred) send(source, row);
  });
  yield* Effect.forEach(
    opened,
    ({ source, updates }) =>
      updates!.pipe(
        Stream.mapError(upstream),
        Stream.runForEach(
          Effect.fn("Tea.acceptInput")((frame: DataFrame) =>
            attempt(() => {
              for (const row of frame) send(source, row);
            }),
          ),
        ),
        Effect.andThen(Effect.sync(() => source.complete())),
      ),
    { concurrency: "unbounded", discard: true },
  ).pipe(
    Effect.catch((error) => Effect.sync(() => fail(error))),
    Effect.forkScoped,
  );
  return { snapshot, updates: Stream.fromQueue(queue) };
});
