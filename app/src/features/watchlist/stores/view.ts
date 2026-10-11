// Purpose: Persist how one Watchlist placement presents its rows; never Resource data.
import { z } from "zod";
import { persist } from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";
import { METRICS } from "../utils/tree";

const viewState = z.object({
  /** The list this placement last showed; clearing storage forgets the choice. */
  selectedWatchlistId: z.string().optional(),
  /** Named sections this placement shows collapsed; others stay expanded. */
  collapsed: z.array(z.string()).default([]),
  /** Rows sort by one metric inside each section; null keeps saved order. */
  sort: z
    .object({
      metric: z.enum(METRICS),
      direction: z.enum(["asc", "desc"]),
    })
    .nullable()
    .default(null),
});

/** One placement's presentation; losing it only returns the view to its default. */
export type WatchlistView = z.infer<typeof viewState>;

/** A placement-scoped view store. */
export type WatchlistViewStore = StoreApi<WatchlistView>;

/** One persisted local store per placement; invalid saved state resets to defaults. @example const [view] = useState(() => createWatchlistViewStore(placementId)); */
export function createWatchlistViewStore(placementId: string) {
  return createStore<WatchlistView>()(
    persist(() => viewState.parse({}), {
      name: `local:watchlist-widget:${placementId}`,
      version: 1,
      merge: (saved, current) => {
        const parsed = viewState.safeParse(saved);
        return parsed.success ? parsed.data : current;
      },
    }),
  );
}
