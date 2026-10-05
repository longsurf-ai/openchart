// Purpose: Adapt binance listings without rewriting source identity.
import { Effect } from "effect";
import type { RowOf } from "@openchart/server/data/dataset";
import type { ProviderId } from "@openchart/market";
import type { Dataset } from "@openchart/server/data/dataset";
import { datasetFailure } from "@openchart/server/feed/errors";
import type { SymbologySource } from "@openchart/server/feed/symbology/service";
import { binanceSymbology } from "@openchart/server/data/providers/binance/datasets/definitions/symbology";
/** Map native pairs to consumer listings; provenance is not inferred from symbols.
 * @example const symbols = binanceSymbologyFeed(dataset, providerId);
 */
export function binanceSymbologyFeed(
  dataset: Dataset<typeof binanceSymbology>,
  providerId: ProviderId,
): SymbologySource {
  const adapt = (rows: readonly RowOf<typeof binanceSymbology>[]) =>
    rows
      .filter((row) => row.status === "TRADING")
      .map((row) => ({
        provider: providerId,
        listing: {
          symbol: row.symbol,
          name: `${row.baseAsset} / ${row.quoteAsset}`,
          class: "crypto" as const,
          venue: "Binance",
          currency: row.quoteAsset,
        },
      }));
  return {
    providerId,
    search: (request) =>
      dataset
        .search({ query: request.query })
        .pipe(Effect.mapError(datasetFailure(providerId)), Effect.map(adapt)),
    select: (filter) =>
      dataset
        .select(filter)
        .pipe(Effect.mapError(datasetFailure(providerId)), Effect.map(adapt)),
  };
}
