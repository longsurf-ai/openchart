// Purpose: Reuse complete historical spans across consumers of one ready Bars Dataset.
import { Cache, Clock, Effect, SynchronizedRef, type Duration } from "effect";
import {
  concatFrames,
  takeRows,
  type DataFrame,
  type DataFrameRow,
  type DataFrameSpec,
} from "@openchart/timeseries";

/** Native Bars selections; a count without from selects the latest actual rows. */
export interface HistorySelection {
  readonly time: { readonly from?: number; readonly to?: number };
  readonly count?: number;
}

/**
 * An interval [from, to) proven complete, with every source row inside it.
 *
 * One series' timeline as the cache sees it (time runs left to right):
 *
 *   window.from                          window.to        now
 *   |                                            |          |
 *   v                                            v          v
 *   ......[########)......[####)..........[######)~~~~~~~~~~~
 *
 *   [###)  span: proven complete; holds every row the source has in it
 *   .....  gap: never read, so unknown; never treated as empty
 *   ~~~~~  newer than window.to: may still change, so always read fresh
 */
interface Span<S extends DataFrameSpec> {
  readonly from: number;
  readonly to: number;
  readonly data: DataFrame<S>;
}
type Spans<S extends DataFrameSpec> = readonly Span<S>[];

/** The query shapes the cache answers; every other shape goes to the source. */
type Selection =
  | { readonly from: number; readonly to: number; readonly count?: never }
  | { readonly from?: undefined; readonly to: number; readonly count: number };

/** A source read that also records the span it proves. */
type Fetch<S extends DataFrameSpec, E> = (
  selection: Selection,
) => Effect.Effect<DataFrame<S>, E>;

/**
 * Cache complete native history reads for one ready Dataset, behind its admission.
 *
 * Every query field except time/count identifies a series (flat scalar Dataset
 * keys). A range reads only the gaps between cached spans. A backward count
 * extends the span containing `to` and never counts across an unqueried gap.
 * Bounded forward counts and bounds outside history keep the source's behavior.
 * `window` gives the source's available lower bound and stable-history cutoff:
 * newer rows, and rows from the first one `isFinal` rejects, are always read.
 * Native schemas, labels and gaps are preserved.
 *
 * Effect Cache bounds series capacity/TTL; TTL also bounds older corrections and
 * adjustments. A SynchronizedRef serializes each series and commits only after
 * the whole answer succeeds, so failures and cancellation leave no partial
 * coverage. A series beyond maxRows/maxSpans is dropped without truncating its
 * response; `invalidate` drops every series (explicit resync). Create once per
 * published Dataset, never per observation; a replacement Dataset gets a new cache.
 * @example const { select } = yield* cacheHistory(readSource, { window: (_, now) => ({ from: 0, to: now - 60_000 }) });
 */
export const cacheHistory = Effect.fn("Bars.cacheHistory")(function* <
  Q extends HistorySelection,
  S extends DataFrameSpec,
  E,
>(
  readSource: (query: Q) => Effect.Effect<DataFrame<S>, E>,
  options: {
    readonly window: (
      query: Q,
      now: number,
    ) => { readonly from: number; readonly to: number };
    readonly isFinal?: (row: DataFrameRow<S>) => boolean;
    readonly capacity?: number;
    readonly timeToLive?: Duration.Input;
    readonly maxRows?: number;
    readonly maxSpans?: number;
  },
) {
  // An Indicator on finer bars than its chart's reads the chart's whole
  // window in them: three years of hourly bars is about 26,000 rows.
  const { maxRows = 100_000, maxSpans = 32 } = options;
  const series = yield* Cache.make<
    // Key: the provider's series identity fields.
    // OpenChart: { listing, resolution, session, adjustment }.
    Omit<Q, "time" | "count">,
    // Value: complete cached intervals [{ from, to, data: DataFrame }] for one series.
    // SynchronizedRef serializes fills so later queries reuse newly covered spans.
    SynchronizedRef.SynchronizedRef<Spans<S>>
  >({
    lookup: () => SynchronizedRef.make<Spans<S>>([]),
    capacity: options.capacity ?? 1024,
    timeToLive: options.timeToLive ?? "1 day",
  });
  // One select, end to end:
  //
  //   select(query)
  //     |
  //     +-- toCacheableSelection says uncached --------> readSource(query)
  //     |
  //     v  range | latest
  //   +--- this series, locked (SynchronizedRef.modifyEffect) ---------+
  //   | spans = stored spans clipped to the current window             |
  //   |                                                                |
  //   | readRange / readLatest                                         |
  //   |   covered --> rows sliced from a span                          |
  //   |   gap ------> fetch: readSource() -> proven() -> cover(spans)  |
  //   |                                                                |
  //   | commit spans, or [] when over maxSpans / maxRows               |
  //   +----------------------------------------------------------------+
  //     a failure or interruption inside the box commits nothing
  const select = Effect.fn("Bars.cachedSelect")(function* (query: Q) {
    const now = yield* Clock.currentTimeMillis;
    const window = options.window(query, now);

    const { time, count, ...key } = query;
    const selection = toCacheableSelection(time, count, now, window.from);
    if (!selection) return yield* readSource(query);
    return yield* SynchronizedRef.modifyEffect(
      yield* Cache.get(series, key),
      Effect.fn("Bars.fillHistory")(function* (stored) {
        let spans: Spans<S> = stored.flatMap((span) =>
          clip(span, window.from, window.to),
        );
        const fetch = Effect.fn("Bars.fetchHistory")(function* (
          selection: Selection,
        ) {
          const { from, to, count } = selection;
          const data = yield* readSource({
            ...query,
            time: { from, to },
            count,
          });
          spans = cover(
            spans,
            proven(data, selection, window, options.isFinal),
          );
          return data;
        });
        const result =
          selection.from !== undefined
            ? yield* readRange(spans, fetch, selection.from, selection.to)
            : yield* readLatest(
                spans,
                fetch,
                window.from,
                selection.to,
                selection.count,
              );
        const rows = spans.reduce((n, span) => n + span.data.numRows, 0);
        const fits = spans.length <= maxSpans && rows <= maxRows;
        return [result, fits ? spans : []] as const;
      }),
    );
  });
  return { select, invalidate: Cache.invalidateAll(series) };
});

