// Purpose: Resolves a research cell's listing context; answers stay in the cell's bound Agent Session.
import type { WatchlistEntity, WatchlistSection } from "./entity";

function findRow(
  sections: readonly WatchlistSection[],
  itemId: string,
  path: readonly string[] = [],
):
  | (Omit<WatchlistSection["items"][number], "id"> & {
      itemId: string;
      groupPath: readonly string[];
    })
  | undefined {
  for (const section of sections) {
    const groupPath = section.name ? [...path, section.name] : path;
    const item = section.items.find((item) => item.id === itemId);
    if (item)
      return {
        itemId,
        provider: item.provider,
        listing: item.listing,
        groupPath,
      };
    const nested = findRow(section.sections, itemId, groupPath);
    if (nested) return nested;
  }
}
/**
 * Resolves a research cell's listing context from a read Watchlist. Pure and
 * synchronous; returns undefined once the column or row is deleted or the
 * column is no longer semantic. The workflow owns the answer contract.
 * @example const row = semanticTarget(watchlist, "wcl_a", "wit_a");
 */
export function semanticTarget(
  watchlist: WatchlistEntity,
  columnId: string,
  itemId: string,
) {
  const column = watchlist.columns.find((column) => column.id === columnId);
  if (column?.metric.kind !== "semantic") return undefined;
  return findRow(watchlist.sections, itemId);
}
