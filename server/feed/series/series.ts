// Purpose: Provision series reads from registered Provider adapters.
import { Effect } from "effect";
import type { Dataset } from "@openchart/server/data/dataset";
import { providerFeeds } from "@openchart/server/data/providers";
import { unavailable } from "@openchart/server/feed/errors";
import type { ISeriesFeedService, SeriesSource } from "./service";

const adapters = providerFeeds.flatMap((feeds) =>
  feeds.series ? [feeds.series] : [],
);

/** Construct without resources. An id with no ready source fails unavailable,
 * which also covers a Dataset declared moments ago that Catalog has not published.
 * @example const service = seriesFeed(datasets);
 */
export function seriesFeed(
  datasets: readonly Dataset[] = [],
): ISeriesFeedService {
  const sources = new Map<string, SeriesSource>();
  for (const dataset of datasets)
    for (const adapter of adapters) {
      const source = adapter.adapt(dataset);
      if (source) sources.set(source.id, source);
    }
  return {
    select: ({ id, ...range }) =>
      sources.get(id)?.select(range) ?? Effect.fail(unavailable()),
  };
}
