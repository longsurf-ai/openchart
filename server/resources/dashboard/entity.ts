// Purpose: Derives the dashboard domain entity from its database columns and widget rows.

import { defineId } from "@openchart/identifier";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { withInvariants } from "@openchart/server/lib/resource/invariant";
import { ChartId } from "@openchart/server/resources/chart";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Effect, Schema } from "effect";

import {
  DASHBOARD_NAME_MAX_LENGTH,
  DASHBOARD_NAME_MIN_LENGTH,
  DASHBOARD_COLUMNS,
  dashboardTable,
  dashboardWidgetTable,
} from "./schema";

const dashboardColumns = createSelectSchema(dashboardTable);
const widgetColumns = createSelectSchema(dashboardWidgetTable, {
  kind: (schema) => schema.check(Schema.isMinLength(1)),
  resourceId: (schema) => schema.check(Schema.isMinLength(1)),
  x: (schema) => schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  y: (schema) => schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  w: (schema) => schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  h: (schema) => schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});

/** Branded dashboard identifier with the `dsh_` prefix. */
export const DashboardId = defineId("dsh", "Dashboard.ID");

/** Branded dashboard identifier with the `dsh_` prefix. */
export type DashboardId = typeof DashboardId.Type;

/** Branded widget placement identifier with the `wdg_` prefix. */
export const WidgetPlacementId = defineId("wdg", "WidgetPlacement.ID");

/** Integer rectangle in the dashboard's canonical twelve-column grid. */
export const WidgetLayout = withInvariants(
  Schema.Struct({
    x: widgetColumns.fields.x,
    y: widgetColumns.fields.y,
    w: widgetColumns.fields.w,
    h: widgetColumns.fields.h,
  }),
  (invariant) => [
    invariant(
      "Widgets must fit within the dashboard columns",
      (layout, { expect }) => {
        expect(layout.x + layout.w <= DASHBOARD_COLUMNS, { path: ["w"] }).toBe(
          true,
        );
      },
      { code: "dashboard.layout_width" },
    ),
  ],
);

/**
 * One widget placed on a dashboard.
 *
 * `kind` names the WidgetDefinition the app renders. `resourceId` is a
 * reference, never ownership: each Resource defines its own lifecycle. Chart
 * placements require the matching identity, even if its target has since
 * disappeared. Workspace shows all registered directories and needs no target.
 * Other widget kinds remain open and may need no target.
 */
export const WidgetPlacement = withInvariants(
  Schema.Struct({
    id: WidgetPlacementId,
    kind: widgetColumns.fields.kind,
    // NULL in storage is represented by an omitted reference in the entity.
    resourceId: Schema.optionalKey(widgetColumns.fields.resourceId.members[0]),
    layout: WidgetLayout,
  }),
  (invariant) => [
    invariant(
      "Chart widgets must reference a Chart ID (cht_)",
      (widget, { expect }) => {
        if (widget.kind === "chart")
          expect(Schema.is(ChartId)(widget.resourceId), {
            path: ["resourceId"],
          }).toBe(true);
      },
      { code: "dashboard.chart_reference" },
    ),
  ],
);

/** One widget placed on a dashboard. */
export type WidgetPlacement = typeof WidgetPlacement.Type;

/**
 * The complete runtime dashboard entity, including its server-managed envelope.
 *
 * Placements own outer geometry; charts independently own their inner grid.
 */
export const DashboardEntity = withInvariants(
  Schema.Struct({
    ...envelopeFields(DashboardId),
    name: dashboardColumns.fields.name.check(
      Schema.isMinLength(DASHBOARD_NAME_MIN_LENGTH),
      Schema.isMaxLength(DASHBOARD_NAME_MAX_LENGTH),
    ),
    favorite: dashboardColumns.fields.favorite.pipe(
      Schema.withDecodingDefault(
        Effect.succeed(
          Schema.decodeUnknownSync(dashboardColumns.fields.favorite)(
            dashboardTable.favorite.default,
          ),
        ),
      ),
    ),
    widgets: Schema.Array(WidgetPlacement).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
  }),
  (invariant) => [
    invariant(
      "A dashboard may contain at most one workspace widget",
      (dashboard, { expect }) => {
        expect(
          dashboard.widgets.filter(({ kind }) => kind === "workspace").length <=
            1,
          { path: ["widgets"] },
        ).toBe(true);
      },
      { code: "dashboard.one_workspace" },
    ),
    invariant(
      "Widget placement ids must be unique",
      (dashboard, { expect }) => {
        const ids = new Set<string>();
        dashboard.widgets.forEach((widget, index) => {
          expect(ids.has(widget.id), { path: ["widgets", index, "id"] }).toBe(
            false,
          );
          ids.add(widget.id);
        });
      },
      { code: "dashboard.unique_widget_ids" },
    ),
    invariant(
      "Widget rectangles must not overlap",
      (dashboard, { expect }) => {
        dashboard.widgets.forEach(({ layout: current }, index) => {
          const overlaps = dashboard.widgets
            .slice(0, index)
            .some(
              ({ layout: other }) =>
                current.x < other.x + other.w &&
                current.x + current.w > other.x &&
                current.y < other.y + other.h &&
                current.y + current.h > other.y,
            );
          expect(overlaps, { path: ["widgets", index, "layout"] }).toBe(false);
        });
      },
      { code: "dashboard.layout_overlap" },
    ),
  ],
);

/** The complete runtime dashboard entity. */
export type DashboardEntity = typeof DashboardEntity.Type;
