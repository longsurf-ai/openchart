// Purpose: Declare all yfinance Feed bindings beside their Dataset implementations.
import { ProviderId } from "@openchart/market";
import {
  datasetAdapter,
  type ProviderFeeds,
} from "@openchart/server/feed/adapter";
import {
  yfinanceBars,
  yfinanceSymbology,
} from "@openchart/server/data/providers/yfinance/datasets/definitions";
import { yfinanceBarsFeed } from "./bars";
import { yfinanceSymbologyFeed } from "./symbology";
const providerId = ProviderId.make("yfinance");
/** Exact declarations and static capabilities, available before activation. */
export const feeds: ProviderFeeds = {
  bars: datasetAdapter(yfinanceBars, (dataset) => ({
    provider: providerId,
    feed: yfinanceBarsFeed(dataset, providerId),
  })),
  symbology: {
    ...datasetAdapter(yfinanceSymbology, (dataset) =>
      yfinanceSymbologyFeed(dataset, providerId),
    ),
    providerId,
    indexable: false,
  },
};
