// Purpose: The dashboard Resource's single entry point for the server composition root.

import { defineResource } from "@openchart/server/lib/resource/definition";

import { DashboardEntity } from "./entity";
import { dashboardStore } from "./store";

export {
  DashboardEntity,
  DashboardId,
  WidgetPlacement,
  WidgetPlacementId,
  WidgetLayout,
} from "./entity";

/**
 * The dashboard Resource: the complete {@link DashboardEntity}, persisted by
 * its own store over `dashboard` and `dashboard_widget`, exposed as the
 * `resources.dashboard` tRPC router.
 *
 * @example
 * ```ts
 * const resources = trpc.router({dashboard: resourceRouter(dashboardResource)});
 * const router = trpc.router({resources});
 * ```
 */
export const dashboardResource = defineResource({
  name: "dashboard",
  description:
    "A saved dashboard with a name, favorite status, and widget placements. Each placement is {id: 'wdg_…', kind, layout: {x, y, w, h}} in a 12-column grid, and each kind appears at most once. Built-in kinds are chart, workspace and watchlist; saved custom widgets use custom:<kind>. Chart contents are stored in separate Chart Resources.",
  entity: DashboardEntity,
  store: dashboardStore,
});

/** The dashboard entity returned by every read. */
export type Dashboard = typeof dashboardResource.entity.Type;
