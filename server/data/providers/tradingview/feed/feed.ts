// Purpose: Declare all TradingView Feed bindings beside their Dataset implementations.

import { ProviderId } from "@openchart/market";
import {
  datasetAdapter,
  type ProviderFeeds,
} from "@openchart/server/feed/adapter";
import {
  tradingviewBars,
  tradingviewSymbology,
} from "@openchart/server/data/providers/tradingview/datasets/definitions";
import { tradingviewBarsFeed } from "./bars";
import { tradingviewSymbologyFeed } from "./symbology";

const providerId = ProviderId.make("tradingview");

/** Exact declarations and static capabilities, available before activation. */
export const feeds: ProviderFeeds = {
  bars: datasetAdapter(tradingviewBars, (dataset) => ({
    provider: providerId,
    feed: tradingviewBarsFeed(dataset, providerId),
  })),
  symbology: {
    ...datasetAdapter(tradingviewSymbology, (dataset) =>
      tradingviewSymbologyFeed(dataset, providerId),
    ),
    providerId,
    indexable: false,
  },
};
