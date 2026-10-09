// Purpose: Composes the watchlist Resource and exposes its canonical contract.

import { defineResource } from "@openchart/server/lib/resource/definition";

import { WatchlistEntity } from "./entity";
import { watchlistStore } from "./store";

export {
  WatchlistColumn,
  WatchlistColumnId,
  WatchlistEntity,
  WatchlistId,
  WatchlistItem,
  WatchlistItemId,
  WatchlistMetric,
  WatchlistSection,
  WatchlistSectionId,
} from "./entity";

/**
 * The watchlist Resource: the complete {@link WatchlistEntity}, persisted by
 * its own store over `watchlist`, `watchlist_section`, and `watchlist_item`,
 * exposed as the `resources.watchlist` tRPC router and to Agent Resource tools.
 * Watchlists are independent; Dashboards only reference them.
 *
 * @example
 * ```ts
 * const created = yield* Transactor.run(
 *   watchlistResource.transitions.create({name: 'Tech'}),
 * );
 * ```
 */
export const watchlistResource = defineResource({
  name: "watchlist",
  description:
    "A named watchlist of provider-scoped listings. Columns choose the market metrics shown for every row: price, change, changePercent, or volume. Rows live in ordered sections that nest to any depth; a section without a name has no heading. Each listing appears at most once per watchlist. Market values come from Feed and are never stored.",
  entity: WatchlistEntity,
  store: watchlistStore,
});

/** The watchlist entity returned by every read. */
export type Watchlist = typeof watchlistResource.entity.Type;
