// Purpose: Expose Feed bar capabilities and finite OHLCV snapshots to the Agent.

import { BarsRequest } from "@openchart/feed";
import { ProviderListing } from "@openchart/market";
import * as Tool from "@openchart/server/agent/tool/tool";
import { Feed } from "@openchart/server/feed/service";
import { Clock, Effect, Schema, Struct } from "effect";
import { MarketDataWindowTooLarge } from "./errors";

const maximumBars = 1_000;
const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const Capabilities = Schema.Struct({
  operation: Schema.Literal("capabilities"),
  ...ProviderListing.fields,
}).annotate(strict);
const Bars = BarsRequest.mapFields(
  (fields) => ({
    ...fields,
    operation: Schema.Literal("bars"),
    countBack: fields.countBack.check(Schema.isLessThanOrEqualTo(maximumBars)),
  }),
  { unsafePreserveChecks: true }, // Range fields and their ordering are unchanged.
).annotate(strict);

/** An object envelope keeps the operation union compatible with native tool SDKs. */
export const Parameters = Schema.Struct({
  request: Schema.Union([Capabilities, Bars]),
}).annotate(strict);

// JSON has no NaN; retain missing cells as null without discarding observations.
function finiteBarValue(value: number | null): number | null {
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads current Feed capabilities or one finite snapshot after permission.
 * `now` becomes a numeric cutoff before observation; the scoped call releases
 * the source before returning. Feed failures and cancellation propagate unchanged.
 * Output projects OHLCV into JSON with null gaps; oversized windows fail intact.
 * @example
 * const tool = yield* Tool.init(yield* MarketDataTool);
 * yield* tool.execute({request: {
 *   operation: 'bars', provider: 'yfinance',
 *   listing: {symbol: 'AAPL', currency: 'USD'},
 *   resolution: '1d', session: 'regular', adjustment: 'split',
 *   from: 1_700_000_000_000, to: 'now', countBack: 1,
 * }}, context);
 */
export const MarketDataTool = Tool.define(
  "market_data",
  Effect.succeed({
    description: `Read market bar data through Feed. Supply {request: {...}}. Use operation: 'capabilities' with provider and listing to discover supported resolution/session/adjustment combinations and delivery modes. Use operation: 'bars' with the same provider and listing plus resolution, session, adjustment, from, to and countBack. Copy provider and listing from symbology_search or a saved chart; preserve their source identity. Times are epoch milliseconds; from is inclusive and numeric to is exclusive. to: 'now' returns one finite snapshot, without a subscription. countBack (1–${maximumBars}) is a minimum: the complete window is returned, extended backwards when needed. More than ${maximumBars} returned bars fails; shorten the window or use a coarser resolution. The result includes series, inspected range, hasMoreBefore and ascending OHLCV bars; missing cells are null. Empty bars is valid. The cutoff is not a freshness guarantee, and the latest candle may still be forming. Capabilities describe source delivery modes; do not assume real-time quotes or a fixed delay. Source errors fail the call.`,
    parameters: Parameters,
    execute: Effect.fn("MarketData.execute")(function* (
      { request }: typeof Parameters.Type,
      context: Tool.Context,
    ): Effect.fn.Return<Tool.ExecuteResult, unknown, Feed> {
      yield* context.ask({
        permission: "market_data",
        patterns: [`${request.provider}:${request.listing.symbol}`],
        always: ["*"],
        metadata: request,
      });
      const { bars } = yield* (yield* Feed).get();
      if (request.operation === "capabilities") {
        const identity = Struct.omit(request, ["operation"]);
        const capabilities = yield* bars.getCapabilities(identity);
        return {
          title: `Market data capabilities: ${request.listing.symbol}`,
          metadata: {},
          output: {
            type: "json" as const,
            value: { ...identity, capabilities },
          },
        };
      }
      const input = Struct.omit(request, ["operation"]);
      const to = input.to === "now" ? yield* Clock.currentTimeMillis : input.to;
      const { snapshot } = yield* Effect.scoped(bars.observe({ ...input, to }));
      if (snapshot.data.numRows > maximumBars)
        return yield* Effect.fail(
          new MarketDataWindowTooLarge({
            bars: snapshot.data.numRows,
            maximum: maximumBars,
          }),
        );
      const series = Struct.omit(input, ["from", "to", "countBack"]);
      return {
        title: `Market data: ${request.listing.symbol}`,
        metadata: {},
        output: {
          type: "json" as const,
          value: {
            series,
            range: snapshot.range,
            hasMoreBefore: snapshot.hasMoreBefore,
            bars: Array.from(snapshot.data, (row) => ({
              time: row.time,
              open: finiteBarValue(row.open),
              high: finiteBarValue(row.high),
              low: finiteBarValue(row.low),
              close: finiteBarValue(row.close),
              volume: finiteBarValue(row.volume),
            })),
          },
        },
      };
    }),
  }),
);