/**
 * Classify a query, capping `to` at now; undefined sends it to the source unchanged.
 *
 *   time.from   count   cached as
 *   ---------   -----   ------------------------------------------
 *   unset       n       latest: the n newest rows before `to`
 *   set         unset   range: every row in [from, to)
 *   unset       unset   no: the source decides what "everything" is
 *   set         n       no: forward counts keep the source behavior
 *
 *   Also uncached: `to` at or below the floor, `from` below the floor, from >= to.
 */
function toCacheableSelection(
  time: HistorySelection["time"],
  count: number | undefined,
  now: number,
  floor: number,
): Selection | undefined {
  const to = Math.min(time.to ?? now, now);
  if (to <= floor) return undefined;
  if (time.from === undefined)
    return count === undefined ? undefined : { to, count };
  if (count !== undefined || time.from < floor || time.from >= to)
    return undefined;
  return { from: time.from, to };
}

/**
 * Rows in [from, to): covered parts come from spans, gaps from the source.
 *
 * A cursor walks from `from` to `to`; each gap it crosses costs one fetch.
 *
 *                    from                                          to
 *   query            |<-------------------------------------------->|
 *   spans        |##########|              |##########|
 *   answer           |######|~~~~~~~~~~~~~~|##########|~~~~~~~~~~~~~|
 *                     slice      fetch         slice       fetch
 *   spans after  |##################################################|
 *
 * With stable data every fetch is recorded and touching pieces join, so the
 * same query next time is one slice and no fetch.
 */
const readRange = Effect.fn("Bars.readRange")(function* <
  S extends DataFrameSpec,
  E,
>(spans: Spans<S>, fetch: Fetch<S, E>, from: number, to: number) {
  const parts: DataFrame<S>[] = [];
  let cursor = from;
  for (const span of spans) {
    if (span.to <= cursor || span.from >= to) continue;
    if (span.from > cursor)
      parts.push(yield* fetch({ from: cursor, to: span.from }));
    const end = Math.min(span.to, to);
    parts.push(rowsBetween(span.data, Math.max(cursor, span.from), end));
    cursor = end;
  }
  if (cursor < to) parts.push(yield* fetch({ from: cursor, to }));
  return parts.reduce((left, right) => concatFrames(left, right));
});

/**
 * The latest `count` rows before `to`. Only the span containing `to` is used;
 * it is extended backwards with one source read unless it reaches the floor.
 *
 *   1. That span has enough rows before `to`: slice the last `count`.
 *
 *                                 to
 *                                 v
 *        spans   ....|##################|....
 *        answer         |#########|
 *                       <- count ->
 *
 *   2. Too few: one fetch for the missing rows, ending where the span begins.
 *      If the span already starts at the floor nothing is older; return it.
 *
 *                                 to
 *                                 v
 *        spans   ............|##########|....
 *        answer       |~~~~~~|####|
 *                       older cached
 *
 *   3. `to` is in a gap: rows hidden there are unknown, so the span on the
 *      left can't be counted from. One plain fetch(undefined, to, count).
 *
 *                                 to
 *                                 v
 *        spans   |######|....................
 *        answer           |~~~~~~~|
 */
