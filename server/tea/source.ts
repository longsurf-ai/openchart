// Purpose: Source: where one series' rows come from, as an empty stream at build time and as fetched rows at run time.
import { isDeepStrictEqual } from "node:util";
import { Effect, Equal, type Stream } from "effect";
import { Subject } from "rxjs";
import { DataStream, timeframeClock } from "tea";
import type { Module, ModuleInputs, Scalar } from "tea/runtime";
import {
  barsSeries,
  parseTickerId,
  resolutionMs,
  tickerId,
  type BarsSeries,
  type BarsSnapshot,
  type FeedError,
  type Resolution,
} from "@openchart/feed";
import { BarColumns } from "@openchart/market";
import {
  defineDataFrame,
  type DataFrame,
  type DataFrameRow,
} from "@openchart/timeseries";
import * as Tea from "@openchart/tea";
import type { FeedServices } from "@openchart/server/feed/service";
import { invalid, upstream } from "./errors";
import { columnSchema } from "./wiring";

/** An input that names a series: Feed's Bars, or caller-supplied Samples. */
export type SeriesInput = Tea.Bars | Tea.Samples;

/** Whether an input names a series rather than another node's output. @example Object.values(config.inputs).filter(isSeries); */
export const isSeries = (input: Tea.NodeInput): input is SeriesInput =>
  input._tag !== "NodeRef";

/* -------------------------------------------------------------------------- */
/* What a series means to a script                                            */
/* -------------------------------------------------------------------------- */

// The fixed builtins one series supplies, keyed by the Module's builtin index.
function seriesContext(
  inputs: ModuleInputs,
  series: BarsSeries,
  chart: Resolution | undefined,
): ReadonlyMap<number, Scalar> {
  const period = Tea.timeframeOf(series.resolution);
  const values: Record<string, Scalar | undefined> = {
    "chart.timeframe": chart && Tea.timeframeOf(chart),
    "syminfo.ticker": series.listing.symbol,
    "syminfo.tickerid": tickerId(series),
    "syminfo.prefix": series.provider,
    "syminfo.currency": series.listing.currency,
    "timeframe.period": period,
    "timeframe.multiplier": Number.parseInt(period, 10) || 1,
    "timeframe.isseconds": series.resolution === "1s",
    "timeframe.isminutes": /[mh]$/.test(series.resolution),
    "timeframe.isintraday": /[smh]$/.test(series.resolution),
    "timeframe.isdaily": series.resolution === "1d",
    "timeframe.isweekly": series.resolution === "1W",
    "timeframe.ismonthly": series.resolution === "1M",
    "timeframe.isdwm": /[dWM]$/.test(series.resolution),
  };
  return new Map(
    inputs.builtins.flatMap((builtin, index) => {
      const value = values[`${builtin.source.domain}.${builtin.source.field}`];
      return builtin.constant && value !== undefined
        ? [[index, value] as const]
        : [];
    }),
  );
}

/**
 * The fixed builtins (`syminfo.*`, `timeframe.*`, `chart.timeframe`) a
 * Module declares, taken from one level's series, and `chart.timeframe` from
 * `chart`: the chart's resolution, which differs from the series' when an
 * auto script runs on finer bars, and which request children share with
 * their parent. They are supplied only when every series gives the same
 * values, comparing what the script would see, not the listings. With no
 * series, or series that disagree, none are supplied, and without `chart`
 * no `chart.timeframe`, so the script reads na, or stays incomplete if it
 * needs them to bind. `Module.bind` validates the values.
 * @example module.bind(parameters, marketContext(module.inputs, [series], "1d"));
 */
export function marketContext(
  inputs: ModuleInputs,
  series: readonly BarsSeries[],
  chart?: Resolution,
): ReadonlyMap<number, Scalar> {
  const [first, ...rest] = series.map((one) =>
    seriesContext(inputs, one, chart),
  );
  return first && rest.every((context) => isDeepStrictEqual(context, first))
    ? first
    : new Map();
}

/* -------------------------------------------------------------------------- */
/* The stream                                                                 */
/* -------------------------------------------------------------------------- */

