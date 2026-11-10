// Purpose: Declare all yfinance Feed bindings beside their Dataset implementations.
import { ProviderId } from "@openchart/market";
import {
  datasetAdapter,
  type ProviderFeeds,
} from "@openchart/server/feed/adapter";
import {
  yfinanceBars,
  yfinanceCalendar,
  yfinanceSymbology,
} from "@openchart/server/data/providers/yfinance/datasets/definitions";
import { yfinanceBarsFeed } from "./bars";
import { yfinanceCalendarFeed } from "./calendar";
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
  calendar: datasetAdapter(yfinanceCalendar, (dataset) => ({
    provider: providerId,
    feed: yfinanceCalendarFeed(dataset, providerId),
  })),
};
