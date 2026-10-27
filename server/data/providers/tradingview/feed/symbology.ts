// Purpose: Adapt TradingView listings without rewriting their native identity.

import { Effect } from "effect";
import type { AssetClass, ProviderId } from "@openchart/market";
import type { Dataset } from "@openchart/server/data/dataset";
import { datasetFailure } from "@openchart/server/feed/errors";
import type { SymbologySource } from "@openchart/server/feed/symbology/service";
import { tradingviewSymbology } from "@openchart/server/data/providers/tradingview/datasets/definitions";

/** Maps TradingView's instrument types and type specs to consumer asset classes.
 * @example assetClass("fund", ["etf"]); // "etf"
 */
export function assetClass(
  type: string,
  typespecs: readonly string[] = [],
): AssetClass {
  const specs = new Set(typespecs);
  if (specs.has("etf")) return "etf";
  if (specs.has("crypto") && ["spot", "swap", "crypto"].includes(type))
    return "crypto";
  switch (type) {
    case "stock":
    case "dr":
    case "common":
      return "stock";
    case "fund":
      return "fund";
    case "index":
      return "index";
    case "spot":
    case "crypto":
      return "crypto";
    case "future":
    case "futures":
    case "swap":
      return "future";
    case "forex":
    case "currency":
      return "forex";
    case "commodity":
      return "commodity";
    case "bond":
      return "bond";
    case "option":
      return "option";
    case "prediction":
      return "prediction";
    default:
      return "other";
  }
}

/** Preserve TradingView symbols and exchange codes; map only the asset class.
 * @example const symbols = tradingviewSymbologyFeed(dataset, providerId);
 */
export function tradingviewSymbologyFeed(
  dataset: Dataset<typeof tradingviewSymbology>,
  providerId: ProviderId,
): SymbologySource {
  return {
    providerId,
    search: (request) =>
      // A family can expand to hundreds of contracts. The merged Feed owns
      // ranking, asset-class filtering and the result limit after adaptation.
      dataset.search({ query: request.query }).pipe(
        Effect.mapError(datasetFailure(providerId)),
        Effect.map((rows) =>
          rows.map((row) => ({
            provider: providerId,
            listing: {
              symbol: row.symbol,
              name: row.name,
              class: assetClass(row.type, row.typespecs),
              venue: row.exchange,
              currency: row.currency,
              ...(row.primary === true ? { primary: true } : {}),
            },
          })),
        ),
      ),
  };
}
