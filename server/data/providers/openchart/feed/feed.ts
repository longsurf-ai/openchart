// Purpose: Declare all openchart Feed bindings beside their Dataset implementations.
import { ProviderId } from "@openchart/market";
import {
  datasetAdapter,
  type ProviderFeeds,
} from "@openchart/server/feed/adapter";
import {
  openchartBars,
  openchartSymbology,
} from "@openchart/server/data/providers/openchart/datasets/definitions";
import { openchartBarsFeed } from "./bars";
import { openchartSymbologyFeed } from "./symbology";
const providerId = ProviderId.make("openchart");
/** Exact declarations and static capabilities, available before activation. */
export const feeds: ProviderFeeds = {
  bars: datasetAdapter(openchartBars, (dataset) => ({
    provider: providerId,
    feed: openchartBarsFeed(dataset, providerId),
  })),
  symbology: {
    ...datasetAdapter(openchartSymbology, (dataset) =>
      openchartSymbologyFeed(dataset, providerId),
    ),
    providerId,
    indexable: false,
  },
};
