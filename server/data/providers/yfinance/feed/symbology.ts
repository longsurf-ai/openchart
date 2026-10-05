// Purpose: Adapt yfinance listings without rewriting source identity.
import { Effect } from "effect";
import type { AssetClass, ProviderId } from "@openchart/market";
import type { Dataset } from "@openchart/server/data/dataset";
import { datasetFailure } from "@openchart/server/feed/errors";
import type { SymbologySource } from "@openchart/server/feed/symbology/service";
import { yfinanceSymbology } from "@openchart/server/data/providers/yfinance/datasets/definitions/symbology";
/** Preserve source-native Yahoo identities and map only asset classification.
 * @example const symbols = yfinanceSymbologyFeed(dataset, providerId);
 */
export function yfinanceSymbologyFeed(
  dataset: Dataset<typeof yfinanceSymbology>,
  providerId: ProviderId,
): SymbologySource {
  const classes: Record<string, AssetClass> = {
    EQUITY: "stock",
    ETF: "etf",
    INDEX: "index",
    CRYPTOCURRENCY: "crypto",
    CURRENCY: "forex",
    FUTURE: "future",
    OPTION: "option",
  };
  return {
    providerId,
    search: (request) =>
      dataset.search({ query: request.query }).pipe(
        Effect.mapError(datasetFailure(providerId)),
        Effect.map((rows) =>
          rows.map((row) => ({
            provider: providerId,
            listing: {
              symbol: row.symbol,
              name: row.longname ?? row.shortname,
              class: classes[row.quoteType] ?? "other",
              venue: row.exchange,
              currency: row.currency,
            },
          })),
        ),
      ),
  };
}
