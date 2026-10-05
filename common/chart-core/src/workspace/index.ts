// Purpose: Shared canonicalization and digest helpers for persisted workspace state
// Module:  @openchart/chart-core / workspace

export {
  repairDashboardWorkspace,
  type WorkspaceRepairChange,
  type WorkspaceRepairResult,
} from "./repair";

export type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike | undefined };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalizeJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => {
      const canonical = canonicalizeJson(item);
      return canonical === undefined ? null : canonical;
    });
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const canonical = canonicalizeJson((value as Record<string, unknown>)[key]);
    if (canonical !== undefined) result[key] = canonical;
  }
  return result;
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

function isDerivedVolumeSeriesObject(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const series = value.series as
    { type?: string; parentId?: string } | undefined;
  return (
    value.kind === "series" &&
    series?.type === "Histogram" &&
    typeof series.parentId === "string" &&
    series.parentId.length > 0
  );
}

export function isRuntimeDerivedVolumeAxisId(axisId: unknown): boolean {
  return (
    axisId === "volume" ||
    (typeof axisId === "string" && axisId.endsWith(":volume"))
  );
}

const RUNTIME_SERIES_STYLE_KEYS = new Set([
  "upColor",
  "downColor",
  "borderUpColor",
  "borderDownColor",
  "wickUpColor",
  "wickDownColor",
  "color",
  "lineColor",
  "topColor",
  "bottomColor",
  "topLineColor",
  "topFillColor1",
  "topFillColor2",
  "bottomLineColor",
  "bottomFillColor1",
  "bottomFillColor2",
]);

function sanitizeSeriesOptionsForWorkspaceDigest(options: unknown): unknown {
  if (!isPlainObject(options)) return options;
  const next = { ...options };
  for (const key of RUNTIME_SERIES_STYLE_KEYS) delete next[key];
  return next;
}

function canonicalPaneIdForWorkspaceDigest(index: number): string {
  return index === 0 ? "pane-main" : `pane-${index + 1}`;
}

function createPaneIdMapForWorkspaceDigest(
  panes: readonly unknown[] | undefined,
): Map<string, string> {
  const paneIdMap = new Map<string, string>();
  for (const [fallbackIndex, pane] of (panes ?? []).entries()) {
    if (!isPlainObject(pane)) continue;
    const rawId = pane.id;
    if (typeof rawId !== "string" || rawId.length === 0) continue;
    const rawIndex = pane.index;
    const index =
      typeof rawIndex === "number" && Number.isFinite(rawIndex)
        ? Math.max(0, Math.floor(rawIndex))
        : fallbackIndex;
    paneIdMap.set(rawId, canonicalPaneIdForWorkspaceDigest(index));
  }
  return paneIdMap;
}

function mapPaneIdForWorkspaceDigest(
  paneIdMap: ReadonlyMap<string, string>,
  paneId: unknown,
): unknown {
  if (typeof paneId !== "string") return paneId;
  return paneIdMap.get(paneId) ?? paneId;
}

function sanitizeChartConfigForWorkspaceDigest(
  config: unknown,
  paneIdMap: ReadonlyMap<string, string>,
  axisPaneIdMap: ReadonlyMap<string, string>,
): unknown {
  if (!isPlainObject(config)) return config;
  const next = structuredClone(config) as Record<string, unknown>;
  const chart = next.chart;
  if (isPlainObject(chart)) {
    delete chart.dimensions;
    const layout = chart.layout;
    if (isPlainObject(layout)) {
      delete layout.background;
      delete layout.textColor;
    }
    const grid = chart.grid;
    if (isPlainObject(grid)) delete grid.color;
  }
  const interaction = next.interaction;
  if (isPlainObject(interaction)) {
    const crosshair = interaction.crosshair;
    if (isPlainObject(crosshair) && crosshair.crosshairBadges === false) {
      delete crosshair.crosshairBadges;
    }
  }

  const yAxis = next.yAxis;
  const axes =
    isPlainObject(yAxis) && Array.isArray(yAxis.axes) ? yAxis.axes : [];
  const xAxis = next.xAxis;
  if (isPlainObject(xAxis) && Array.isArray(xAxis.axes)) {
    for (const axis of xAxis.axes) {
      if (!isPlainObject(axis)) continue;
      const spacing = axis.spacing;
      if (isPlainObject(spacing)) {
        delete axis.spacing;
      }
      delete axis.domain;
    }
  }
  if (isPlainObject(yAxis) && Array.isArray(yAxis.axes)) {
    yAxis.axes = yAxis.axes.filter(
      (axis) => !isPlainObject(axis) || !isRuntimeDerivedVolumeAxisId(axis.id),
    );
  }
  for (const axis of axes) {
    if (!isPlainObject(axis)) continue;
    if (axis.id === "volume") continue;
    axis.paneId =
      typeof axis.id === "string" && axisPaneIdMap.has(axis.id)
        ? axisPaneIdMap.get(axis.id)
        : mapPaneIdForWorkspaceDigest(paneIdMap, axis.paneId);
    if (axis.fixed === false) delete axis.fixed;
    if (axis.paneId === "pane-main") delete axis.paneId;
    // @agent invariant: workspace digests ignore y-axis viewport state. Do not
    // preserve `autoScale: false` after removing its `visibleExtent`, because
    // that pair cannot round-trip as durable chart state.
    if (axis.autoScale === false) axis.autoScale = true;
    delete axis.visibleExtent;
  }
  return next;
}

