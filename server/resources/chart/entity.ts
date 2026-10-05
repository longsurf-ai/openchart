// Purpose: Derives the complete chart grid entity and validates its internal display bindings.

import { defineId } from "@openchart/identifier";
import { Listing, ProviderId } from "@openchart/market";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { listKey } from "@openchart/server/lib/resource/annotation";
import {
  withInvariants,
  type Path,
} from "@openchart/server/lib/resource/invariant";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Effect, Schema } from "effect";

import {
  CHART_MARKET_OUTPUTS,
  CHART_RESOLUTIONS,
  chartCellTable,
  chartLinkTable,
  chartMarketSourceTable,
  chartPaneTable,
  chartSeriesTable,
  chartTable,
} from "./schema";

/** Identifier of an entire chart grid, with the `cht_` prefix. */
export const ChartId = defineId("cht", "Chart.ID");

/** Identifier of an entire chart grid. */
export type ChartId = typeof ChartId.Type;

/** Identifier of a cell inside a chart grid, with the `ccl_` prefix. */
export const ChartCellId = defineId("ccl", "ChartCell.ID");

/** Identifier of an explicit pane inside a cell, with the `cpn_` prefix. */
export const ChartPaneId = defineId("cpn", "ChartPane.ID");

/** Identifier of a cell's market input, with the `cms_` prefix. */
export const ChartMarketSourceId = defineId("cms", "ChartMarketSource.ID");

/** Identifier of a pane's display binding, with the `csr_` prefix. */
export const ChartSeriesId = defineId("csr", "ChartSeries.ID");

/** Identifier of a directed cell link, with the `clk_` prefix. */
export const ChartLinkId = defineId("clk", "ChartLink.ID");

const chartColumns = createSelectSchema(chartTable);
const cellColumns = createSelectSchema(chartCellTable, { id: ChartCellId });
const paneColumns = createSelectSchema(chartPaneTable, { id: ChartPaneId });
const marketSourceColumns = createSelectSchema(chartMarketSourceTable, {
  id: ChartMarketSourceId,
  provider: ProviderId,
  listing: Listing,
});
const seriesColumns = createSelectSchema(chartSeriesTable, {
  id: ChartSeriesId,
  marketSourceId: () => ChartMarketSourceId,
  // An Indicator Resource named by value; its Resource owns the ID shape.
  indicatorId: () => Schema.NonEmptyString,
  output: (schema) => schema.check(Schema.isMinLength(1)),
});
const linkColumns = createSelectSchema(chartLinkTable, {
  id: ChartLinkId,
  fromCellId: ChartCellId,
  toCellId: ChartCellId,
});

function withColumnDefault<S extends Schema.Codec<unknown>>(
  schema: S,
  column: AnySQLiteColumn,
) {
  return schema.pipe(
    Schema.withDecodingDefaultType<S>(
      Effect.succeed(Schema.decodeUnknownSync(schema)(column.default)),
    ),
  );
}

/** A provider-scoped listing; resolution, session, and adjustment come from its cell. */
export const ChartMarketSource = Schema.Struct({
  id: marketSourceColumns.fields.id,
  provider: marketSourceColumns.fields.provider,
  listing: marketSourceColumns.fields.listing,
});

/** A selected listing inside a chart cell. */
export type ChartMarketSource = typeof ChartMarketSource.Type;

const normalRole = withColumnDefault(
  seriesColumns.fields.role.pick(["normal"]),
  chartSeriesTable.role,
);
const [priceOutput, volumeOutput, volumeProfileOutput] = CHART_MARKET_OUTPUTS;

/**
 * One display binding. Storage's exclusive nullable source columns become a
 * tagged union. `output` names what the binding draws from its source: a
 * market source's price, volume or volume profile, or an indicator's stable
 * output name. Only a market price binding can have the main role, and only a
 * volume profile binding carries settings; no branch contains renderer data
 * or styles.
 */