// Prices derived from OHLC when a row does not carry them.
const derived: Readonly<
  Record<string, (value: (name: string) => number) => number>
> = {
  hl2: (v) => (v("high") + v("low")) / 2,
  hlc3: (v) => (v("high") + v("low") + v("close")) / 3,
  ohlc4: (v) => (v("open") + v("high") + v("low") + v("close")) / 4,
  hlcc4: (v) => (v("high") + v("low") + 2 * v("close")) / 4,
};

function sourceValue(row: DataFrameRow, name: string): number {
  const value = row[name];
  if (typeof value === "number") return value;
  if (value === null) return NaN;
  if (value === undefined && Object.hasOwn(derived, name))
    return derived[name]!((leg) => sourceValue(row, leg));
  throw new Tea.Error({
    code: "invalid_data",
    message: `Input column '${name}' must be numeric`,
  });
}

// One attempt of one input row: when it happened, whether it can still change,
// and its columns as numbers.
type InputRow = Readonly<Record<string, number | boolean>> & {
  readonly time: number;
  readonly provisional: boolean;
};

/**
 * One series of a graph: what it is, and the stream every Node that reads it
 * subscribes to. Build creates it empty; Run fetches its rows and pushes them.
 */
export interface Source {
  /** Where the rows come from: the Feed series, or the Samples rows. */
  readonly declared: SeriesInput;
  /**
   * The chart's resolution when an auto script (`timeframe = "auto"`) runs
   * this series on finer bars than the chart's; `declared` names the finer
   * ones. Undefined for a series that runs as the request names it.
   */
  readonly chart?: Resolution;
  /** A hot DataStream that every reader of the series shares. */
  readonly stream: DataStream;
  /** Push one attempt of one row. See {@link makeSource}. */
  send(row: DataFrameRow, provisional: boolean): void;
  /** End the stream: no row follows. */
  complete(): void;
}

/**
 * Create the empty Source of one series. Its stream carries `time`,
 * `provisional` and each of `columns` as a non-null Float64: null becomes
 * NaN, and hl2, hlc3, ohlc4 and hlcc4 are derived from OHLC unless the row
 * has them. Other values fail with invalid_data. Rows are never mutated.
 *
 * `send` pushes one attempt. It rejects an earlier time, and a new attempt at
 * a committed time, with invalid_data naming `where`. When a later bar
 * follows a provisional one, it first sends that bar again as final: the next
 * bar proves it closed, even when the source has no final flag. Both run once
 * per Source, never once per reader. Nothing subscribes here, and the
 * caller's Scope completes the stream. `chart` marks a series an auto script
 * runs on instead of the chart's (see {@link Source.chart}).
 * @example const source = yield* makeSource(input, ["close"], "input 'bars' at root");
 */
export const makeSource = (
  declared: SeriesInput,
  columns: readonly string[],
  where: string,
  chart?: Resolution,
) =>
  Effect.acquireRelease(
    Effect.sync((): Source => {
      const subject = new Subject<InputRow>();
      let last: InputRow | undefined;
      return {
        declared,
        chart,
        stream: new DataStream(
          columnSchema(columns),
          subject,
          timeframeClock(Tea.timeframeOf(declared.resolution)),
        ),
        send(row, isProvisional) {
          if (
            last &&
            (row.time < last.time ||
              (row.time === last.time && !last.provisional))
          )
            throw new Tea.Error({
              code: "invalid_data",
              message: `Out-of-order input or committed revision in ${where}`,
            });
          const next: InputRow = {
            ...Object.fromEntries(
              columns.map((name) => [name, sourceValue(row, name)]),
            ),
            time: row.time,
            provisional: isProvisional,
          };
          if (last?.provisional && row.time > last.time)
            subject.next({ ...last, provisional: false });
          last = next;
          subject.next(next);
        },
        complete: () => subject.complete(),
      };
    }),
    (source) => Effect.sync(() => source.complete()),
  );

/* -------------------------------------------------------------------------- */
/* Fetching rows                                                              */
/* -------------------------------------------------------------------------- */

const bars = defineDataFrame(BarColumns);

