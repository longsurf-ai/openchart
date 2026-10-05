// Purpose: Maps dashboard metadata and ordered widget rows within the Transactor's transaction.

import type {
  Row,
  Store,
  StoreBody,
  Tx,
} from "@openchart/server/lib/resource/store";
import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { DashboardEntity } from "./entity";
import { dashboardTable, dashboardWidgetTable } from "./schema";

type DashboardRow = typeof dashboardTable.$inferSelect;
type WidgetRow = typeof dashboardWidgetTable.$inferSelect;
type DashboardWrite = StoreBody<typeof DashboardEntity>;

function toRow(dashboard: DashboardRow, widgets: readonly WidgetRow[]): Row {
  return {
    id: dashboard.id,
    revision: dashboard.revision,
    createdAt: dashboard.createdAt,
    updatedAt: dashboard.updatedAt,
    body: {
      name: dashboard.name,
      favorite: dashboard.favorite,
      widgets: [...widgets]
        .sort((left, right) => left.position - right.position)
        .map((widget) => ({
          id: widget.id,
          kind: widget.kind,
          layout: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
          ...(widget.resourceId === null
            ? {}
            : { resourceId: widget.resourceId }),
        })),
    },
  };
}

function insertWidgets(
  tx: Tx,
  dashboardId: string,
  widgets: DashboardWrite["widgets"],
) {
  if (widgets.length === 0) return Effect.succeed<WidgetRow[]>([]);
  return tx
    .insert(dashboardWidgetTable)
    .values(
      widgets.map((widget, position) => ({
        id: widget.id,
        dashboardId,
        position,
        kind: widget.kind,
        resourceId: widget.resourceId ?? null,
        ...widget.layout,
      })),
    )
    .returning();
}

/**
 * Persists one dashboard across its metadata and widget tables. Widget order
 * is the array index, and every widget change shares the dashboard revision.
 * All operations use the caller's transaction; stored values are decoded by
 * shared Resource transitions, while write types derive from DashboardEntity's annotations.
 */
export const dashboardStore: Store<DashboardWrite> = {
  load: (tx, id) =>
    Effect.gen(function* () {
      const dashboard = yield* tx
        .select()
        .from(dashboardTable)
        .where(eq(dashboardTable.id, id))
        .get();
      if (!dashboard) return undefined;
      const widgets = yield* tx
        .select()
        .from(dashboardWidgetTable)
        .where(eq(dashboardWidgetTable.dashboardId, id));
      return toRow(dashboard, widgets);
    }),
  list: (tx, _filter, window) =>
    Effect.gen(function* () {
      const page = listWindowSql(dashboardTable, window);
      const dashboards = yield* tx
        .select()
        .from(dashboardTable)
        .where(page.where)
        .orderBy(...page.orderBy)
        .limit(page.limit);
      if (!dashboards.length) return [];
      const widgets = yield* tx
        .select()
        .from(dashboardWidgetTable)
        .where(
          inArray(
            dashboardWidgetTable.dashboardId,
            dashboards.map((row) => row.id),
          ),
        );
      const grouped = new Map<string, WidgetRow[]>();
      for (const widget of widgets) {
        const group = grouped.get(widget.dashboardId);
        if (group) group.push(widget);
        else grouped.set(widget.dashboardId, [widget]);
      }
      return dashboards.map((dashboard) =>
        toRow(dashboard, grouped.get(dashboard.id) ?? []),
      );
    }),
  insert: (tx, input) =>
    Effect.gen(function* () {
      const dashboard = yield* tx
        .insert(dashboardTable)
        .values({
          id: input.id,
          revision: input.revision,
          name: input.body.name,
          favorite: input.body.favorite,
        })
        .returning()
        .get();
      if (!dashboard)
        return yield* Effect.die("Dashboard insert returned no row");
      const widgets = yield* insertWidgets(tx, input.id, input.body.widgets);
      return toRow(dashboard, widgets);
    }),
  save: (tx, id, input) =>
    Effect.gen(function* () {
      const dashboard = yield* tx
        .update(dashboardTable)
        .set({
          name: input.body.name,
          favorite: input.body.favorite,
          revision: input.revision,
        })
        .where(eq(dashboardTable.id, id))
        .returning()
        .get();
      if (!dashboard)
        return yield* Effect.die(`Dashboard ${id} disappeared during save`);
      // Replacing within the same transaction avoids transient unique-position
      // collisions when an RFC 6902 move swaps existing widget positions.
      yield* tx
        .delete(dashboardWidgetTable)
        .where(eq(dashboardWidgetTable.dashboardId, id));
      const widgets = yield* insertWidgets(tx, id, input.body.widgets);
      return toRow(dashboard, widgets);
    }),
  remove: (tx, id) =>
    tx
      .delete(dashboardTable)
      .where(eq(dashboardTable.id, id))
      .pipe(Effect.asVoid),
};
