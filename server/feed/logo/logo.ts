// Purpose: Provision logo resolution from registered Provider adapters.
import { Effect } from "effect";
import type { Dataset } from "@openchart/server/data/dataset";
import { providerFeeds } from "@openchart/server/data/providers";
import { adaptDataset } from "@openchart/server/feed/adapter";
import { unavailable } from "@openchart/server/feed/errors";
import type { ILogosFeedService } from "./service";
const adapters = providerFeeds.map((feeds) => feeds.logos);
/** Construct without resources; an absent source fails unavailable.
 * @example const service = logosFeed(datasets);
 */
export function logosFeed(
  datasets: readonly Dataset[] = [],
): ILogosFeedService {
  for (const dataset of datasets) {
    const source = adaptDataset(adapters, dataset);
    if (source) return source;
  }
  return { getLogo: () => Effect.fail(unavailable()) };
}