// A Samples window chosen the way Feed chooses one, from the rows alone: those
// in `[from, to)`, plus earlier rows when fewer than `countBack` fall inside.
// It never reads the clock, so synthetic future times work.
function sampleSnapshot(
  rows: Tea.Samples["rows"],
  from: number,
  to: number,
  countBack: number,
): BarsSnapshot {
  const before = rows.filter((row) => row.time < from);
  const window = rows.filter((row) => row.time >= from && row.time < to);
  const needed = Math.max(0, countBack - window.length);
  const prefix = before.slice(Math.max(0, before.length - needed));
  return {
    range: { from: prefix[0]?.time ?? from, to },
    data: bars.create({ labels: {}, rows: [...prefix, ...window] }),
    hasMoreBefore: before.length > needed,
  };
}

/** The rows Run asks one Source for. */
export interface SourceWindow {
  readonly from: number;
  readonly to: number | "now";
  /** At least this many rows, reaching before `from` when needed. */
  readonly countBack: number;
  /** How many rows before the window to fetch as warmup, when there are any. */
  readonly warmup: number;
}

/** The rows of one Source over a {@link SourceWindow}. */
export interface SourceHistory {
  readonly source: Source;
  /** The window's rows. */
  readonly snapshot: BarsSnapshot;
  /** Warmup rows before the snapshot, if earlier history exists. */
  readonly prefix: DataFrame | undefined;
  /** Later rows of a live window. */
  readonly updates: Stream.Stream<DataFrame, FeedError> | undefined;
}

/**
 * Fetch one Source's rows over `window`, in the caller's Scope: the window,
 * then up to `warmup` earlier rows when earlier history exists. Bars call
 * Feed with only their five series fields; Samples select from their own
 * rows, never touch Feed and never update, so the caller refuses a live
 * window with Samples first. A Source on finer bars than the chart's
 * ({@link Source.chart}) whose window reaches before the provider keeps
 * those bars starts where it does, the `availableFrom` of Feed's
 * HistoryUnavailable. Other Feed failures become upstream errors.
 * @example const history = yield* openSource(source, { from, to, countBack, warmup: 1000 }, feed);
 */
export const openSource = Effect.fn("Tea.openSource")(function* (
  source: Source,
  window: SourceWindow,
  feed: Effect.Effect<FeedServices>,
) {
  const { declared } = source;
  const read = (from: number, to: number | "now", countBack: number) =>
    declared._tag === "Samples"
      ? Effect.succeed({
          // The caller refused a live window, so this one is finite.
          snapshot: sampleSnapshot(
            declared.rows,
            from,
            to as number,
            countBack,
          ),
          updates: undefined,
        })
      : Effect.flatMap(feed, ({ bars }) =>
          bars.observe({
            ...barsSeries(declared, declared),
            from,
            to,
            countBack,
          }),
        );
  const observe = (from: number, to: number | "now", countBack: number) =>
    read(from, to, countBack).pipe(Effect.mapError(upstream));
  // Finer bars than the chart's start where the provider's history does,
  // such as Yahoo's hourly bars about 730 days back; the chart's own bars
  // fail there as the chart does.
  const session = yield* read(window.from, window.to, window.countBack).pipe(
    Effect.catch((error) => {
      const start =
        source.chart !== undefined &&
        error.reason._tag === "Feed.HistoryUnavailable"
          ? error.reason.availableFrom
          : undefined;
      return start !== undefined && start > window.from
        ? read(start, window.to, window.countBack)
        : Effect.fail(error);
    }),
    Effect.mapError(upstream),
  );
  const visibleFrom = session.snapshot.range.from;
  const prefix =
    window.warmup === 0 || !session.snapshot.hasMoreBefore
      ? undefined
      : (yield* observe(visibleFrom - 1, visibleFrom, window.warmup)).snapshot
          .data;
  return {
    source,
    snapshot: session.snapshot,
    prefix,
    updates: session.updates,
  } satisfies SourceHistory;
});

/* -------------------------------------------------------------------------- */
/* The series a request.security line names                                   */
/* -------------------------------------------------------------------------- */

