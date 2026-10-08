// Purpose: Provision calendars by native provider identity.
import { Effect } from "effect";
import type { ProviderId } from "@openchart/market";
import type { Dataset } from "@openchart/server/data/dataset";
import { providerFeeds } from "@openchart/server/data/providers";
import { adaptDataset } from "@openchart/server/feed/adapter";
import { unavailable } from "@openchart/server/feed/errors";
import type { ICalendarFeedService } from "./service";
const adapters = providerFeeds.map((feeds) => feeds.calendar);

/** Route each request to its own provider's calendar; never another provider's.
 * Construction acquires no resources. Duplicate routes are wiring defects.
 * @example const service = calendarFeed(datasets);
 */
export function calendarFeed(
  datasets: readonly Dataset[] = [],
): ICalendarFeedService {
  const routes = new Map<ProviderId, ICalendarFeedService>();
  for (const dataset of datasets) {
    const source = adaptDataset(adapters, dataset);
    if (!source) continue;
    if (routes.has(source.provider))
      throw new Error(
        `More than one Calendar Dataset routes provider ${source.provider}.`,
      );
    routes.set(source.provider, source.feed);
  }
  return {
    getCalendar: (request) =>
      routes.get(request.provider)?.getCalendar(request) ??
      Effect.fail(unavailable(request.provider)),
  };
}