const readLatest = Effect.fn("Bars.readLatest")(function* <
  S extends DataFrameSpec,
  E,
>(
  spans: Spans<S>,
  fetch: Fetch<S, E>,
  floor: number,
  to: number,
  count: number,
) {
  const span = spans.find((span) => span.from < to && to <= span.to);
  if (!span) return yield* fetch({ to, count });
  const cached = rowsBetween(span.data, span.from, to);
  if (cached.numRows >= count) return lastRows(cached, count);
  if (span.from <= floor) return cached;
  const older = yield* fetch({ to: span.from, count: count - cached.numRows });
  return concatFrames(older, cached);
});

/**
 * The span a successful read proves complete. A full range also proves its empty
 * intervals; a backward count proves only its returned suffix, unless it returned
 * fewer rows and so exhausted history. Unstable and unfinal suffixes are excluded.
 *
 *   o = a returned row     # = the proven span
 *
 *   range: fetch(from, to)
 *       from                           to
 *       |   o o o o        o o o o     |   every row in [from, to) came back,
 *       |##############################|   so the empty stretch is proven too
 *
 *   backward count: fetch(undefined, to, 4)
 *       .................. o o o o     |   only the 4 newest rows came back;
 *                          |###########|   what lies before them is unknown
 *
 *   backward count that came back short (2 < 4): nothing older exists
 *       window.from
 *       |                      o o     |
 *       |##############################|
 *
 *   last, the end is pulled back to min(to, window.to, first row isFinal rejects)
 *       |   o o o o o o o o x x x      |   x = newer than window.to, or not
 *       |###################|              final yet, or after such a row
 */
function proven<S extends DataFrameSpec>(
  data: DataFrame<S>,
  selection: Selection,
  window: { readonly from: number; readonly to: number },
  isFinal: ((row: DataFrameRow<S>) => boolean) | undefined,
): Span<S> {
  const start =
    selection.from ??
    (data.numRows < selection.count ? window.from : data.get(0)!.time);
  const unfinal = isFinal ? [...data].find((row) => !isFinal(row)) : undefined;
  const end = Math.min(selection.to, window.to, unfinal?.time ?? Infinity);
  return { from: start, to: end, data: rowsBetween(data, start, end) };
}

/**
 * Record `next` as covered: replace what it overlaps and join touching neighbours.
 * A gap between spans has never been proven complete, so it stays a gap.
 *
 *   letters show which read a row came from
 *
 *   spans    AAAAAA    BBBBBBBB    CCCC
 *   next        NNNNNNNNNN
 *
 *   before   AAA                           old spans cut to end at next.from
 *   after                 BBBBB    CCCC    old spans cut to start at next.to
 *   result   AAANNNNNNNNNNBBBBB    CCCC    next wins the overlap (fresher read);
 *                                          touching edges join; the gap stays
 */
function cover<S extends DataFrameSpec>(
  spans: Spans<S>,
  next: Span<S>,
): Spans<S> {
  if (next.from >= next.to) return spans;
  const before = spans.flatMap((span) => clip(span, -Infinity, next.from));
  const after = spans.flatMap((span) => clip(span, next.to, Infinity));
  let joined = next;
  if (before.at(-1)?.to === joined.from) joined = join(before.pop()!, joined);
  if (after[0]?.from === joined.to) joined = join(joined, after.shift()!);
  return [...before, joined, ...after];
}

/** The part of a span inside [from, to), if any. */
function clip<S extends DataFrameSpec>(
  span: Span<S>,
  from: number,
  to: number,
): Span<S>[] {
  const start = Math.max(span.from, from);
  const end = Math.min(span.to, to);
  return start < end
    ? [{ from: start, to: end, data: rowsBetween(span.data, start, end) }]
    : [];
}

function join<S extends DataFrameSpec>(left: Span<S>, right: Span<S>): Span<S> {
  return {
    from: left.from,
    to: right.to,
    data: concatFrames(left.data, right.data),
  };
}

/** Rows with from <= time < to; returns `data` itself when every row qualifies. */
function rowsBetween<S extends DataFrameSpec>(
  data: DataFrame<S>,
  from: number,
  to: number,
): DataFrame<S> {
  if (
    data.numRows === 0 ||
    (data.get(0)!.time >= from && data.get(data.numRows - 1)!.time < to)
  )
    return data;
  return takeRows(
    data,
    [...data].flatMap(({ time }, index) =>
      time >= from && time < to ? [index] : [],
    ),
  );
}

function lastRows<S extends DataFrameSpec>(
  data: DataFrame<S>,
  count: number,
): DataFrame<S> {
  const start = Math.max(0, data.numRows - count);
  return takeRows(
    data,
    Array.from({ length: data.numRows - start }, (_, i) => start + i),
  );
}
