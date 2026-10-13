// Purpose: Composes the watchlist Resource and exposes its canonical contract.

import { defineResource } from "@openchart/server/lib/resource/definition";

import { WatchlistEntity } from "./entity";
import { watchlistStore } from "./store";
import { addFormulaColumn } from "./transitions/add-formula-column";
import { configureFormulaColumn } from "./transitions/configure-formula-column";
import { reloadFormulaColumn } from "./transitions/reload-formula-column";

export { semanticTarget } from "./semantic";

export {
  WatchlistColumn,
  WatchlistColumnId,
  WatchlistFormulaBars,
  WatchlistFormulaMetric,
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
 * Watchlists are independent; widgets select them in local view state.
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
    "A named watchlist of provider-scoped listings. Inline columns select price, change, changePercent, volume, priceHistory (an intraday sparkline against the previous close), formula, or semantic research. Formula columns save a complete Tea snapshot, parameterOverrides, output, and bars settings. Use addFormulaColumn/configureFormulaColumn/reloadFormulaColumn to compile and validate settings before saving at expectedRevision; intrinsic create/patch only validate structure. Every column has its own ID, optional title, and shared visible flag; hiding retains configuration. Rows live in ordered sections that nest to any depth; a section without a name has no heading. Each listing and built-in metric appears at most once; Formula and semantic columns may repeat. Calculated values and research answers are never stored. A semantic cell's answer is the final Markdown reply of the Agent Session bound to watchlist:<id>:column:<columnId>:item:<itemId>. Run default:workflows/watchlist-semantic-column.workflow.ts with watchlistId, columnId, prompt and optional itemIds to research current rows.",
  entity: WatchlistEntity,
  store: watchlistStore,
  transitions: {
    addFormulaColumn,
    configureFormulaColumn,
    reloadFormulaColumn,
  },
});

/** The watchlist entity returned by every read. */
export type Watchlist = typeof watchlistResource.entity.Type;
