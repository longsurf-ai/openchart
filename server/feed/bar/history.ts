// Purpose: Fetch a complete window and enough earlier observations to prove countBack and exhaustion.
import { Clock, Effect } from "effect";
import { FeedReasons, type BarsRequest, type FeedError } from "@openchart/feed";
import { feedError } from "@openchart/server/feed/errors";
import {
  concatFrames,
  takeRows,
  type DataFrame,
  type DataFrameSpec,
} from "@openchart/timeseries";

/** Read a window without truncation, plus a backwards count and one excluded probe.
 * Native observation metadata is retained for the adapter's snapshot/live ordering.
 * @example const history = yield* readBarsHistory(request, select);
 */
export const readBarsHistory = Effect.fn("Bars.readHistory")(function* <
  S extends DataFrameSpec,
>(
  request: BarsRequest,
  select: (bounds: {
    from?: number;
    to: number;
    count?: number;
  }) => Effect.Effect<DataFrame<S>, FeedError>,
) {
  const now = yield* Clock.currentTimeMillis;
  const to = request.to === "now" ? now : Math.min(request.to, now);
  if (request.from >= to)
    return yield* Effect.fail(
      feedError(
        new FeedReasons.InvalidRequest({
          detail: "Bars from must precede the snapshot cutoff",
        }),
      ),
    );
  // Start both native reads together so retirement does not admit a new read
  // only after the first accepted one finishes. Overfetch is bounded by countBack.
  const [window, before] = yield* Effect.all(
    [
      select({ from: request.from, to }),
      select({ to: request.from, count: request.countBack + 1 }),
    ],
    { concurrency: "unbounded" },
  );
  const needed = Math.max(0, request.countBack - window.numRows);
  const start = Math.max(0, before.numRows - needed);
  const prefix = takeRows(
    before,
    Array.from({ length: before.numRows - start }, (_, index) => start + index),
  );
  return {
    range: { from: prefix.get(0)?.time ?? request.from, to },
    data: prefix.numRows ? concatFrames(prefix, window) : window,
    hasMoreBefore: before.numRows > needed,
  };
});
