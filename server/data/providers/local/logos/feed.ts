// Purpose: Adapt bundled logo search into unambiguous consumer resolution.
import { Effect } from "effect";
import {
  datasetAdapter,
  type ProviderFeeds,
} from "@openchart/server/feed/adapter";
import { logos } from "./definition";
/** Search at least two candidates; only a unique match supplies a logo.
 * Unreadable bundled assets are a packaging defect, so they die instead of
 * becoming a public Feed reason.
 */
export const feeds: ProviderFeeds = {
  logos: datasetAdapter(logos, (source) => ({
    getLogo: ({ identifier }) =>
      source.search({ query: identifier, limit: 2 }).pipe(
        Effect.orDie,
        Effect.map((matches) =>
          matches.length === 1
            ? { id: matches[0]!.id, url: matches[0]!.url }
            : null,
        ),
      ),
  })),
};
