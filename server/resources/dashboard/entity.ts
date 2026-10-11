// Purpose: Derives the dashboard domain entity from its database columns and widget rows.

import { defineId } from "@openchart/identifier";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { withInvariants } from "@openchart/server/lib/resource/invariant";
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
 * `kind` names the WidgetDefinition the app renders. Widgets resolve their own
 * content; placements describe only identity, kind and outer geometry.
 */
export const WidgetPlacement = Schema.Struct({
  id: WidgetPlacementId,
  kind: widgetColumns.fields.kind,
  layout: WidgetLayout,
});

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
      "A dashboard may contain at most one widget of each kind",
      (dashboard, { expect }) => {
        const kinds = new Set<string>();
        dashboard.widgets.forEach((widget, index) => {
          expect(kinds.has(widget.kind), {
            path: ["widgets", index, "kind"],
          }).toBe(false);
          kinds.add(widget.kind);
        });
      },
      { code: "dashboard.unique_widget_kinds" },
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
