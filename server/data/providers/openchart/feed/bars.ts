// Purpose: Adapt OpenChart's declared capabilities and stitch open-bar initialization with history.
import { Clock, Effect, Schedule, Stream } from "effect";
import { SessionType } from "@openchart/market";
import { openchartBars } from "@openchart/server/data/providers/openchart/datasets/definitions";
import {
  OpenChartResolution,
  OpenChartAdjustment,
} from "@openchart/server/data/providers/openchart/contract";
import type { ProviderId } from "@openchart/market";
import type { Dataset } from "@openchart/server/data";
import type {
  DatasetError,
  SelectResult,
  StreamQuery,
} from "@openchart/server/data/dataset";
import {
  FeedReasons,
  type BarsCapabilities,
  type BarsRequest,
} from "@openchart/feed";
import { datasetFailure, feedError } from "@openchart/server/feed/errors";
import { takeRows } from "@openchart/timeseries";
import type { IBarsFeedService } from "@openchart/server/feed/bar/service";
import { readBarsHistory } from "@openchart/server/feed/bar/history";
/** Preserve requested session coverage; all resolutions support historical and live price bases. @example openchartBarsFeed(dataset, providerId); */
export function openchartBarsFeed(
  dataset: Dataset<typeof openchartBars>,
  providerId: ProviderId,
): IBarsFeedService {
  // Each resolution lists its default first: regular session, split adjusted.
  const adjustments = [
    "split",
    ...OpenChartAdjustment.literals.filter((value) => value !== "split"),
  ] as const;
  const capabilities: BarsCapabilities = OpenChartResolution.literals.flatMap(
    (resolution) =>
      adjustments.flatMap((adjustment) =>
        SessionType.literals.map((session) => ({
          resolution,
          adjustment,
          session,
          modes: ["history", "live"] as const,
        })),
      ),
  );
  type SeriesKey = StreamQuery<typeof openchartBars>;
  type Updates = Stream.Stream<
    SelectResult<typeof openchartBars>,
    DatasetError
  >;
  const isResync = (error: DatasetError) =>
    error.reason._tag === "Dataset.StreamInterrupted" &&
    error.reason.kind === "resync";

  const resolveSeriesKey = Effect.fn("OpenChartBars.resolveSeriesKey")(
    function* (request: BarsRequest) {
      const id = request.listing.id;
      if (
        id === undefined ||
        !capabilities.some(
          (c) =>
            c.resolution === request.resolution &&
            c.adjustment === request.adjustment &&
            c.session === request.session,
        )
      )
        return yield* Effect.fail(
          feedError(new FeedReasons.Unsupported({ provider: providerId })),
        );
      return {
        listing: id,
        resolution: request.resolution,
        session: request.session,
        adjustment: request.adjustment,
      };
    },
  );

  const openLiveStream = Effect.fn("OpenChartBars.openLiveStream")(function* (
    request: BarsRequest,
    key: SeriesKey,
  ) {
    return request.to === "now"
      ? yield* dataset
          .stream(key)
          .pipe(Effect.mapError(datasetFailure(providerId)))
      : undefined;
  });

  const readSnapshot = Effect.fn("OpenChartBars.readSnapshot")(function* (
    request: BarsRequest,
    key: SeriesKey,
  ) {
    return yield* readBarsHistory(request, (bounds) =>
      dataset
        .select({
          ...key,
          time: { from: bounds.from, to: bounds.to },
          count: bounds.count,
        })
        .pipe(Effect.mapError(datasetFailure(providerId))),
    );
  });

  // Example: subscribe first, then read history while live buffers.
  //
  // bar time         A          B          C              D
  // HTTP snapshot   [final]    [final]    [final]
  //                                         ^ previous starts here
  // buffered live              [B open]   [C open/final] [D open -> final]
  //                               drop       drop          emit -> emit
  //
  // Each accepted row advances previous = { time, asOf, final }:
  //   older bar time                         -> drop
  //   same time, previous already final      -> drop
  //   same time, older asOf                   -> drop
  //   same time, asOf >= previous, still open -> emit (may finalize)
  //   newer bar time                         -> emit
  // Rows before snapshot.range.from are always dropped; empty frames vanish.
  // History owns finalized bars; live owns later, still-open bars. A bucket
  // may close between socket acquisition and the HTTP snapshot, so start
  // after history's last close. Being final, that seed never compares asOf:
  // live revisions are ordered independently of the HTTP response time.
  function stitchUpdates(
    key: SeriesKey,
    snapshot: Effect.Success<ReturnType<typeof readSnapshot>>,
    updates: Updates,
  ) {
    let previous: { time: number; asOf: number; final: boolean } | undefined;
    for (let i = snapshot.data.numRows - 1; i >= 0 && !previous; i--) {
      const row = snapshot.data.get(i)!;
      if (row.final)
        previous = { time: row.time, asOf: row.asOf!, final: true };
    }
    // Renew authorization without a chart/Tea reset. Acquire live first, then
    // fill every closed bar since our last observation before draining live.
    //
    // resync -> open/buffer new live -> fetch missing history
    //                                    |
    //                 emit history -> drain live -> same filter above
    const resume = Stream.unwrap(
      Effect.gen(function* () {
        const live = yield* dataset.stream(key);
        const history = yield* dataset.select({
          ...key,
          time: {
            from: previous?.time ?? snapshot.range.from,
            to: yield* Clock.currentTimeMillis,
          },
        });
        return Stream.concat(Stream.succeed(history), live);
      }),
    ).pipe(
      Stream.retry(($) =>
        $(Schedule.spaced("1 second")).pipe(
          Schedule.while(({ input }) => isResync(input)),
        ),
      ),
    );
    return updates.pipe(
      Stream.catchIf(isResync, () => resume),
      Stream.mapError(datasetFailure(providerId)),
      Stream.map((frame) =>
        takeRows(
          frame,
          [...frame].flatMap((row, index) => {
            if (row.time < snapshot.range.from) return [];
            if (
              previous &&
              (row.time < previous.time ||
                (row.time === previous.time &&
                  (row.asOf! < previous.asOf || previous.final)))
            )
              return [];
            previous = {
              time: row.time,
              asOf: row.asOf!,
              final: row.final!,
            };
            return [index];
          }),
        ),
      ),
      Stream.filter((frame) => frame.numRows > 0),
    );
  }

  return {
    getCapabilities: (request) =>
      Effect.succeed(request.listing.id === undefined ? [] : capabilities),
    observe: Effect.fn("OpenChartBars.observe")(function* (
      request: BarsRequest,
    ) {
      const key = yield* resolveSeriesKey(request);
      const updates = yield* openLiveStream(request, key);
      const snapshot = yield* readSnapshot(request, key);
      if (!updates) return { snapshot };
      return { snapshot, updates: stitchUpdates(key, snapshot, updates) };
    }),
  };
}