function sanitizeSeriesForWorkspaceDigest(
  series: Record<string, unknown> | undefined,
  objectId: string,
): Record<string, unknown> | undefined {
  if (!series) return undefined;
  const yAxisId =
    typeof series.yAxisId === "string" && series.yAxisId.length > 0
      ? series.yAxisId
      : typeof series.axisId === "string" && series.axisId.length > 0
        ? series.axisId
        : undefined;
  return {
    id: series.id ?? objectId,
    type: series.type,
    options: sanitizeSeriesOptionsForWorkspaceDigest(series.options),
    data: [],
    xAxisId: typeof series.xAxisId === "string" ? series.xAxisId : "main",
    yAxisId: yAxisId ?? "right",
    axisId: yAxisId ?? "right",
    fieldMap: series.fieldMap,
    parentId: series.parentId,
  };
}

function sanitizeIndicatorsForWorkspaceDigest(indicators: unknown): unknown {
  void indicators;
  // @agent invariant: indicator output identity is durable through chart
  // objects, seriesInputs, and dataSeries. `chart.indicators` is only a
  // grouping/editor projection and must not decide workspace save state.
  return {};
}

function isComparableSeriesForWorkspaceDigest(
  series: Record<string, unknown> | undefined,
): boolean {
  if (!series) return false;
  if (series.type === "Histogram") return false;
  if (series.parentId) return false;
  return true;
}

export function normalizeWorkspacePaneObjectIds(
  objectIds: readonly string[],
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const objectId of objectIds) {
    if (seen.has(objectId)) continue;
    seen.add(objectId);
    normalized.push(objectId);
  }
  const mainIndex = normalized.indexOf("main");
  if (mainIndex > 0) {
    normalized.splice(mainIndex, 1);
    normalized.unshift("main");
  }
  return normalized;
}

function sanitizePaneForWorkspaceDigest(
  pane: unknown,
  objectIds: Set<string>,
  paneIdMap: ReadonlyMap<string, string>,
): unknown {
  if (!isPlainObject(pane)) return pane;
  const rawObjectIds = Array.isArray(pane.objectIds) ? pane.objectIds : [];
  const scopedObjectIds = rawObjectIds.filter(
    (objectId) => typeof objectId === "string" && objectIds.has(objectId),
  );
  return {
    id: mapPaneIdForWorkspaceDigest(paneIdMap, pane.id),
    index: pane.index,
    height: pane.height,
    collapsed: pane.collapsed === true ? true : undefined,
    objectIds: normalizeWorkspacePaneObjectIds(scopedObjectIds),
  };
}

function orderedPanesForWorkspaceDigest(
  panes: unknown[] | undefined,
): unknown[] {
  return Array.from(panes ?? []).sort((a, b) => {
    const aIndex =
      isPlainObject(a) && typeof a.index === "number" ? a.index : 0;
    const bIndex =
      isPlainObject(b) && typeof b.index === "number" ? b.index : 0;
    return aIndex - bIndex;
  });
}

