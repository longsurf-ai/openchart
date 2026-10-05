// Purpose: Persists and assembles complete chart grids within the Resource transaction.

import type { ListFilter } from "@openchart/server/lib/resource/list-schema";
import type {
  Row,
  Store,
  StoreBody,
  Tx,
} from "@openchart/server/lib/resource/store";
import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { ChartEntity } from "./entity";
import {
  chartTable,
  chartCellTable,
  chartPaneTable,
  chartMarketSourceTable,
  chartSeriesTable,
  chartLinkTable,
} from "./schema";

type ChartRow = typeof chartTable.$inferSelect;
type ChartWrite = StoreBody<typeof ChartEntity>;

function groupBy<T>(rows: readonly T[], parent: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = parent(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function readRows(tx: Tx, roots: readonly ChartRow[]) {
  return Effect.gen(function* () {
    if (!roots.length) return [];
    const ids = roots.map((root) => root.id);
    const cells = yield* tx
      .select()
      .from(chartCellTable)
      .where(inArray(chartCellTable.chartId, ids))
      .orderBy(asc(chartCellTable.position));
    const links = yield* tx
      .select()
      .from(chartLinkTable)
      .where(inArray(chartLinkTable.chartId, ids))
      .orderBy(asc(chartLinkTable.id));
    const cellIds = cells.map((cell) => cell.id);
    const panes = cellIds.length
      ? yield* tx
          .select()
          .from(chartPaneTable)
          .where(inArray(chartPaneTable.cellId, cellIds))
          .orderBy(asc(chartPaneTable.position))
      : [];
    const sources = cellIds.length
      ? yield* tx
          .select()
          .from(chartMarketSourceTable)
          .where(inArray(chartMarketSourceTable.cellId, cellIds))
          .orderBy(asc(chartMarketSourceTable.position))
      : [];
    const series = cellIds.length
      ? yield* tx
          .select()
          .from(chartSeriesTable)
          .where(inArray(chartSeriesTable.cellId, cellIds))
          .orderBy(asc(chartSeriesTable.position))
      : [];
    const cellsByChart = groupBy(cells, (row) => row.chartId);
    const linksByChart = groupBy(links, (row) => row.chartId);
    const panesByCell = groupBy(panes, (row) => row.cellId);
    const sourcesByCell = groupBy(sources, (row) => row.cellId);
    const seriesByPane = groupBy(series, (row) => row.paneId);
    return roots.map((root): Row => ({
      id: root.id,
      revision: root.revision,
      createdAt: root.createdAt,
      updatedAt: root.updatedAt,
      body: {
        dashboardId: root.dashboardId,
        preset: root.preset,
        cells: (cellsByChart.get(root.id) ?? []).map((cell) => ({
          id: cell.id,
          resolution: cell.resolution,
          session: cell.session,
          adjustment: cell.adjustment,
          marketSources: (sourcesByCell.get(cell.id) ?? []).map((source) => ({
            id: source.id,
            provider: source.provider,
            listing: source.listing,
          })),
          panes: (panesByCell.get(cell.id) ?? []).map((pane) => ({
            id: pane.id,
            series: (seriesByPane.get(pane.id) ?? []).map((binding) => ({
              id: binding.id,
              role: binding.role,
              source:
                binding.marketSourceId === null
                  ? {
                      kind: "indicator",
                      indicatorId: binding.indicatorId,
                      output: binding.output,
                    }
                  : {
                      kind: "market",
                      marketSourceId: binding.marketSourceId,
                      output: binding.output,
                    },
              ...(binding.profileResolution === null
                ? {}
                : { resolution: binding.profileResolution }),
              ...(binding.profileRows === null
                ? {}
                : { rows: binding.profileRows }),
            })),
          })),
        })),
        links: (linksByChart.get(root.id) ?? []).map((link) => ({
          id: link.id,
          fromCellId: link.fromCellId,
          toCellId: link.toCellId,
          syncListing: link.syncListing,
          syncCrosshair: link.syncCrosshair,
        })),
      },
    }));
  });
}

function insertChildren(tx: Tx, chartId: string, body: ChartWrite) {
  return Effect.gen(function* () {
    const cells = body.cells.map((cell, position) => ({
      id: cell.id,
      chartId,
      position,
      resolution: cell.resolution,
      session: cell.session,
      adjustment: cell.adjustment,
    }));
    if (cells.length) yield* tx.insert(chartCellTable).values(cells);
    const panes = body.cells.flatMap((cell) =>
      cell.panes.map((pane, position) => ({
        id: pane.id,
        cellId: cell.id,
        position,
      })),
    );
    if (panes.length) yield* tx.insert(chartPaneTable).values(panes);
    const sources = body.cells.flatMap((cell) =>
      cell.marketSources.map((source, position) => ({
        id: source.id,
        cellId: cell.id,
        position,
        provider: source.provider,
        listing: source.listing,
      })),
    );
    if (sources.length)
      yield* tx.insert(chartMarketSourceTable).values(sources);
    const series = body.cells.flatMap((cell) =>
      cell.panes.flatMap((pane) =>
        pane.series.map((binding, position) => ({
          id: binding.id,
          cellId: cell.id,
          paneId: pane.id,
          position,
          role: binding.role,
          marketSourceId:
            binding.source.kind === "market"
              ? binding.source.marketSourceId
              : null,
          indicatorId:
            binding.source.kind === "indicator"
              ? binding.source.indicatorId
              : null,
          output: binding.source.output,
          profileResolution:
            "resolution" in binding ? (binding.resolution ?? null) : null,
          profileRows: "rows" in binding ? (binding.rows ?? null) : null,
        })),
      ),
    );
    if (series.length) yield* tx.insert(chartSeriesTable).values(series);
    const links = body.links.map((link) => ({ ...link, chartId }));
    if (links.length) yield* tx.insert(chartLinkTable).values(links);
  });
}

function readWritten(tx: Tx, root: ChartRow) {
  return readRows(tx, [root]).pipe(
    Effect.flatMap((rows) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.die("Chart assembly returned no row"),
    ),
  );
}

/**
 * Maps six tables to one chart Resource. Indicators are their own Resource. List filters roots in SQL before
 * batching child reads. Save replaces owned children with their supplied ids
 * and order, keeping the root envelope and all changes in the caller's transaction.
 */
export const chartStore: Store<ChartWrite, ListFilter<typeof ChartEntity>> = {
  load: (tx, id) =>
    Effect.gen(function* () {
      const root = yield* tx
        .select()
        .from(chartTable)
        .where(eq(chartTable.id, id))
        .get();
      if (!root) return undefined;
      return yield* readWritten(tx, root);
    }),
  list: (tx, filter, window) =>
    Effect.gen(function* () {
      const page = listWindowSql(chartTable, window);
      const roots = yield* tx
        .select()
        .from(chartTable)
        .where(
          and(
            page.where,
            filter.dashboardId === undefined
              ? undefined
              : eq(chartTable.dashboardId, filter.dashboardId),
          ),
        )
        .orderBy(...page.orderBy)
        .limit(page.limit);
      return yield* readRows(tx, roots);
    }),
  insert: (tx, input) =>
    Effect.gen(function* () {
      const root = yield* tx
        .insert(chartTable)
        .values({
          id: input.id,
          revision: input.revision,
          dashboardId: input.body.dashboardId,
          preset: input.body.preset,
        })
        .returning()
        .get();
      if (!root) return yield* Effect.die("Chart insert returned no row");
      yield* insertChildren(tx, root.id, input.body);
      return yield* readWritten(tx, root);
    }),
  save: (tx, id, input) =>
    Effect.gen(function* () {
      const root = yield* tx
        .update(chartTable)
        .set({
          revision: input.revision,
          dashboardId: input.body.dashboardId,
          preset: input.body.preset,
        })
        .where(eq(chartTable.id, id))
        .returning()
        .get();
      if (!root) return yield* Effect.die("Chart save returned no row");
      yield* tx.delete(chartLinkTable).where(eq(chartLinkTable.chartId, id));
      yield* tx.delete(chartCellTable).where(eq(chartCellTable.chartId, id));
      yield* insertChildren(tx, id, input.body);
      return yield* readWritten(tx, root);
    }),
  remove: (tx, id) =>
    tx.delete(chartTable).where(eq(chartTable.id, id)).pipe(Effect.asVoid),
};
