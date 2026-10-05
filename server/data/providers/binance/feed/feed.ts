// Purpose: Declare all binance Feed bindings beside their Dataset implementations.
import { ProviderId } from "@openchart/market";
import {
  datasetAdapter,
  type ProviderFeeds,
} from "@openchart/server/feed/adapter";
import {
  binanceBars,
  binanceSymbology,
} from "@openchart/server/data/providers/binance/datasets/definitions";
import { binanceBarsFeed } from "./bars";
import { binanceSymbologyFeed } from "./symbology";
const providerId = ProviderId.make("binance");
/** Exact declarations and static capabilities, available before activation. */
export const feeds: ProviderFeeds = {
  bars: datasetAdapter(binanceBars, (dataset) => ({
    provider: providerId,
    feed: binanceBarsFeed(dataset, providerId),
  })),
  symbology: {
    ...datasetAdapter(binanceSymbology, (dataset) =>
      binanceSymbologyFeed(dataset, providerId),
    ),
    providerId,
    indexable: true,
  },
};