function sanitizeChartForWorkspaceDigest(chart: unknown): unknown {
  if (!isPlainObject(chart)) return chart;
  const record = chart as {
    id?: string;
    config?: unknown;
    panes?: unknown[];
    objects?: Record<string, Record<string, unknown>>;
    indicators?: unknown;
    comparison?: unknown;
    display?: unknown;
  };
  const paneIdMap = createPaneIdMapForWorkspaceDigest(record.panes);

  const objectEntries: Array<[string, Record<string, unknown>]> = [];
  const axisPaneIdMap = new Map<string, string>();
  for (const [objectId, objectValue] of Object.entries(record.objects ?? {})) {
    if (isDerivedVolumeSeriesObject(objectValue)) continue;
    const paneId = mapPaneIdForWorkspaceDigest(paneIdMap, objectValue.paneId);
    if (objectValue.kind === "drawing") {
      objectEntries.push([
        objectId,
        {
          id: objectId,
          kind: "drawing",
          paneId,
          item: objectValue.item,
        },
      ]);
      continue;
    }
    if (objectValue.kind !== "series") continue;

    const series = objectValue.series as Record<string, unknown> | undefined;
    const sanitizedSeries = sanitizeSeriesForWorkspaceDigest(series, objectId);
    const axisId =
      typeof objectValue.axisId === "string"
        ? objectValue.axisId
        : typeof sanitizedSeries?.axisId === "string"
          ? sanitizedSeries.axisId
          : undefined;
    if (axisId && typeof paneId === "string") {
      axisPaneIdMap.set(axisId, paneId);
    }
    objectEntries.push([
      objectId,
      {
        id: objectId,
        kind: "series",
        paneId,
        seriesId: objectValue.seriesId ?? objectId,
        axisId: objectValue.axisId,
        source: objectValue.source,
        comparable: isComparableSeriesForWorkspaceDigest(series),
        series: sanitizedSeries,
      },
    ]);
  }
  const objects = Object.fromEntries(objectEntries);
  const objectIds = new Set(Object.keys(objects));

  return {
    schemaVersion: 4,
    id: record.id,
    config: sanitizeChartConfigForWorkspaceDigest(
      record.config,
      paneIdMap,
      axisPaneIdMap,
    ),
    panes: orderedPanesForWorkspaceDigest(record.panes).map((pane) =>
      sanitizePaneForWorkspaceDigest(pane, objectIds, paneIdMap),
    ),
    objects,
    indicators: sanitizeIndicatorsForWorkspaceDigest(record.indicators),
    comparison: record.comparison,
    display: record.display,
  };
}

function chartIdsFromWorkspaceLayout(layout: unknown): string[] {
  if (!isPlainObject(layout)) return [];
  if (Array.isArray(layout.cells)) {
    return layout.cells.flatMap((cell) => {
      if (!isPlainObject(cell)) return [];
      return cell.kind === "chart" && typeof cell.resourceId === "string"
        ? [cell.resourceId]
        : [];
    });
  }
  if (isPlainObject(layout.positions)) return Object.keys(layout.positions);
  return [];
}

function normalizeLayoutMode(mode: unknown): string | null {
  return mode === "structured" ? "structured" : null;
}

function scopedRecord<T>(
  values: Record<string, T> | undefined,
  ids: Iterable<string>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of ids) {
    if (values && Object.prototype.hasOwnProperty.call(values, id)) {
      out[id] = values[id]!;
    }
  }
  return out;
}

export function canonicalizeDashboardWorkspaceForDigest(
  workspace: unknown,
): unknown {
  if (!isPlainObject(workspace)) return workspace;
  const layout = isPlainObject(workspace.layout) ? workspace.layout : {};
  const chartIds = chartIdsFromWorkspaceLayout(layout);
  const visibleChartIds =
    chartIds.length > 0
      ? chartIds
      : Object.keys((workspace.charts as Record<string, unknown>) ?? {});
  const visibleChartIdSet = new Set(visibleChartIds);
  const charts = workspace.charts as Record<string, unknown> | undefined;
  const scopedCharts: Record<string, unknown> = {};
  for (const chartId of visibleChartIds) {
    if (charts?.[chartId]) {
      scopedCharts[chartId] = sanitizeChartForWorkspaceDigest(charts[chartId]);
    }
  }

  const dashboard = isPlainObject(workspace.dashboard)
    ? workspace.dashboard
    : {};

  return {
    dashboard: {
      name: dashboard.name,
      favorite: dashboard.favorite,
      autosave: dashboard.autosave,
      sharingEnabled: dashboard.sharingEnabled,
    },
    charts: scopedCharts,
    dataSeries: isPlainObject(workspace.dataSeries) ? workspace.dataSeries : {},
    layout: {
      preset: layout.preset ?? null,
      cells: Array.isArray(layout.cells) ? layout.cells : undefined,
      positions: isPlainObject(layout.positions) ? layout.positions : undefined,
      mode: normalizeLayoutMode(layout.mode),
      colWidths: layout.colWidths,
      rowHeights: layout.rowHeights,
      links: layout.links ?? [],
      auxiliaryColumns: layout.auxiliaryColumns ?? [],
    },
    seriesInputs: scopedRecord(
      workspace.seriesInputs as
        Record<string, Record<string, unknown>> | undefined,
      visibleChartIdSet,
    ),
  };
}

export function digestDashboardWorkspace(workspace: unknown): string {
  return canonicalJsonStringify(
    canonicalizeDashboardWorkspaceForDigest(workspace),
  );
}
