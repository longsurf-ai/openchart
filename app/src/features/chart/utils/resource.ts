// Purpose: Edit chart structure once while preserving source, series, pane, and link identities.
import type { BarsCapabilities, Resolution } from "@openchart/feed";
import type { ProviderListing } from "@openchart/market";

import {
  chartIds,
  chooseBarsOptions,
  createCell,
  type CellDefinition,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";

import { getGridPreset, GRID_PRESETS, type GridPreset } from "./grid-layout";

/** The main binding, independent of pane or series order. */
export function getMainSeries(cell: CellDefinition) {
  const series = cell.panes
    .flatMap((pane) => pane.series)
    .find((series) => series.role === "main");
  if (!series) throw new Error("This chart has no main series.");
  return series;
}

/** The market input supplying the main binding. */
export function getMainSource(cell: CellDefinition) {
  const series = getMainSeries(cell);
  const source = cell.marketSources.find(
    (source) =>
      series.source.kind === "market" &&
      source.id === series.source.marketSourceId,
  );
  if (!source) throw new Error("This chart has no main market source.");
  return source;
}

/** The pane containing the main binding, even after the user moves it. */
export function getMainPane(cell: CellDefinition) {
  const pane = cell.panes.find((pane) =>
    pane.series.some((series) => series.role === "main"),
  );
  if (!pane) throw new Error("This chart has no main pane.");
  return pane;
}

/** Resolve a captured cell ID against the latest Resource before applying an edit. */
export function updateCell(
  resource: ChartResource,
  cellId: string,
  edit: (cell: CellDefinition) => CellDefinition,
): ChartResource {
  const cell = resource.cells.find((cell) => cell.id === cellId);
  if (!cell) throw new Error("This chart cell no longer exists.");
  const next = edit(cell);
  if (next === cell) return resource;
  return {
    ...resource,
    cells: resource.cells.map((value) => (value.id === cellId ? next : value)),
  };
}

type CellSeries = CellDefinition["panes"][number]["series"][number];

/**
 * Save a volume profile binding's settings: the bars it counts and its rows.
 * An absent setting returns to the default; other bindings are untouched.
 * @example next = setProfileSettings(cell, binding.id, { rows: 50 });
 */
export function setProfileSettings(
  cell: CellDefinition,
  seriesId: string,
  settings: { readonly resolution?: Resolution; readonly rows?: number },
): CellDefinition {
  const update = (series: CellSeries): CellSeries =>
    series.id === seriesId &&
    series.source.kind === "market" &&
    series.source.output === "volumeProfile"
      ? { id: series.id, role: "normal", source: series.source, ...settings }
      : series;
  return {
    ...cell,
    panes: cell.panes.map((pane) => {
      const [first, ...rest] = pane.series;
      return { ...pane, series: [update(first), ...rest.map(update)] };
    }),
  };
}

function filterSeries(
  cell: CellDefinition,
  keep: (series: CellSeries) => boolean,
) {
  return cell.panes.flatMap<CellDefinition["panes"][number]>((pane) => {
    const series = pane.series.filter(keep);
    if (series.length === pane.series.length) return [pane];
    const [first, ...rest] = series;
    return first ? [{ ...pane, series: [first, ...rest] }] : [];
  });
}

/** Remove a display and its market input only when no other display uses that input. */
export function removeSeries(
  cell: CellDefinition,
  seriesId: string,
): CellDefinition {
  const series = cell.panes
    .flatMap((pane) => pane.series)
    .find((series) => series.id === seriesId);
  if (!series) throw new Error("This series no longer exists.");
  if (series.role === "main")
    throw new Error("The main series cannot be removed.");
  const panes = filterSeries(cell, (value) => value.id !== seriesId);
  return {
    ...cell,
    panes,
    marketSources: cell.marketSources.filter(
      (source) =>
        series.source.kind !== "market" ||
        source.id !== series.source.marketSourceId ||
        panes.some((pane) =>
          pane.series.some(
            (value) =>
              value.source.kind === "market" &&
              value.source.marketSourceId === source.id,
          ),
        ),
    ),
  };
}

/** Remove a comparison input together with every display supplied by it. */
export function removeMarketSource(
  cell: CellDefinition,
  sourceId: string,
): CellDefinition {
  if (!cell.marketSources.some((source) => source.id === sourceId))
    throw new Error("This market source no longer exists.");
  if (getMainSource(cell).id === sourceId)
    throw new Error("The main market source cannot be removed.");
  return {
    ...cell,
    marketSources: cell.marketSources.filter(
      (source) => source.id !== sourceId,
    ),
    panes: filterSeries(
      cell,
      (series) =>
        series.source.kind !== "market" ||
        series.source.marketSourceId !== sourceId,
    ),
  };
}

/** A market display stands alone; an indicator's outputs form one placement group.
 * Missing selections return no bindings. @example const group = getSeriesGroup(cell, seriesId);
 */
export function getSeriesGroup(cell: CellDefinition, seriesId: string) {
  const all = cell.panes.flatMap((pane) => pane.series);
  const selected = all.find((series) => series.id === seriesId);
  if (!selected) return [];
  const source = selected.source;
  return source.kind === "indicator"
    ? all.filter(
        (series) =>
          series.source.kind === "indicator" &&
          series.source.indicatorId === source.indicatorId,
      )
    : [selected];
}

/** Move a market display or the whole indicator to a stable destination; prune emptied panes. */
export function moveSeries(
  cell: CellDefinition,
  seriesId: string,
  targetPaneId: string | "new",
): CellDefinition {
  const [firstSeries, ...otherSeries] = getSeriesGroup(cell, seriesId);
  if (!firstSeries) throw new Error("This series no longer exists.");
  const group = [firstSeries, ...otherSeries] as const;
  const ids = new Set(group.map((series) => series.id));
  const target = cell.panes.find((pane) => pane.id === targetPaneId);
  if (
    target?.series.filter((series) => ids.has(series.id)).length ===
    group.length
  )
    return cell;
  if (targetPaneId !== "new" && !target)
    throw new Error("The destination pane no longer exists.");
  const panes = cell.panes.flatMap<CellDefinition["panes"][number]>((pane) => {
    const remaining = pane.series.filter((series) => !ids.has(series.id));
    const series =
      pane.id === targetPaneId ? [...remaining, ...group] : remaining;
    const [first, ...rest] = series;
    return first ? [{ ...pane, series: [first, ...rest] }] : [];
  });
  if (targetPaneId === "new")
    panes.push({ id: chartIds.pane.create(), series: group });
  return { ...cell, panes };
}

/** Add a compatible comparison to the main price pane. */
export function addComparison(
  cell: CellDefinition,
  selected: ProviderListing,
  capabilities: BarsCapabilities,
): CellDefinition {
  if (
    cell.marketSources.some(
      (source) =>
        source.provider === selected.provider &&
        source.listing.symbol === selected.listing.symbol,
    )
  )
    throw new Error("This symbol is already on this chart.");
  if (
    !capabilities.some(
      (value) =>
        value.resolution === cell.resolution &&
        value.session === cell.session &&
        value.adjustment === cell.adjustment,
    )
  )
    throw new Error(
      "This source does not support this chart’s interval, session, and adjustment. Choose a compatible source.",
    );
  const sourceId = chartIds.source.create();
  const mainPane = getMainPane(cell);
  return {
    ...cell,
    marketSources: [...cell.marketSources, { id: sourceId, ...selected }],
    panes: cell.panes.map((pane) =>
      pane.id === mainPane.id
        ? {
            ...pane,
            series: [
              ...pane.series,
              {
                id: chartIds.series.create(),
                role: "normal",
                source: {
                  kind: "market",
                  marketSourceId: sourceId,
                  output: "price",
                },
              },
            ],
          }
        : pane,
    ),
  };
}

/** Replace the selected cell and its directly linked peers in one revision. */
export function replaceListing(
  resource: ChartResource,
  cellId: string,
  selected: ProviderListing,
  capabilities: BarsCapabilities,
): ChartResource {
  if (!resource.cells.some((cell) => cell.id === cellId))
    throw new Error("This chart cell no longer exists.");
  const linkedIds = new Set([
    cellId,
    ...resource.links
      .filter((link) => link.fromCellId === cellId && link.syncListing)
      .map((link) => link.toCellId),
  ]);
  return {
    ...resource,
    cells: resource.cells.map((cell) => {
      if (!linkedIds.has(cell.id)) return cell;
      const main = getMainSource(cell);
      return {
        ...cell,
        // Session and adjustment are choices among one provider's offers;
        // another provider starts from its own default.
        ...chooseBarsOptions(
          capabilities,
          main.provider === selected.provider
            ? cell
            : { resolution: cell.resolution },
        ),
        marketSources: cell.marketSources.map((source) =>
          source.id === main.id ? { id: source.id, ...selected } : source,
        ),
      };
    }),
  };
}

/** Replace a captured input without changing its displays; main inputs retain symbol-link behavior.
 * @example replaceMarketSource(resource, cellId, sourceId, listing, capabilities);
 */
export function replaceMarketSource(
  resource: ChartResource,
  cellId: string,
  sourceId: string,
  selected: ProviderListing,
  capabilities: BarsCapabilities,
): ChartResource {
  const cell = resource.cells.find((value) => value.id === cellId);
  if (!cell) throw new Error("This chart cell no longer exists.");
  if (!cell.marketSources.some((source) => source.id === sourceId))
    throw new Error("This market source no longer exists.");
  if (getMainSource(cell).id === sourceId)
    return replaceListing(resource, cellId, selected, capabilities);
  if (
    cell.marketSources.some(
      (source) =>
        source.id !== sourceId &&
        source.provider === selected.provider &&
        source.listing.symbol === selected.listing.symbol,
    )
  )
    throw new Error("This symbol is already on this chart.");
  if (
    !capabilities.some(
      (value) =>
        value.resolution === cell.resolution &&
        value.session === cell.session &&
        value.adjustment === cell.adjustment,
    )
  )
    throw new Error(
      "This source does not support this chart’s interval, session, and adjustment.",
    );
  return updateCell(resource, cellId, (current) => ({
    ...current,
    marketSources: current.marketSources.map((source) =>
      source.id === sourceId ? { id: source.id, ...selected } : source,
    ),
  }));
}

/** Apply the toolbar's group policy without changing surviving link identities. */
export function linkCells(
  resource: ChartResource,
  flags: { syncListing: boolean; syncCrosshair: boolean },
): ChartResource {
  const links =
    flags.syncListing || flags.syncCrosshair
      ? resource.cells.flatMap((from) =>
          resource.cells
            .filter((to) => to.id !== from.id)
            .map((to) => ({
              id:
                resource.links.find(
                  (link) =>
                    link.fromCellId === from.id && link.toCellId === to.id,
                )?.id ?? chartIds.link.create(),
              fromCellId: from.id,
              toCellId: to.id,
              ...flags,
            })),
        )
      : [];
  return { ...resource, links };
}

/** Grow the grid only when needed, preserving its chosen shape and current link policy. */
export function addCell(
  resource: ChartResource,
  cell: CellDefinition,
): ChartResource {
  if (resource.cells.length >= 16)
    throw new Error("A chart layout supports at most 16 cells.");
  const cells = [...resource.cells, cell];
  const preset =
    getGridPreset(resource.preset).capacity >= cells.length
      ? resource.preset
      : GRID_PRESETS.find(
          (value) => getGridPreset(value).capacity >= cells.length,
        )!;
  return linkCells(
    { ...resource, cells, preset },
    {
      syncListing: resource.links.some((link) => link.syncListing),
      syncCrosshair: resource.links.some((link) => link.syncCrosshair),
    },
  );
}

/** Fill a selected shape from the active market; smaller shapes retain hidden cells.
 * @example setGridPreset(resource, "2x2", focusedId);
 */
export function setGridPreset(
  resource: ChartResource,
  preset: GridPreset,
  focusedId: string | undefined,
): ChartResource {
  const visible = resource.cells.slice(
    0,
    getGridPreset(resource.preset).capacity,
  );
  const seed = visible.find((cell) => cell.id === focusedId) ?? visible[0];
  let next = { ...resource, preset };
  while (next.cells.length < getGridPreset(preset).capacity) {
    if (!seed) throw new Error("Choose a symbol to add a chart.");
    next = addCell(next, createCell(getMainSource(seed), seed));
  }
  return next;
}