// What a left-out request child reads, as its line names it: the one series
// every Bars and Samples input of the parent names (`market`), the ticker of
// `target`, the listing the bound parent reads, and the resolution of its
// timeframe (`""` is the parent's). Errors name the request by `name`.
const requestTarget = Effect.fn("Tea.requestTarget")(function* (
  parent: Pick<Tea.NodeConfig, "inputs">,
  target: Module["requests"][number]["context"],
  name: string,
) {
  const [market, ...others] = Object.values(parent.inputs)
    .filter(isSeries)
    .map((input) => barsSeries(input, input));
  if (!market || others.some((series) => !Equal.equals(series, market)))
    return yield* invalid(
      `${name}: the script has no single Bars input to take a session from; give ${name} a config in requests.`,
    );
  if (!target)
    return yield* invalid(
      `${name}: its symbol or timeframe is unknown; give it a config in requests.`,
    );
  const ticker = parseTickerId(target.symbol);
  if (!ticker)
    return yield* invalid(
      `${name}: '${target.symbol}' is not a ticker id; write provider:symbol, such as binance:ETHUSDT or yfinance:AAPL.`,
    );
  const resolution =
    target.timeframe === ""
      ? market.resolution
      : Tea.resolutionOf(target.timeframe);
  if (!resolution)
    return yield* invalid(
      `${name}: timeframe '${target.timeframe}' has no bars; use 1S, 1, 5, 15, 30, 60, 240, D, W or M.`,
    );
  return { market, ticker, resolution, symbol: target.symbol };
});

/**
 * The config of a request child that its parent's config leaves out: Bars of
 * the listing its line names (`target`, as the bound parent reads it), at its
 * timeframe (`""` is the parent's), with the parent's session and adjustment
 * and the parent's parameters, as Tea gives a child. The ticker id follows
 * `@openchart/feed`'s per-provider rules; symbology must find exactly one
 * listing, searching the providers when the saved index lacks it, and the
 * provider must serve those bars. Nothing loads bars.
 *
 * These errors reach chart users, so they name the request by its variable in
 * the script (`name`), never by its place in the graph. All are
 * invalid_request except a failed Feed lookup, which is upstream.
 * @example const eth = yield* requestedBars(parent, bound.requests[0].context, feed, "eth");
 */
export const requestedBars = Effect.fn("Tea.requestedBars")(function* (
  parent: Pick<Tea.NodeConfig, "inputs" | "parameters">,
  target: Module["requests"][number]["context"],
  feed: Effect.Effect<FeedServices>,
  name: string,
) {
  const { market, ticker, resolution, symbol } = yield* requestTarget(
    parent,
    target,
    name,
  );
  // A saved index can hold other providers' listings and not this one, so a
  // miss there searches the providers themselves.
  const { bars, symbology } = yield* feed;
  const find = (indexed: boolean) =>
    symbology.search({ query: ticker.symbol, indexed, limit: 100 }).pipe(
      Effect.map((hits) => hits.filter(ticker.names)),
      Effect.tapErrorTag("Symbology.IndexUnavailable", (error) =>
        Effect.logError("Symbol index unavailable", error),
      ),
      Effect.mapError((error) =>
        error._tag === "FeedError"
          ? upstream(error)
          : new Tea.Error(
              { code: "internal", message: "The symbol index is unavailable." },
              { cause: error },
            ),
      ),
    );
  let found = yield* find(true);
  if (found.length === 0) found = yield* find(false);
  if (found.length !== 1)
    return yield* invalid(
      `${name}: ${symbol} names ${found.length === 0 ? "no listing" : "more than one listing"}.`,
    );
  const series = barsSeries(found[0]!, { ...market, resolution });
  const offered = (yield* bars
    .getCapabilities(found[0]!)
    .pipe(Effect.mapError(upstream))).filter(
    (offer) => offer.resolution === resolution,
  );
  if (offered.length === 0)
    return yield* invalid(
      `${name}: ${series.provider} has no ${resolution} bars.`,
    );
  if (
    !offered.some(
      ({ session, adjustment }) =>
        session === series.session && adjustment === series.adjustment,
    )
  )
    return yield* invalid(
      `${name}: ${series.provider} has no bars for this chart's session and adjustment. Use a ${series.provider} chart.`,
    );
  return {
    ...Tea.barsInputs(series),
    parameters: parent.parameters,
    requests: {},
  } satisfies Tea.NodeConfig;
});