export const ChartSeries = Schema.Union([
  Schema.Struct({
    id: seriesColumns.fields.id,
    role: withColumnDefault(seriesColumns.fields.role, chartSeriesTable.role),
    source: Schema.Struct({
      kind: Schema.Literal("market"),
      marketSourceId: seriesColumns.fields.marketSourceId.members[0],
      output: Schema.Literal(priceOutput),
    }),
  }),
  Schema.Struct({
    id: seriesColumns.fields.id,
    role: normalRole,
    source: Schema.Struct({
      kind: Schema.Literal("market"),
      marketSourceId: seriesColumns.fields.marketSourceId.members[0],
      output: Schema.Literal(volumeOutput),
    }),
  }),
  Schema.Struct({
    id: seriesColumns.fields.id,
    role: normalRole,
    source: Schema.Struct({
      kind: Schema.Literal("market"),
      marketSourceId: seriesColumns.fields.marketSourceId.members[0],
      output: Schema.Literal(volumeProfileOutput),
    }),
    /** The bars the profile counts, chosen in its settings; absent picks the finest that fit. */
    resolution: Schema.optionalKey(Schema.Literals(CHART_RESOLUTIONS)),
    /** Its price rows ("Number of volume bars"); absent keeps the script's default. */
    rows: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
    ),
  }),
  Schema.Struct({
    id: seriesColumns.fields.id,
    role: normalRole,
    source: Schema.Struct({
      kind: Schema.Literal("indicator"),
      indicatorId: seriesColumns.fields.indicatorId.members[0],
      output: seriesColumns.fields.output,
    }),
  }),
]);

/** A market or indicator-output display binding. */
export type ChartSeries = typeof ChartSeries.Type;

/** A pane always owns at least one display binding, even while its data is unavailable. */
export const ChartPane = Schema.Struct({
  id: paneColumns.fields.id,
  series: Schema.NonEmptyArray(ChartSeries),
});

/** An explicit pane inside a chart cell. */
export type ChartPane = typeof ChartPane.Type;

/**
 * One cell's market inputs and panes. Indicators are their own Resource,
 * listed by chart; bindings name them by value. Array order
 * replaces row positions, and nesting replaces parent foreign-key columns.
 * Every cell contains exactly one main market series; its source and pane
 * determine the primary listing and main pane, independently of array order.
 */
export const ChartCell = Schema.Struct({
  id: cellColumns.fields.id,
  resolution: withColumnDefault(
    cellColumns.fields.resolution,
    chartCellTable.resolution,
  ),
  session: withColumnDefault(
    cellColumns.fields.session,
    chartCellTable.session,
  ),
  adjustment: withColumnDefault(
    cellColumns.fields.adjustment,
    chartCellTable.adjustment,
  ),
  marketSources: Schema.Array(ChartMarketSource),
  panes: Schema.Array(ChartPane),
});

/** One cell inside the chart entity, without its own revision. */
export type ChartCell = typeof ChartCell.Type;

/**
 * The market source of a cell's main series. ChartEntity guarantees that the
 * main series and its same-cell source exist. The app keeps the same lookup
 * in `features/chart/utils/resource.ts`, since it imports only server types.
 * @example const market = barsSeries(getMainSource(cell), cell);
 */
export function getMainSource(cell: ChartCell): ChartMarketSource {
  const main = cell.panes
    .flatMap((pane) => pane.series)
    .find((series) => series.role === "main")!;
  return cell.marketSources.find(
    (source) =>
      main.source.kind === "market" && source.id === main.source.marketSourceId,
  )!;
}

/**
 * A directed synchronization policy. Endpoint existence and membership in the
 * chart are checked by ChartEntity and the composite FKs. The store returns links
 * sorted by id; their array order is not authored or persisted.
 */
export const ChartLink = Schema.Struct({
  id: linkColumns.fields.id,
  fromCellId: linkColumns.fields.fromCellId,
  toCellId: linkColumns.fields.toCellId,
  syncListing: withColumnDefault(
    linkColumns.fields.syncListing,
    chartLinkTable.syncListing,
  ),
  syncCrosshair: withColumnDefault(
    linkColumns.fields.syncCrosshair,
    chartLinkTable.syncCrosshair,
  ),
});

/** A directed synchronization policy inside a chart grid. */
export type ChartLink = typeof ChartLink.Type;

/**
 * The complete chart grid with one server-managed envelope. Column defaults
 * come from schema.ts; root cells and links default to empty collections.
 * Cell order may exceed the preset capacity, preserving hidden cells.
 * No child has an independent Resource envelope or revision.
 */
