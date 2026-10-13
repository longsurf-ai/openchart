// Purpose: Persist how one Watchlist placement presents its rows; never Resource data.
import { z } from "zod";
import { persist } from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";
import { METRICS } from "../utils/tree";
import type { Watchlist } from "../api/queries";

const direction = z.enum(["asc", "desc"]);
const viewState = z.object({
  selectedWatchlistId: z.string().optional(),
  collapsed: z.array(z.string()).default([]),
  sort: z
    .object({ columnId: z.string(), direction })
    .nullable()
    .default(null)
    .catch(null),
  // Version 1 named a metric. Resolve it only after the selected list loads.
  legacySort: z.object({ metric: z.enum(METRICS), direction }).optional(),
});

/** One placement's presentation; losing it only returns the view to its default. */
export type WatchlistView = z.infer<typeof viewState>;
/** A placement-scoped view store. */
export type WatchlistViewStore = StoreApi<WatchlistView>;

/** Resolve the old metric sort once the selected list is available. Other local preferences stay intact. @example migrateWatchlistSort(view, watchlist) */
export function migrateWatchlistSort(
  view: WatchlistViewStore,
  watchlist: Watchlist,
) {
  const { legacySort, sort } = view.getState();
  if (legacySort) {
    const column =
      watchlist.columns[
        watchlist.columns.findIndex(
          (item) =>
            item.metric.kind === legacySort.metric && item.visible !== false,
        )
      ];
    view.setState({
      legacySort: undefined,
      sort: column
        ? { columnId: column.id, direction: legacySort.direction }
        : null,
    });
  } else if (
    sort &&
    !watchlist.columns.some(
      (column) => column.id === sort.columnId && column.visible !== false,
    )
  ) {
    view.setState({ sort: null });
  }
}

/** One persisted local store per placement. Version 1 preserves selection and collapsed sections while deferring metric-to-ID resolution. @example const [view] = useState(() => createWatchlistViewStore(placementId)); */
export function createWatchlistViewStore(placementId: string) {
  return createStore<WatchlistView>()(
    persist(() => viewState.parse({}), {
      name: `local:watchlist-widget:${placementId}`,
      version: 2,
      migrate: (saved) => {
        const old = z
          .object({
            selectedWatchlistId: z.string().optional(),
            collapsed: z.array(z.string()).default([]),
            sort: z
              .object({ metric: z.enum(METRICS), direction })
              .nullable()
              .optional()
              .catch(undefined),
          })
          .safeParse(saved);
        return old.success
          ? viewState.parse({
              ...old.data,
              sort: null,
              legacySort: old.data.sort ?? undefined,
            })
          : viewState.parse({});
      },
      merge: (saved, current) => {
        const parsed = viewState.safeParse(saved);
        return parsed.success ? parsed.data : current;
      },
    }),
  );
}