/**
 * The config of a request child that its parent's config leaves out, in a run
 * that reads only supplied history (`ObserveRequest.samples`): the Samples,
 * among `supplied` and those its parent reads, that hold the listing its line
 * names at its timeframe, with the parent's session and adjustment, and the
 * parent's parameters. It reads nothing from Feed. Errors are invalid_request
 * and name the request by its variable, as {@link requestedBars}'s do.
 * @example const period = yield* suppliedBars(parent, bound.requests[0].context, request.samples, "periodStart");
 */
export const suppliedBars = Effect.fn("Tea.suppliedBars")(function* (
  parent: Pick<Tea.NodeConfig, "inputs" | "parameters">,
  target: Module["requests"][number]["context"],
  supplied: readonly Tea.Samples[],
  name: string,
) {
  const { market, ticker, resolution } = yield* requestTarget(
    parent,
    target,
    name,
  );
  const own = Object.values(parent.inputs).filter(
    (input): input is Tea.Samples => input._tag === "Samples",
  );
  const samples = [...supplied, ...own].find(
    (candidate) =>
      ticker.names(candidate) &&
      candidate.resolution === resolution &&
      candidate.session === market.session &&
      candidate.adjustment === market.adjustment,
  );
  if (!samples)
    return yield* invalid(
      `${name}: the supplied history has no ${ticker.symbol} ${resolution} bars.`,
    );
  return {
    inputs: { bars: samples },
    map: Tea.barsInputs(samples).map,
    parameters: parent.parameters,
    requests: {},
  } satisfies Tea.NodeConfig;
});

/* -------------------------------------------------------------------------- */
/* The bars an auto script runs on                                            */
/* -------------------------------------------------------------------------- */

/** How much finer than the chart's bar an auto script's bars may be. */
const finerAtMost = 32;

/**
 * The resolution an auto script (`indicator(..., timeframe = "auto")`) runs
 * on when a caller gives it `series`, the chart's bars. Without `chosen`: the
 * finest the provider offers at the series' session and adjustment that is at
 * most 32 times finer than the series' own, else the series' own. With
 * `chosen`, the user's pick from the script's settings: that resolution, when
 * the provider offers it there and it is no coarser than the series' own;
 * else invalid_request. Capabilities are read as {@link requestedBars} reads
 * them; a failed lookup is upstream.
 *
 * The rule ignores the window, so a chart, the alerts that follow its
 * Indicator and the Agent pick the same bars: 5m to 30m charts run on 1m, 1h
 * on 5m, 4h on 15m, 1d on 1h, 1W and 1M on 1d, and 1s and 1m as they are,
 * when the provider offers those.
 * @example const resolution = yield* runResolution(series, feed); // "1h" for daily Binance bars
 */
export const runResolution = Effect.fn("Tea.runResolution")(function* (
  series: BarsSeries,
  feed: Effect.Effect<FeedServices>,
  chosen?: Resolution,
) {
  const { bars } = yield* feed;
  const offered = yield* bars
    .getCapabilities({ provider: series.provider, listing: series.listing })
    .pipe(Effect.mapError(upstream));
  const chart = resolutionMs[series.resolution];
  const matching = offered.filter(
    ({ session, adjustment }) =>
      session === series.session && adjustment === series.adjustment,
  );
  if (chosen !== undefined)
    return resolutionMs[chosen] <= chart &&
      matching.some(({ resolution }) => resolution === chosen)
      ? chosen
      : yield* invalid(
          `${series.provider} has no ${chosen} bars to count for this chart; pick another lower timeframe.`,
        );
  return matching.reduce<Resolution>(
    (finest, { resolution }) =>
      resolutionMs[resolution] < resolutionMs[finest] &&
      resolutionMs[resolution] * finerAtMost >= chart
        ? resolution
        : finest,
    series.resolution,
  );
});