export const ChartEntity = withInvariants(
  Schema.Struct({
    ...envelopeFields(ChartId),
    dashboardId: listKey(chartColumns.fields.dashboardId),
    preset: withColumnDefault(chartColumns.fields.preset, chartTable.preset),
    cells: Schema.Array(ChartCell).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
    links: Schema.Array(ChartLink).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
  }),
  (invariant) => [
    invariant(
      "Child ids must be unique within each table in the chart",
      (chart, { expect }) => {
        const ids = {
          cells: new Set<string>(),
          panes: new Set<string>(),
          series: new Set<string>(),
          marketSources: new Set<string>(),
          links: new Set<string>(),
        };
        const unique = (
          table: keyof typeof ids,
          id: string,
          path: Path<typeof chart>,
        ) => {
          expect(ids[table].has(id), { path }).toBe(false);
          ids[table].add(id);
        };
        chart.cells.forEach((cell, c) => {
          unique("cells", cell.id, ["cells", c, "id"]);
          cell.marketSources.forEach((source, s) =>
            unique("marketSources", source.id, [
              "cells",
              c,
              "marketSources",
              s,
              "id",
            ]),
          );
          cell.panes.forEach((pane, p) => {
            unique("panes", pane.id, ["cells", c, "panes", p, "id"]);
            pane.series.forEach((series, s) =>
              unique("series", series.id, [
                "cells",
                c,
                "panes",
                p,
                "series",
                s,
                "id",
              ]),
            );
          });
        });
        chart.links.forEach((link, l) =>
          unique("links", link.id, ["links", l, "id"]),
        );
      },
      { code: "chart.unique_ids" },
    ),
    invariant(
      "Each cell must contain exactly one main market series",
      (chart, { expect }) => {
        chart.cells.forEach((cell, index) => {
          const mainSeries = cell.panes
            .flatMap((pane) => pane.series)
            .filter((series) => series.role === "main");
          expect(mainSeries, { path: ["cells", index, "panes"] }).toHaveLength(
            1,
          );
        });
      },
      { code: "chart.main_series_count" },
    ),
    invariant(
      "A market series source must belong to this cell",
      (chart, { expect }) => {
        chart.cells.forEach((cell, c) => {
          const sources = new Set(
            cell.marketSources.map((source) => source.id),
          );
          cell.panes.forEach((pane, p) => {
            pane.series.forEach((series, s) => {
              const source = series.source;
              if (source.kind === "market") {
                expect(sources.has(source.marketSourceId), {
                  path: [
                    "cells",
                    c,
                    "panes",
                    p,
                    "series",
                    s,
                    "source",
                    "marketSourceId",
                  ],
                }).toBe(true);
              }
            });
          });
        });
      },
      { code: "chart.series_source" },
    ),
    invariant(
      "Link endpoints must belong to this chart",
      (chart, { expect }) => {
        const cells = new Set(chart.cells.map((cell) => cell.id));
        chart.links.forEach((link, index) => {
          expect(cells.has(link.fromCellId), {
            path: ["links", index, "fromCellId"],
          }).toBe(true);
          expect(cells.has(link.toCellId), {
            path: ["links", index, "toCellId"],
          }).toBe(true);
        });
      },
      { code: "chart.link_endpoint" },
    ),
    invariant(
      "Link endpoints must be distinct",
      (chart, { expect }) => {
        chart.links.forEach((link, index) => {
          expect(link.fromCellId === link.toCellId, {
            path: ["links", index, "toCellId"],
          }).toBe(false);
        });
      },
      { code: "chart.link_self" },
    ),
    invariant(
      "Directed cell pairs must be unique",
      (chart, { expect }) => {
        const pairs = new Set<string>();
        chart.links.forEach((link, index) => {
          const pair = JSON.stringify([link.fromCellId, link.toCellId]);
          expect(pairs.has(pair), { path: ["links", index] }).toBe(false);
          pairs.add(pair);
        });
      },
      { code: "chart.link_pair" },
    ),
  ],
);

/** The full chart grid returned by Resource reads. */
export type ChartEntity = typeof ChartEntity.Type;
