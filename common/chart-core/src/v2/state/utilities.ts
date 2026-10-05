// Purpose: High-level mutation API (ChartStateUtils) for chart state — series CRUD, axis management, scrolling, crosshair, and visible-range control
// Module:  @openchart/chart-core / v2 / state

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Chart, ChartObjectId } from "@openchart/chart-core/chart/state";
import { Series } from "@openchart/chart-core/series";
import { Data } from "@openchart/chart-core/data/schema";
import { ChartConfig } from "@openchart/chart-core/config";
import { XAxisConfig, YAxisConfig } from "@openchart/chart-core/scale/config";
import {
  addAxis,
  axisDataLength,
  axisSeries,
  deriveLinearDomain,
  getAxis,
  linearSeriesValues,
  ordinalVisibleRange,
  removeAxis,
  setActiveAxis,
  setAxisDomain,
  setAxisSpacing,
} from "@openchart/chart-core/v2/x-scale";
import { ChartStateModel } from "./model";
import { UUID } from "@openchart/chart-core/util";

type YAxis = YAxisConfig.Axis;
type XAxis = XAxisConfig.Axis;
type Extent = { min: number; max: number };
type Margins = { top?: number; bottom?: number };
type AxisValueLine = YAxis["valueLine"];
type AxisPresentationRole = Pick<YAxis, "fixed" | "visible" | "side">;
type ComparisonSeriesPresentation = NonNullable<
  Chart.ComparisonState["previousSeriesPresentation"]
>;

const DEFAULT_X_AXIS_SPACING = XAxisConfig.Spacing.parse({});
const DEFAULT_DETACHED_PANE_SHARE = 0.25;

function parseSeriesOptions(
  type: string,
  options?: Record<string, unknown>,
): Record<string, unknown> {
  const schema = Series.OptionsMap[type as keyof typeof Series.OptionsMap];
  if (schema) return schema.parse(options ?? {});
  return {
    visible: true,
    ...(options ?? {}),
  };
}

function seriesXField(series: Series.State, axis: XAxis): string {
  return series.fieldMap?.x ?? axis.field ?? "time";
}

function sameXValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function seriesEntries(
  state: Chart.State,
): Array<[ChartObjectId, Series.State]> {
  return ChartStateModel.resolvedSeriesEntries(state);
}

function seriesValues(state: Chart.State): Series.State[] {
  return seriesEntries(state).map(([, series]) => series);
}

function cloneYAxis(axis: YAxis): YAxis {
  return YAxisConfig.Axis.parse(axis);
}

function cloneFieldMap(
  fieldMap: Series.State["fieldMap"],
): Series.State["fieldMap"] {
  return fieldMap ? { ...fieldMap } : undefined;
}

function captureComparisonSeriesPresentation(
  state: Chart.State,
): ComparisonSeriesPresentation {
  const series: ComparisonSeriesPresentation["series"] = {};
  for (const [seriesId, item] of seriesEntries(state)) {
    series[seriesId] = {
      type: item.type,
      options: { ...(item.options as Record<string, unknown>) },
      fieldMap: cloneFieldMap(item.fieldMap),
    };
  }
  return { series };
}

function restoreComparisonSeriesPresentation(
  state: Chart.State,
  presentation: Chart.ComparisonState["previousSeriesPresentation"],
): void {
  if (!presentation) return;
  for (const [seriesId, previous] of Object.entries(presentation.series)) {
    updateSeries(state, seriesId, (series) => {
      series.type = previous.type;
      series.options = { ...previous.options };
      if (previous.fieldMap) {
        series.fieldMap = { ...previous.fieldMap };
      } else {
        series.fieldMap = undefined;
      }
    });
  }
}

function comparisonLineColor(series: Series.State): string | undefined {
  const options = series.options as Record<string, unknown>;
  const candidates = [
    options.color,
    options.lineColor,
    options.topLineColor,
    options.upColor,
    options.borderUpColor,
    options.borderColor,
  ];
  return candidates.find((value): value is string => typeof value === "string");
}

function comparisonLineOptions(series: Series.State): Record<string, unknown> {
  const current = series.options as Record<string, unknown>;
  const options: Record<string, unknown> = Series.LineOptions.parse({});
  const color = comparisonLineColor(series);
  if (color) options.color = color;
  if (typeof current.title === "string") options.title = current.title;
  if (typeof current.lineWidth === "number") {
    options.lineWidth = current.lineWidth;
  }
  if (
    current.lineStyle === "solid" ||
    current.lineStyle === "dashed" ||
    current.lineStyle === "dotted"
  ) {
    options.lineStyle = current.lineStyle;
  }
  options.lastValueVisible = true;
  if (typeof current.valueLineVisible === "boolean") {
    options.valueLineVisible = current.valueLineVisible;
  }
  if (current.valueFormat && typeof current.valueFormat === "object") {
    options.valueFormat = {
      ...(current.valueFormat as Record<string, unknown>),
    };
  }
  return options;
}

function seriesObject(
  state: Chart.State,
  seriesId: string,
): ChartStateModel.SeriesObject | undefined {
  return ChartStateModel.getSeriesObject(state, seriesId);
}

function comparisonPaneId(state: Chart.State, mainSeriesId: string): string {
  return (
    ChartStateModel.paneForSeries(state, mainSeriesId)?.id ??
    ChartStateModel.MAIN_PANE_ID
  );
}

function isComparisonPriceSeries(
  state: Chart.State,
  seriesId: string,
  series: Series.State,
  mainSeriesId: string,
): boolean {
  if (series.type === "Histogram") return false;
  if (series.parentId) return false;
  const object = seriesObject(state, seriesId);
  if (!object) return false;
  if (object.source !== "provider") return false;
  return object.paneId === comparisonPaneId(state, mainSeriesId);
}

function restoreDetachedComparisonVisibility(
  state: Chart.State,
  seriesId: string,
  presentation: Chart.ComparisonState["previousSeriesPresentation"],
): boolean {
  const previous = presentation?.series[seriesId];
  if (!previous) return false;
  if (previous.options.visible === false) return false;
  const series = ChartStateModel.getSeries(state, seriesId);
  const current = series?.options as Record<string, unknown> | undefined;
  if (current?.visible !== false) return false;
  return updateSeries(state, seriesId, (targetSeries) => {
    const next = { ...(targetSeries.options as Record<string, unknown>) };
    if (Object.prototype.hasOwnProperty.call(previous.options, "visible")) {
      next.visible = previous.options.visible;
    } else {
      delete next.visible;
    }
    targetSeries.options = next;
  });
}

function isOwnedDerivedSeries(
  state: Chart.State,
  seriesId: string,
  series: Series.State,
): boolean {
  const object = ChartStateModel.getSeriesObject(state, seriesId);
  return (
    object?.kind === "series" &&
    object.source === "derived" &&
    series.parentId !== undefined
  );
}

function yAxisById(state: Chart.State, axisId: string): YAxis | undefined {
  return (state.config.yAxis.axes as YAxis[]).find(
    (axis) => axis.id === axisId,
  );
}

function childSeriesIdsForParent(
  state: Chart.State,
  parentSeriesId: string,
): string[] {
  const ids: string[] = [];
  for (const [seriesId, series] of seriesEntries(state)) {
    if (series.parentId === parentSeriesId) ids.push(seriesId);
  }
  return ids;
}

function descendantSeriesIdsForParent(
  state: Chart.State,
  parentSeriesId: string,
): string[] {
  const visited = new Set<string>();
  const descendants: string[] = [];
  const visit = (seriesId: string) => {
    for (const childId of childSeriesIdsForParent(state, seriesId)) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      descendants.push(childId);
      visit(childId);
    }
  };
  visit(parentSeriesId);
  return descendants;
}

function comparisonLineFieldMap(series: Series.State): Series.FieldMap {
  if (series.fieldMap?.value) return { ...series.fieldMap };
  const hasClose = series.data.some((point) => {
    if (!point || typeof point !== "object") return false;
    const value = (point as Record<string, unknown>).close;
    return typeof value === "number" && Number.isFinite(value);
  });
  if (hasClose) return { ...(series.fieldMap ?? {}), value: "close" };
  return { ...(series.fieldMap ?? {}), value: "value" };
}

function comparisonPriceSeriesIds(
  state: Chart.State,
  mainSeriesId: string,
): string[] {
  const ids: string[] = [];
  for (const [seriesId, series] of seriesEntries(state)) {
    if (isComparisonPriceSeries(state, seriesId, series, mainSeriesId)) {
      ids.push(seriesId);
    }
  }
  if (
    !ids.includes(mainSeriesId) &&
    ChartStateModel.getSeries(state, mainSeriesId)
  ) {
    ids.unshift(mainSeriesId);
  }
  return ids;
}

function getComparableSeriesSnapshot(
  state: Chart.State,
  seriesId: string,
): string {
  const series = ChartStateModel.getSeries(state, seriesId);
  if (!series) return "";
  return JSON.stringify({
    type: series.type,
    yAxisId: series.yAxisId,
    axisId: series.axisId,
    parentId: series.parentId,
    fieldMap: series.fieldMap,
    visible: (series.options as Record<string, unknown>).visible,
  });
}

function clearAllComparisonAnchors(state: Chart.State): boolean {
  let changed = false;
  for (const axis of state.config.yAxis.axes as YAxis[]) {
    if (axis.modeAnchor === undefined) continue;
    axis.modeAnchor = undefined;
    changed = true;
  }
  return changed;
}

function applyComparisonSeriesPresentation(
  state: Chart.State,
  mainSeriesId: string,
  auxiliarySeriesIds: readonly string[],
  previousPresentation: Chart.ComparisonState["previousSeriesPresentation"],
): boolean {
  let changed = false;
  const participantIds = new Set([mainSeriesId, ...auxiliarySeriesIds]);
  const paneId = comparisonPaneId(state, mainSeriesId);
  for (const [seriesId, series] of seriesEntries(state)) {
    const before = getComparableSeriesSnapshot(state, seriesId);
    const object = seriesObject(state, seriesId);
    if (!object) continue;
    if (object.paneId !== paneId) {
      changed =
        restoreDetachedComparisonVisibility(
          state,
          seriesId,
          previousPresentation,
        ) || changed;
      continue;
    }
    if (!participantIds.has(seriesId)) {
      updateSeries(state, seriesId, (targetSeries) => {
        targetSeries.options = {
          ...(targetSeries.options as Record<string, unknown>),
          visible: false,
        };
      });
      changed =
        before !== getComparableSeriesSnapshot(state, seriesId) || changed;
      continue;
    }

    if (!isComparisonPriceSeries(state, seriesId, series, mainSeriesId)) {
      continue;
    }
    updateSeries(state, seriesId, (targetSeries) => {
      targetSeries.type = "Line";
      targetSeries.fieldMap = comparisonLineFieldMap(series);
      targetSeries.options = comparisonLineOptions(series);
    });
    changed =
      before !== getComparableSeriesSnapshot(state, seriesId) || changed;
  }
  return changed;
}

function captureComparisonYAxisLayout(
  state: Chart.State,
): NonNullable<Chart.ComparisonState["previousYAxisLayout"]> {
  const seriesAxisIds: Record<string, string> = {};
  for (const [seriesId, series] of seriesEntries(state)) {
    seriesAxisIds[seriesId] = Series.getYAxisId(series);
  }
  return {
    axes: (state.config.yAxis.axes as YAxis[]).map(cloneYAxis),
    seriesAxisIds,
  };
}

function restoreComparisonYAxisLayout(
  state: Chart.State,
  layout: Chart.ComparisonState["previousYAxisLayout"],
): boolean {
  if (!layout || layout.axes.length === 0) return false;

  const restoredAxes = layout.axes.map(cloneYAxis);
  const restoredAxisIds = new Set(restoredAxes.map((axis) => axis.id));
  state.config.yAxis.axes = restoredAxes;

  for (const [seriesId, axisId] of Object.entries(layout.seriesAxisIds)) {
    if (!restoredAxisIds.has(axisId)) continue;
    updateSeries(state, seriesId, (targetSeries) => {
      targetSeries.yAxisId = axisId;
      targetSeries.axisId = axisId;
    });
  }

  const fallbackAxisId = restoredAxes[0]?.id ?? "right";
  for (const [seriesId, series] of seriesEntries(state)) {
    if (restoredAxisIds.has(Series.getYAxisId(series))) continue;
    updateSeries(state, seriesId, (targetSeries) => {
      targetSeries.yAxisId = fallbackAxisId;
      targetSeries.axisId = fallbackAxisId;
    });
  }

  return true;
}

function updateSeries(
  state: Chart.State,
  seriesId: string,
  updater: (series: Series.State, paneId: string) => void,
): boolean {
  const object = ChartStateModel.getSeriesObject(state, seriesId);
  if (!object) return false;
  updater(object.series, object.paneId);
  ChartStateModel.upsertSeriesObject(
    state,
    seriesId,
    object.paneId,
    object.series,
    object.source,
  );
  return true;
}

function asRange(
  state: Chart.State,
  axisId?: string,
): { from: number; to: number } {
  const id = axisId ?? state.config.xAxis.activeId;
  const current = state.visibleRanges[id];
  if (current) return current;
  const axis = getAxis(state.config.xAxis, id);
  if (axis.mode === "ordinal") {
    const len = axisDataLength(seriesValues(state), axis.id);
    const width = Chart.computeLayout(state.config).areaWidth;
    const { range } = ordinalVisibleRange(state.config, axis, width, len);
    return { from: range.from, to: range.to };
  }

  const list = axisSeries(seriesValues(state), axis.id);
  const domain = deriveLinearDomain(axis, list);
  let from = 0;
  let to = 0;
  for (const series of list) {
    const values = linearSeriesValues(series, axis);
    let first = -1;
    let last = -1;
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!;
      if (!Number.isFinite(value)) continue;
      if (value < domain.min || value > domain.max) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0 || last < 0) continue;
    if (to === 0 && from === 0) {
      from = first;
      to = last + 1;
    } else {
      from = Math.min(from, first);
      to = Math.max(to, last + 1);
    }
  }
  return { from, to };
}

function defaultPaneAxisId(paneId: string): string {
  return paneId === ChartStateModel.MAIN_PANE_ID ? "right" : `${paneId}:right`;
}

function defaultDetachedPaneHeight(existingPanes: Chart.Pane[]): number {
  const existingTotal = existingPanes.reduce(
    (sum, pane) => sum + Math.max(1, pane.height),
    0,
  );
  if (existingTotal <= 0) return ChartStateModel.MIN_PANE_HEIGHT;
  return (
    (existingTotal * DEFAULT_DETACHED_PANE_SHARE) /
    (1 - DEFAULT_DETACHED_PANE_SHARE)
  );
}

function uniqueSeriesIds(seriesIds: string | string[]): string[] {
  const ids = Array.isArray(seriesIds) ? seriesIds : [seriesIds];
  return [...new Set(ids.filter((id) => id.trim().length > 0))];
}

function firstSeriesTime(
  state: Chart.State,
  series: Series.State,
): number | undefined {
  const axis = getAxis(state.config.xAxis, series.xAxisId);
  const field = seriesXField(series, axis);
  for (const point of series.data) {
    if (!point || typeof point !== "object") continue;
    const time = Data.readTime((point as Record<string, unknown>)[field]);
    if (time !== undefined) return time;
  }
  return undefined;
}

function viewportMiddleSeriesTime(
  state: Chart.State,
  series: Series.State,
): number | undefined {
  if (series.data.length === 0) return firstSeriesTime(state, series);
  const axis = getAxis(state.config.xAxis, Series.getXAxisId(series));
  const field = seriesXField(series, axis);
  const range = asRange(state, axis.id);
  const index = Math.max(
    0,
    Math.min(
      series.data.length - 1,
      Math.round((range.from + Math.max(range.from, range.to - 1)) / 2),
    ),
  );
  const point = series.data[index];
  if (!point || typeof point !== "object")
    return firstSeriesTime(state, series);
  return (
    Data.readTime((point as Record<string, unknown>)[field]) ??
    firstSeriesTime(state, series)
  );
}

function viewportMiddleComparisonTime(
  state: Chart.State,
  mainSeries: Series.State,
  auxiliarySeriesIds: readonly string[],
): number | undefined {
  const candidates = [
    mainSeries,
    ...auxiliarySeriesIds.flatMap((seriesId) => {
      const series = ChartStateModel.resolvedSeries(state, seriesId);
      return series ? [series] : [];
    }),
  ];
  for (const series of candidates) {
    const time = viewportMiddleSeriesTime(state, series);
    if (time !== undefined) return time;
  }
  return undefined;
}

function comparisonAuxiliarySeriesIds(
  state: Chart.State,
  axisId: string,
  mainSeriesId: string,
): string[] {
  const ids: string[] = [];
  for (const [seriesId, series] of seriesEntries(state)) {
    if (seriesId === mainSeriesId) continue;
    if (!isComparisonPriceSeries(state, seriesId, series, mainSeriesId)) {
      continue;
    }
    if (Series.getYAxisId(series) !== axisId) continue;
    ids.push(seriesId);
  }
  return ids;
}

export namespace ChartStateUtils {
  export function getSeries(
    state: Chart.State,
    seriesId: string,
  ): Series.State | undefined {
    return ChartStateModel.resolvedSeries(state, seriesId);
  }

  export function requireSeries(
    state: Chart.State,
    seriesId: string,
  ): Series.State {
    return ChartStateModel.requireSeries(state, seriesId);
  }

  export function seriesEntries(
    state: Chart.State,
  ): Array<[ChartObjectId, Series.State]> {
    return ChartStateModel.resolvedSeriesEntries(state);
  }

  export function seriesIds(state: Chart.State): ChartObjectId[] {
    return ChartStateModel.seriesIds(state);
  }

  export function mainSeries(state: Chart.State): Series.State | undefined {
    return ChartStateModel.mainSeries(state);
  }

  export function addSeries(
    state: Chart.State,
    input: {
      id?: string;
      type: string;
      options?: Record<string, unknown>;
      data?: unknown[];
      pane?: number;
      yAxisId?: string;
      xAxisId?: string;
      fieldMap?: Record<string, string>;
      parentId?: string;
      /** Reference to shared data in chart.dataSeries. When set, series.data is ignored. */
      dataRef?: string;
      source?: "provider" | "derived" | "computed" | "metric";
    },
  ): ChartObjectId {
    ChartStateModel.assertModelReady(state);
    const sid = ChartObjectId.parse(input.id ?? UUID.random());
    const opts = parseSeriesOptions(input.type, input.options);

    const isChildSeries =
      input.parentId !== undefined || input.type === "Histogram";
    const isHistogram = input.type === "Histogram";
    const histogramCount = seriesValues(state).filter(
      (s) => s.type === "Histogram",
    ).length;
    const childCount = seriesValues(state).filter(
      (s) => s.parentId !== undefined && s.type !== "Histogram",
    ).length;
    const paneIndex = input.pane ?? 0;
    const paneId =
      state.panes[paneIndex]?.id ??
      (paneIndex === 0
        ? ChartStateModel.MAIN_PANE_ID
        : ChartStateModel.createPaneId());
    const yAxisId =
      input.yAxisId ??
      (isHistogram
        ? `histogram-${histogramCount}`
        : isChildSeries
          ? `child-${childCount}`
          : defaultPaneAxisId(paneId));
    const xAxisId = input.xAxisId ?? state.config.xAxis.activeId ?? "main";

    const axes = state.config.yAxis.axes as YAxis[];
    const existingAxis = axes.find((a) => a.id === yAxisId);
    if (!existingAxis) {
      // A parent-owned or automatic histogram axis inherits overlay defaults.
      // An explicit study axis can mix renderer types (e.g. MACD).
      axes.push(
        createAxis(
          yAxisId,
          input.parentId !== undefined ||
            (isHistogram && input.yAxisId === undefined),
          paneId,
        ),
      );
    }

    addAxis(state.config.xAxis, { id: xAxisId });

    const series: Series.State = {
      id: sid,
      type: input.type,
      options: opts,
      data: input.data ?? [],
      yAxisId,
      axisId: yAxisId,
      xAxisId,
      fieldMap: input.fieldMap,
      parentId: input.parentId,
    };

    while (state.panes.length <= paneIndex) {
      const nextIndex = state.panes.length;
      const paneHeight =
        nextIndex > 0
          ? defaultDetachedPaneHeight(state.panes)
          : state.config.chart.dimensions.height;
      state.panes.push({
        id:
          nextIndex === 0
            ? ChartStateModel.MAIN_PANE_ID
            : ChartStateModel.createPaneId(),
        index: nextIndex,
        height: paneHeight,
        objectIds: [],
      });
    }

    const resolvedPaneId = state.panes[paneIndex]!.id;
    ChartStateModel.upsertSeriesObject(
      state,
      sid,
      resolvedPaneId,
      series,
      input.source ?? "provider",
      input.dataRef,
    );
    syncAxesForPane(state, resolvedPaneId);
    ChartStateModel.normalizePaneHeights(state);
    return sid;
  }

  export function removeSeries(state: Chart.State, seriesId: string): void {
    const series = getSeries(state, seriesId);
    if (!series) return;
    if (isOwnedDerivedSeries(state, seriesId, series)) return;
    ChartStateModel.assertModelReady(state);
    const seriesIdsToRemove = [
      ...descendantSeriesIdsForParent(state, seriesId),
      seriesId,
    ];
    for (const id of seriesIdsToRemove) {
      ChartStateModel.removeSeriesObject(state, id);
    }

    removeEmptyPanes(state);
    removeUnusedAxes(state);
  }

  export function resize(
    state: Chart.State,
    width: number,
    height: number,
  ): void {
    ChartStateModel.assertModelReady(state);
    const current = state.config.chart.dimensions;
    if (current.width === width && current.height === height) return;

    state.config.chart.dimensions = {
      width,
      height,
      autoResize: current.autoResize,
    };

    ChartStateModel.normalizePaneHeights(state);
  }

  export function setConfig(
    state: Chart.State,
    config: ChartConfig.Full,
  ): void {
    state.config = ChartConfig.validate(config);
    ChartStateModel.assertModelReady(state);
    removeUnusedAxes(state);
  }

  export function applyConfig(
    state: Chart.State,
    partial: Partial<ChartConfig.Full>,
  ): void {
    const merged = { ...state.config, ...partial };
    state.config = ChartConfig.validate(merged);
    ChartStateModel.assertModelReady(state);
    removeUnusedAxes(state);
  }

  export function setSeriesData(
    state: Chart.State,
    seriesId: string,
    data: unknown[],
  ): void {
    updateSeries(state, seriesId, (series) => {
      series.data = data;
    });
  }

  export function updateSeriesBar(
    state: Chart.State,
    seriesId: string,
    bar: unknown,
  ): void {
    const series = ChartStateModel.getSeries(state, seriesId);
    if (!series) return;

    const axis = getAxis(state.config.xAxis, series.xAxisId);
    const xField = seriesXField(series, axis);
    const data = series.data;
    const item = bar as Record<string, unknown>;
    const last = data[data.length - 1] as Record<string, unknown> | undefined;

    const sameX = last && sameXValue(last[xField], item[xField]);
    if (sameX) {
      data[data.length - 1] = bar;
    } else {
      data.push(bar);
    }
  }

  export function applySeriesOptions(
    state: Chart.State,
    seriesId: string,
    opts: Record<string, unknown>,
  ): void {
    updateSeries(state, seriesId, (series) => {
      series.options = { ...series.options, ...opts };
    });
  }

  export function shareYAxis(
    state: Chart.State,
    seriesId: string,
    otherSeriesId: string,
  ): void {
    ChartStateModel.assertModelReady(state);
    const series = getSeries(state, seriesId);
    const otherSeries = getSeries(state, otherSeriesId);
    if (!series || !otherSeries) return;
    const axisId = Series.getYAxisId(otherSeries);
    updateSeries(state, seriesId, (targetSeries) => {
      targetSeries.yAxisId = axisId;
      targetSeries.axisId = axisId;
    });
    removeUnusedAxes(state);
  }

  export function moveSeriesToOwnAxisSide(
    state: Chart.State,
    seriesId: string,
    side: YAxis["side"],
  ): string | undefined {
    ChartStateModel.assertModelReady(state);
    const series = getSeries(state, seriesId);
    if (!series) return undefined;

    const pane = ChartStateModel.paneForSeries(state, seriesId);
    const paneId = pane?.id ?? ChartStateModel.MAIN_PANE_ID;
    const axisId = Series.getYAxisId(series);
    const currentAxis = getYAxis(state, axisId);
    const axisSeriesIds = getSeriesIdsByYAxis(state, axisId, paneId);
    const isExclusiveAxis =
      axisSeriesIds.length === 1 && axisSeriesIds[0] === seriesId;

    let targetAxisId = axisId;
    if (!isExclusiveAxis) {
      const preserved = currentAxis
        ? {
            mode: currentAxis.mode,
            autoScale: currentAxis.autoScale,
            invertScale: currentAxis.invertScale,
            lockZero: currentAxis.lockZero,
            visibleExtent: currentAxis.visibleExtent
              ? { ...currentAxis.visibleExtent }
              : undefined,
            margins: currentAxis.margins
              ? { ...currentAxis.margins }
              : undefined,
            style: currentAxis.style ? { ...currentAxis.style } : undefined,
            labels: currentAxis.labels ? { ...currentAxis.labels } : undefined,
            valueLine: currentAxis.valueLine
              ? { ...currentAxis.valueLine }
              : undefined,
          }
        : undefined;

      useOwnAxis(state, seriesId);
      targetAxisId = getSeries(state, seriesId)?.yAxisId ?? targetAxisId;
      if (preserved) {
        applyYAxisOptions(state, targetAxisId, preserved);
      }
    }

    moveAxisToSide(state, targetAxisId, side);
    return targetAxisId;
  }

  export function useOwnAxis(state: Chart.State, seriesId: string): void {
    ChartStateModel.assertModelReady(state);
    const series = getSeries(state, seriesId);
    if (!series) return;

    const isChildSeries =
      series.parentId !== undefined || series.type === "Histogram";
    const newAxisId = ownAxisIdForSeries(state, series, seriesId);

    const axes = state.config.yAxis.axes as YAxis[];
    const existingAxis = axes.find((a) => a.id === newAxisId);
    const pane = ChartStateModel.paneForSeries(state, seriesId);
    const paneId = pane?.id ?? ChartStateModel.MAIN_PANE_ID;

    if (!existingAxis) {
      const nextAxis = createAxis(newAxisId, isChildSeries, paneId);
      nextAxis.fixed = false;
      nextAxis.visible = false;
      axes.push(nextAxis);
    }

    updateSeries(state, seriesId, (targetSeries) => {
      targetSeries.yAxisId = newAxisId;
      targetSeries.axisId = newAxisId;
    });
    syncAxesForPane(state, paneId);
    removeUnusedAxes(state);

    const nextAxis = getYAxis(state, newAxisId);
    if (
      nextAxis &&
      ChartStateUtils.getPrimarySeriesId(state, paneId) === seriesId
    ) {
      applyAxisPresentationRole(nextAxis, {
        fixed: true,
        visible: true,
        side: "right",
      });
      reorderAxisForSideStack(state, nextAxis.id, nextAxis.side);
    }
  }

  function ownAxisIdForSeries(
    state: Chart.State,
    series: Series.State,
    seriesId: string,
  ): string {
    const baseAxisId = `${series.type.toLowerCase()}-${seriesId}`;
    const axis = getYAxis(state, baseAxisId);
    const seriesIds = getSeriesIdsByYAxis(state, baseAxisId);
    const ownsAxis = seriesIds.length === 1 && seriesIds[0] === seriesId;
    if (!axis || seriesIds.length === 0 || ownsAxis) return baseAxisId;

    for (let suffix = 2; ; suffix++) {
      const candidate = `${baseAxisId}-${suffix}`;
      const candidateAxis = getYAxis(state, candidate);
      const candidateSeriesIds = getSeriesIdsByYAxis(state, candidate);
      const candidateOwnsAxis =
        candidateSeriesIds.length === 1 && candidateSeriesIds[0] === seriesId;
      if (
        !candidateAxis ||
        candidateSeriesIds.length === 0 ||
        candidateOwnsAxis
      ) {
        return candidate;
      }
    }
  }

  export function combinePaneAxes(
    state: Chart.State,
    paneId: string,
    targetAxisId: string,
    mode: YAxis["mode"] = "percentage",
  ): void {
    combinePaneAxesMatching(
      state,
      paneId,
      targetAxisId,
      mode,
      (_seriesId, series) => {
        if (series.type === "Histogram") return false;
        if (series.parentId) return false;
        return true;
      },
    );
  }

  function combinePaneAxesMatching(
    state: Chart.State,
    paneId: string,
    targetAxisId: string,
    mode: YAxis["mode"],
    shouldCombine: (seriesId: string, series: Series.State) => boolean,
  ): void {
    ChartStateModel.assertModelReady(state);
    const pane = ChartStateModel.paneById(state, paneId);
    if (!pane) return;
    const targetAxis = getYAxis(state, targetAxisId);
    if (!targetAxis) return;
    const combineToDefaultAxis =
      targetAxis.fixed === false || !targetAxis.visible;
    const combinedAxisId = combineToDefaultAxis
      ? defaultPaneAxisId(pane.id)
      : targetAxisId;

    let combinedAxis = getYAxis(state, combinedAxisId);
    if (!combinedAxis) {
      combinedAxis = createAxis(combinedAxisId, false, pane.id);
      const axes = state.config.yAxis.axes as YAxis[];
      axes.push(combinedAxis);
    }
    combinedAxis.paneId = pane.id;

    for (const seriesId of ChartStateModel.seriesIdsInPane(state, pane.id)) {
      const series = getSeries(state, seriesId);
      if (!series) continue;
      if (!shouldCombine(seriesId, series)) continue;
      updateSeries(state, seriesId, (targetSeries) => {
        targetSeries.yAxisId = combinedAxisId;
        targetSeries.axisId = combinedAxisId;
      });
    }

    applyYAxisOptions(state, combinedAxisId, { mode });
    if (combineToDefaultAxis) {
      moveAxisToSide(state, combinedAxisId, "right");
    } else {
      setAxisFixed(state, combinedAxisId, true);
    }
    removeUnusedAxes(state);
  }

  function combineComparisonPriceAxes(
    state: Chart.State,
    mainSeriesId: string,
    targetAxisId: string,
    mode: YAxis["mode"],
  ): void {
    const pane = ChartStateModel.paneForSeries(state, mainSeriesId);
    if (!pane) return;
    combinePaneAxesMatching(
      state,
      pane.id,
      targetAxisId,
      mode,
      (seriesId, series) =>
        isComparisonPriceSeries(state, seriesId, series, mainSeriesId),
    );
  }

  export function removeAxisAndSeries(
    state: Chart.State,
    axisId: string,
  ): void {
    ChartStateModel.assertModelReady(state);
    const toRemove = ChartStateModel.seriesIds(state).filter((seriesId) => {
      const series = getSeries(state, seriesId);
      return !!series && Series.getYAxisId(series) === axisId;
    });
    for (const seriesId of toRemove) {
      removeSeries(state, seriesId);
    }
    const axes = state.config.yAxis.axes as YAxis[];
    const idx = axes.findIndex((axis) => axis.id === axisId);
    if (idx >= 0) {
      axes.splice(idx, 1);
    }
    removeUnusedAxes(state);
  }

  export function setAxisFixed(
    state: Chart.State,
    axisId: string,
    fixed: boolean,
    side?: YAxis["side"],
  ): void {
    if (!fixed && isPrimaryAxis(state, axisId)) return;
    const axes = state.config.yAxis.axes as YAxis[];
    const axis = axes.find((item) => item.id === axisId);
    if (!axis) return;
    axis.fixed = fixed;
    axis.visible = fixed;
    if (fixed) {
      if (side) axis.side = side;
      reorderAxisForSideStack(state, axisId, axis.side);
      return;
    }
    axis.side = "right";
  }

  export function moveAxisToSide(
    state: Chart.State,
    axisId: string,
    side: YAxis["side"],
  ): void {
    const axes = state.config.yAxis.axes as YAxis[];
    const axis = axes.find((item) => item.id === axisId);
    if (!axis) return;
    axis.side = side;
    axis.fixed = true;
    axis.visible = true;
    reorderAxisForSideStack(state, axisId, side);
  }

  export function moveSeriesToPane(
    state: Chart.State,
    inputSeriesIds: string | string[],
    targetPaneId: string,
  ): void {
    ChartStateModel.assertModelReady(state);
    const targetPane = ChartStateModel.paneById(state, targetPaneId);
    if (!targetPane) return;

    const seriesIds = uniqueSeriesIds(inputSeriesIds).filter((seriesId) =>
      Boolean(getSeries(state, seriesId)),
    );
    if (seriesIds.length === 0) return;
    const seriesIdSet = new Set(seriesIds);

    const previousPaneIds = new Set<string>();
    for (const seriesId of seriesIds) {
      const pane = ChartStateModel.paneForSeries(state, seriesId);
      if (pane) previousPaneIds.add(pane.id);
      for (const childId of childSeriesIdsForParent(state, seriesId)) {
        const childPane = ChartStateModel.paneForSeries(state, childId);
        if (childPane) previousPaneIds.add(childPane.id);
        seriesIdSet.add(childId);
      }
    }

    const targetDefaultAxisId = defaultPaneAxisId(targetPaneId);
    const axes = state.config.yAxis.axes as YAxis[];
    let targetDefaultAxis = getYAxis(state, targetDefaultAxisId);
    if (!targetDefaultAxis) {
      targetDefaultAxis = createAxis(targetDefaultAxisId, false, targetPaneId);
      axes.push(targetDefaultAxis);
    }
    targetDefaultAxis.paneId = targetPaneId;

    for (const seriesId of seriesIdSet) {
      ChartStateModel.setObjectPane(state, seriesId, targetPaneId);
    }

    for (const seriesId of seriesIdSet) {
      const series = getSeries(state, seriesId);
      if (!series) continue;
      const isChildSeries =
        series.parentId !== undefined || series.type === "Histogram";
      if (isChildSeries) {
        let childAxis = getYAxis(state, Series.getYAxisId(series));
        if (!childAxis) {
          childAxis = createAxis(Series.getYAxisId(series), true, targetPaneId);
          axes.push(childAxis);
        }
        childAxis.paneId = targetPaneId;
        childAxis.fixed = false;
        childAxis.visible = false;
        childAxis.lockZero = true;
        continue;
      }
      updateSeries(state, seriesId, (targetSeries) => {
        targetSeries.yAxisId = targetDefaultAxisId;
        targetSeries.axisId = targetDefaultAxisId;
      });
    }

    for (const paneId of previousPaneIds) {
      syncAxesForPane(state, paneId);
    }
    syncAxesForPane(state, targetPaneId);
    removeEmptyPanes(state);
    removeUnusedAxes(state);
    ChartStateModel.normalizePaneHeights(state);
  }

  export function moveSeriesToNewPaneBelow(
    state: Chart.State,
    inputSeriesIds: string | string[],
  ): string | undefined {
    ChartStateModel.assertModelReady(state);
    if (state.panes.length >= ChartStateModel.MAX_PANES) return undefined;

    const seriesIds = uniqueSeriesIds(inputSeriesIds).filter((seriesId) =>
      Boolean(getSeries(state, seriesId)),
    );
    if (seriesIds.length === 0) return undefined;

    const firstPane =
      ChartStateModel.paneForSeries(state, seriesIds[0]!) ??
      ChartStateModel.paneById(state, ChartStateModel.MAIN_PANE_ID);
    const firstPaneIndex = firstPane
      ? ChartStateModel.paneIndexForPaneId(state, firstPane.id)
      : 0;
    const insertAt = Math.min(firstPaneIndex + 1, state.panes.length);
    const paneId = ChartStateModel.createPaneId();

    state.panes.splice(insertAt, 0, {
      id: paneId,
      index: insertAt,
      height: defaultDetachedPaneHeight(state.panes),
      objectIds: [],
    });
    ChartStateModel.syncPaneIndices(state);
    ChartStateModel.normalizePaneHeights(state);

    moveSeriesToPane(state, seriesIds, paneId);
    return paneId;
  }

  export function getSeriesIdsByYAxis(
    state: Chart.State,
    axisId: string,
    paneId?: string,
  ): string[] {
    const seriesIds = ChartStateModel.seriesEntries(state)
      .filter(([, series]) => Series.getYAxisId(series) === axisId)
      .map(([seriesId]) => seriesId);
    if (!paneId) return seriesIds;
    const paneSeries = new Set(ChartStateModel.seriesIdsInPane(state, paneId));
    return seriesIds.filter((seriesId) => paneSeries.has(seriesId));
  }

  export function getPrimarySeriesId(
    state: Chart.State,
    paneId = ChartStateModel.MAIN_PANE_ID,
  ): string | undefined {
    const paneSeries = ChartStateModel.seriesIdsInPane(state, paneId);
    for (const seriesId of paneSeries) {
      const series = getSeries(state, seriesId);
      if (!series) continue;
      if (series.parentId) continue;
      if (series.type === "Histogram") continue;
      return seriesId;
    }
    return paneSeries[0];
  }

  export function isPrimaryAxis(
    state: Chart.State,
    axisId: string,
    paneId?: string,
  ): boolean {
    const axis = getYAxis(state, axisId);
    if (!axis) return false;
    const targetPaneId = paneId ?? axis.paneId ?? ChartStateModel.MAIN_PANE_ID;
    const primarySeriesId = getPrimarySeriesId(state, targetPaneId);
    if (!primarySeriesId) return false;
    const primarySeries = getSeries(state, primarySeriesId);
    if (!primarySeries) return false;
    return Series.getYAxisId(primarySeries) === axisId;
  }

  export function reorderSeriesInPane(
    state: Chart.State,
    paneId: string,
    seriesId: string,
    targetIndex: number,
  ): void {
    ChartStateModel.assertModelReady(state);
    const objectId = ChartObjectId.parse(seriesId);
    const pane = ChartStateModel.paneById(state, paneId);
    if (!pane) return;
    const previousPrimarySeriesId = ChartStateUtils.getPrimarySeriesId(
      state,
      pane.id,
    );

    const seriesIds = ChartStateModel.seriesIdsInPane(state, pane.id).filter(
      (id) => !!getSeries(state, id),
    );
    if (seriesIds.length <= 1) return;

    const fromIndex = seriesIds.indexOf(objectId);
    if (fromIndex < 0) return;

    const nextSeriesIds = [...seriesIds];
    const [moved] = nextSeriesIds.splice(fromIndex, 1);
    if (!moved) return;
    const insertionIndex = Math.max(
      0,
      Math.min(targetIndex, nextSeriesIds.length),
    );
    nextSeriesIds.splice(insertionIndex, 0, moved);

    const seriesObjectIds = pane.objectIds.filter((objectId) => {
      const object = state.objects[objectId];
      return (
        ChartStateModel.isSeriesObject(object) &&
        nextSeriesIds.includes(object.seriesId)
      );
    });

    const orderedSeriesObjectIds = nextSeriesIds
      .map((id) =>
        seriesObjectIds.find((objectId) => {
          const object = state.objects[objectId];
          return (
            ChartStateModel.isSeriesObject(object) && object.seriesId === id
          );
        }),
      )
      .filter((candidate): candidate is ChartObjectId => !!candidate);

    if (
      orderedSeriesObjectIds.length === seriesObjectIds.length &&
      seriesObjectIds.length > 0
    ) {
      let cursor = 0;
      pane.objectIds = pane.objectIds.map((objectId) => {
        if (!seriesObjectIds.includes(objectId)) return objectId;
        const next = orderedSeriesObjectIds[cursor];
        cursor += 1;
        return next ?? objectId;
      });
    } else {
      for (const id of nextSeriesIds) {
        if (!pane.objectIds.includes(id)) {
          pane.objectIds.push(id);
        }
      }
    }
    const nextPrimarySeriesId = ChartStateUtils.getPrimarySeriesId(
      state,
      pane.id,
    );
    swapPrimaryAxisPresentationRole(
      state,
      previousPrimarySeriesId,
      nextPrimarySeriesId,
    );
    ensurePrimaryAxisVisible(state);
  }

  export function setAxisLabelsVisible(
    state: Chart.State,
    axisId: string,
    visible: boolean,
  ): void {
    const axis = getYAxis(state, axisId);
    if (!axis) return;
    applyYAxisOptions(state, axisId, {
      labels: {
        visible,
        style: axis.labels?.style ?? "default",
        tagColor: axis.labels?.tagColor,
        textColor: axis.labels?.textColor,
      },
    });
  }

  export function setAxisValueLineOptions(
    state: Chart.State,
    axisId: string,
    options: Partial<AxisValueLine>,
  ): void {
    const axis = getYAxis(state, axisId);
    if (!axis) return;
    applyYAxisOptions(state, axisId, {
      valueLine: {
        visible: axis.valueLine?.visible ?? true,
        mode: axis.valueLine?.mode ?? "extended",
        style: axis.valueLine?.style ?? "dotted",
        color: axis.valueLine?.color,
        ...options,
      },
    });
  }

  export function setVisibleRange(
    state: Chart.State,
    from: number,
    to: number,
    xAxisId?: string,
  ): void {
    const axis = getAxis(state.config.xAxis, xAxisId);
    if (axis.mode === "ordinal") {
      const len = axisDataLength(seriesValues(state), axis.id);
      if (len === 0) return;

      const visibleBars = Math.max(1, to - from - 1);
      const width = Chart.computeLayout(state.config).areaWidth;
      const newBarSpacing = Math.max(
        axis.spacing.minBarSpacing,
        Math.min(axis.spacing.maxBarSpacing, width / visibleBars),
      );
      const rightOffset = (to - len) * newBarSpacing;
      setAxisSpacing(state.config.xAxis, axis.id, {
        barSpacing: newBarSpacing,
        rightOffset,
      });
      return;
    }

    const list = axisSeries(seriesValues(state), axis.id);
    const reference = list.sort((a, b) => b.data.length - a.data.length)[0];
    if (!reference || reference.data.length === 0) return;
    const values = linearSeriesValues(reference, axis).filter((value) =>
      Number.isFinite(value),
    );
    if (values.length === 0) return;
    const start = Math.max(0, Math.min(values.length - 1, Math.floor(from)));
    const end = Math.max(start, Math.min(values.length - 1, Math.ceil(to) - 1));
    const min = values[start]!;
    const max = values[end]!;
    const minSpan = Math.max(axis.domain?.minSpan ?? 1e-6, 1e-6);
    setAxisDomain(state.config.xAxis, axis.id, {
      min: Math.min(min, max),
      max: Math.max(min, max) || min + minSpan,
      minSpan,
    });
  }

  export function fitContent(state: Chart.State, xAxisId?: string): void {
    const axis = getAxis(state.config.xAxis, xAxisId);
    if (axis.mode === "ordinal") {
      const len = axisDataLength(seriesValues(state), axis.id);
      if (len === 0) return;

      const width = Chart.computeLayout(state.config).areaWidth;
      const newBarSpacing = Math.max(
        axis.spacing.minBarSpacing,
        Math.min(axis.spacing.maxBarSpacing, width / len),
      );
      setAxisSpacing(state.config.xAxis, axis.id, {
        barSpacing: newBarSpacing,
        rightOffset: 0,
      });
      return;
    }

    const list = axisSeries(seriesValues(state), axis.id);
    const domain = deriveLinearDomain(axis, list);
    setAxisDomain(state.config.xAxis, axis.id, domain);
  }

  export function scrollToRealTime(state: Chart.State, xAxisId?: string): void {
    const axis = getAxis(state.config.xAxis, xAxisId);
    if (axis.mode === "ordinal") {
      setAxisSpacing(state.config.xAxis, axis.id, { rightOffset: 0 });
      return;
    }

    const list = axisSeries(seriesValues(state), axis.id);
    const dataDomain = deriveLinearDomain(axis, list);
    const current = axis.domain ?? dataDomain;
    const span = Math.max(
      current.max - current.min,
      current.minSpan ?? dataDomain.minSpan,
    );
    setAxisDomain(state.config.xAxis, axis.id, {
      min: dataDomain.max - span,
      max: dataDomain.max,
      minSpan: current.minSpan ?? dataDomain.minSpan,
    });
  }

  export function resetXAxisViewport(
    state: Chart.State,
    xAxisId?: string,
  ): void {
    const axis = getAxis(state.config.xAxis, xAxisId);
    delete state.visibleRanges[axis.id];
    if (axis.mode === "ordinal") {
      setAxisSpacing(state.config.xAxis, axis.id, DEFAULT_X_AXIS_SPACING);
      return;
    }

    setAxisDomain(state.config.xAxis, axis.id, undefined);
  }

  export function scrollToPosition(
    state: Chart.State,
    index: number,
    xAxisId?: string,
  ): void {
    const axis = getAxis(state.config.xAxis, xAxisId);
    if (axis.mode === "ordinal") {
      const len = axisDataLength(seriesValues(state), axis.id);
      if (len === 0) return;

      const rightOffset = (index - len + 1) * axis.spacing.barSpacing;
      setAxisSpacing(state.config.xAxis, axis.id, { rightOffset });
      return;
    }

    const list = axisSeries(seriesValues(state), axis.id);
    const reference = list.sort((a, b) => b.data.length - a.data.length)[0];
    if (!reference || reference.data.length === 0) return;
    const values = linearSeriesValues(reference, axis);
    const target = values[Math.max(0, Math.min(values.length - 1, index))];
    if (!Number.isFinite(target)) return;
    const domain = axis.domain ?? deriveLinearDomain(axis, list);
    const span = Math.max(domain.max - domain.min, domain.minSpan);
    setAxisDomain(state.config.xAxis, axis.id, {
      min: (target as number) - span / 2,
      max: (target as number) + span / 2,
      minSpan: domain.minSpan,
    });
  }

  export function setActiveXAxis(state: Chart.State, axisId: string): void {
    setActiveAxis(state.config.xAxis, axisId);
  }

  export function addXAxis(
    state: Chart.State,
    axis: Partial<XAxis> & { id: string },
  ): void {
    addAxis(state.config.xAxis, axis);
  }

  export function removeXAxis(state: Chart.State, axisId: string): void {
    const active = state.config.xAxis.activeId;
    if (active === axisId && state.config.xAxis.axes.length <= 1) return;

    removeAxis(state.config.xAxis, axisId);
    for (const seriesId of ChartStateModel.seriesIds(state)) {
      const series = ChartStateModel.getSeries(state, seriesId);
      if (series && Series.getXAxisId(series) === axisId) {
        updateSeries(state, seriesId, (targetSeries) => {
          targetSeries.xAxisId = state.config.xAxis.activeId;
        });
      }
    }
  }

  export function bindSeriesToXAxis(
    state: Chart.State,
    seriesId: string,
    xAxisId: string,
  ): void {
    const series = getSeries(state, seriesId);
    if (!series) return;
    addAxis(state.config.xAxis, { id: xAxisId });
    updateSeries(state, seriesId, (targetSeries) => {
      targetSeries.xAxisId = xAxisId;
    });
  }

  export function applyXAxisOptions(
    state: Chart.State,
    opts: Partial<XAxisConfig.Schema>,
  ): void {
    state.config.xAxis = { ...state.config.xAxis, ...opts };
  }

  export function setYAxisExtent(
    state: Chart.State,
    axisId: string,
    extent: Extent,
  ): void {
    updateYAxis(state, axisId, (axis) => {
      axis.visibleExtent = extent;
    });
  }

  export function resetYAxisExtent(state: Chart.State, axisId: string): void {
    updateYAxis(state, axisId, (axis) => {
      axis.visibleExtent = undefined;
      axis.margins = { top: 0.1, bottom: 0.1 };
    });
  }

  export function setYAxisMargins(
    state: Chart.State,
    axisId: string,
    margins: Margins,
  ): void {
    updateYAxis(state, axisId, (axis) => {
      axis.margins = {
        top: margins.top ?? axis.margins.top,
        bottom: margins.bottom ?? axis.margins.bottom,
      };
    });
  }

  export function applyYAxisOptions(
    state: Chart.State,
    axisId: string,
    opts: Partial<YAxis>,
  ): void {
    updateYAxis(state, axisId, (axis) => {
      if ("mode" in opts && !("modeAnchor" in opts)) {
        axis.modeAnchor = undefined;
      }
      Object.assign(axis, opts);
    });
  }

  export function setCrosshair(
    state: Chart.State,
    x: number,
    y: number | undefined,
    logicalIndex: number,
    time?: unknown,
  ): void {
    state.crosshair = {
      visible: true,
      x,
      y,
      logicalIndex,
      time: time as Chart.CrosshairState["time"],
    };
  }

  export function hideCrosshair(state: Chart.State): void {
    state.crosshair = { visible: false };
  }

  export function setHoveredAxis(
    state: Chart.State,
    axisId: string | undefined,
  ): void {
    state.hoveredAxisId = axisId;
  }

  export function setFocusedSeries(
    state: Chart.State,
    seriesId: string | undefined,
  ): void {
    state.hoveredSeriesId = seriesId;
    state.focusedSeriesId = state.lockedSeriesId ?? seriesId;
  }

  export function getVisibleRange(
    state: Chart.State,
    xAxisId?: string,
  ): { from: number; to: number } {
    return asRange(state, xAxisId);
  }

  export function getYAxis(
    state: Chart.State,
    axisId: string,
  ): YAxis | undefined {
    return yAxisById(state, axisId);
  }

  export function getDataLength(state: Chart.State, xAxisId?: string): number {
    return Chart.dataLength(state, xAxisId);
  }

  export function getViewportMiddleSeriesTime(
    state: Chart.State,
    seriesId = mainSeries(state)?.id,
  ): number | undefined {
    const series = seriesId ? getSeries(state, seriesId) : undefined;
    return series ? viewportMiddleSeriesTime(state, series) : undefined;
  }

  export function enforceStateInvariants(state: Chart.State): boolean {
    let changed = false;
    changed = ensurePaneScopedAxes(state) || changed;
    const comparison = state.comparison;
    if (!comparison?.enabled) {
      changed = clearAllComparisonAnchors(state) || changed;
      if (comparison) {
        state.comparison = undefined;
        changed = true;
      }
      return changed;
    }

    let mainSeriesId = comparison.mainSeriesId;
    let main = getSeries(state, mainSeriesId);
    if (!main) {
      main = mainSeries(state);
      if (main) mainSeriesId = main.id;
    }
    if (!main) {
      state.comparison = undefined;
      changed = true;
      changed = clearAllComparisonAnchors(state) || changed;
      return changed;
    }

    const targetAxisId = getYAxis(state, comparison.axisId)
      ? comparison.axisId
      : Series.getYAxisId(main);
    let targetAxis = getYAxis(state, targetAxisId);
    if (!targetAxis) {
      targetAxis = createAxis(
        targetAxisId,
        false,
        ChartStateModel.paneForSeries(state, mainSeriesId)?.id ??
          ChartStateModel.MAIN_PANE_ID,
      );
      (state.config.yAxis.axes as YAxis[]).push(targetAxis);
      changed = true;
    }

    const priceSeriesIds = comparisonPriceSeriesIds(state, mainSeriesId);
    const auxiliarySeriesIds = priceSeriesIds.filter(
      (id) => id !== mainSeriesId,
    );
    const previousSeriesPresentation =
      comparison.previousSeriesPresentation ??
      captureComparisonSeriesPresentation(state);
    changed =
      applyComparisonSeriesPresentation(
        state,
        mainSeriesId,
        auxiliarySeriesIds,
        previousSeriesPresentation,
      ) || changed;
    for (const seriesId of priceSeriesIds) {
      const before = getComparableSeriesSnapshot(state, seriesId);
      const series = getSeries(state, seriesId);
      if (!series) continue;
      updateSeries(state, seriesId, (targetSeries) => {
        targetSeries.yAxisId = targetAxisId;
        targetSeries.axisId = targetAxisId;
        targetSeries.type = "Line";
        targetSeries.fieldMap = comparisonLineFieldMap(series);
        targetSeries.options = comparisonLineOptions(series);
      });
      if (before !== getComparableSeriesSnapshot(state, seriesId)) {
        changed = true;
      }
    }

    const display = comparison.display ?? "percentage_from_anchor";
    const axisMode: YAxis["mode"] =
      display === "indexed_to_main_at_anchor"
        ? comparison.yScale === "logarithmic"
          ? "logarithmic"
          : "normal"
        : "percentage";
    const anchorTime =
      Data.readTime(targetAxis.modeAnchor?.time) ?? comparison.mainBaselineTime;
    const beforeAxis = JSON.stringify(getYAxis(state, targetAxisId));

    applyYAxisOptions(state, targetAxisId, {
      mode: axisMode,
      modeAnchor: anchorTime === undefined ? undefined : { time: anchorTime },
      autoScale: true,
      visibleExtent: undefined,
      labels: { visible: true, style: "muted" },
    });
    if (beforeAxis !== JSON.stringify(getYAxis(state, targetAxisId))) {
      changed = true;
    }

    const nextComparison: Chart.ComparisonState = {
      ...comparison,
      enabled: true,
      mode: "relative_performance",
      axisId: targetAxisId,
      mainSeriesId,
      mainBaselineTime: comparison.mainBaselineTime ?? anchorTime,
      auxiliarySeriesIds,
      adjustment: comparison.adjustment ?? { kind: "none" },
      display,
      fixedZeroAxis:
        display === "percentage_from_anchor" &&
        comparison.fixedZeroAxis === true
          ? true
          : undefined,
      previousSeriesPresentation,
    };
    if (JSON.stringify(state.comparison) !== JSON.stringify(nextComparison)) {
      state.comparison = nextComparison;
      changed = true;
    }

    return changed;
  }

  function ensurePaneScopedAxes(state: Chart.State): boolean {
    const panesByAxis = new Map<string, Map<string, string[]>>();
    for (const [seriesId, series] of ChartStateModel.seriesEntries(state)) {
      const pane =
        ChartStateModel.paneForSeries(state, seriesId)?.id ??
        ChartStateModel.MAIN_PANE_ID;
      const axisId = Series.getYAxisId(series);
      let panes = panesByAxis.get(axisId);
      if (!panes) {
        panes = new Map();
        panesByAxis.set(axisId, panes);
      }
      panes.set(pane, [...(panes.get(pane) ?? []), seriesId]);
    }

    let changed = false;
    for (const [axisId, panes] of panesByAxis) {
      if (panes.size <= 1) continue;
      const axis = getYAxis(state, axisId);
      const fallbackPaneId = panes.keys().next().value;
      if (!fallbackPaneId) continue;
      const axisPaneId = axis?.paneId;
      const ownerPaneId =
        typeof axisPaneId === "string" && panes.has(axisPaneId)
          ? axisPaneId
          : fallbackPaneId;

      for (const [paneId, seriesIds] of panes) {
        if (paneId === ownerPaneId) continue;
        for (const seriesId of seriesIds) {
          const before = getSeries(state, seriesId)?.yAxisId;
          useOwnAxis(state, seriesId);
          changed = before !== getSeries(state, seriesId)?.yAxisId || changed;
        }
      }
    }
    return changed;
  }

  export function enableComparisonMode(
    state: Chart.State,
    input: {
      axisId?: string;
      mainSeriesId?: string;
      auxiliarySeriesIds?: string[];
      anchorTime?: number;
      adjustment?: Chart.ComparisonAdjustment;
      display?: Chart.ComparisonState["display"];
      yScale?: Chart.ComparisonState["yScale"];
      source?: Chart.ComparisonState["source"];
      resetMainBaseline?: boolean;
    } = {},
  ): void {
    const main = input.mainSeriesId
      ? getSeries(state, input.mainSeriesId)
      : mainSeries(state);
    if (!main) return;
    const mainSeriesId = main.id;
    const axisId = input.axisId ?? Series.getYAxisId(main);
    const previousYAxisLayout = state.comparison?.enabled
      ? state.comparison.previousYAxisLayout
      : captureComparisonYAxisLayout(state);
    const previousSeriesPresentation = state.comparison?.enabled
      ? state.comparison.previousSeriesPresentation
      : captureComparisonSeriesPresentation(state);
    const previousAxis =
      state.comparison?.enabled && state.comparison.axisId === axisId
        ? state.comparison.previousAxis
        : (() => {
            const axis = getYAxis(state, axisId);
            if (!axis) return undefined;
            return {
              mode: axis.mode,
              autoScale: axis.autoScale,
              visibleExtent: axis.visibleExtent,
              labels: { ...axis.labels },
              margins: { ...axis.margins },
            };
          })();
    const existingComparisonAnchor =
      state.comparison?.enabled && state.comparison.axisId === axisId
        ? Data.readTime(getYAxis(state, axisId)?.modeAnchor?.time)
        : undefined;
    const display =
      input.display ?? state.comparison?.display ?? "percentage_from_anchor";
    const yScale = input.yScale ?? state.comparison?.yScale;
    const comparisonAxisMode: YAxis["mode"] =
      display === "indexed_to_main_at_anchor"
        ? yScale === "logarithmic"
          ? "logarithmic"
          : "normal"
        : "percentage";

    combineComparisonPriceAxes(state, mainSeriesId, axisId, comparisonAxisMode);
    const resolvedAxisId = Series.getYAxisId(
      getSeries(state, mainSeriesId) ?? main,
    );
    const currentMain = getSeries(state, mainSeriesId) ?? main;
    const auxiliarySeriesIds = uniqueSeriesIds(
      input.auxiliarySeriesIds ??
        comparisonAuxiliarySeriesIds(state, resolvedAxisId, mainSeriesId),
    ).filter((seriesId) => {
      const series = getSeries(state, seriesId);
      if (!series) return false;
      if (seriesId === mainSeriesId) return false;
      if (Series.getYAxisId(series) !== resolvedAxisId) return false;
      return isComparisonPriceSeries(state, seriesId, series, mainSeriesId);
    });
    applyComparisonSeriesPresentation(
      state,
      mainSeriesId,
      auxiliarySeriesIds,
      previousSeriesPresentation,
    );
    const anchorTime =
      Data.readTime(input.anchorTime) ??
      existingComparisonAnchor ??
      viewportMiddleComparisonTime(state, currentMain, auxiliarySeriesIds);

    applyYAxisOptions(state, resolvedAxisId, {
      mode: comparisonAxisMode,
      modeAnchor: anchorTime === undefined ? undefined : { time: anchorTime },
      autoScale: true,
      visibleExtent: undefined,
      labels: { visible: true, style: "muted" },
    });

    const sourceChanged =
      input.source !== undefined &&
      JSON.stringify(input.source) !== JSON.stringify(state.comparison?.source);
    const preserveMainBaseline =
      state.comparison?.enabled &&
      state.comparison.mainSeriesId === mainSeriesId &&
      input.resetMainBaseline !== true &&
      !sourceChanged;

    state.comparison = {
      enabled: true,
      mode: "relative_performance",
      axisId: resolvedAxisId,
      mainSeriesId,
      mainBaselineTime: preserveMainBaseline
        ? (state.comparison?.mainBaselineTime ?? anchorTime)
        : anchorTime,
      auxiliarySeriesIds,
      adjustment: input.adjustment ??
        state.comparison?.adjustment ?? {
          kind: "none",
        },
      display,
      yScale,
      fixedZeroAxis:
        display === "percentage_from_anchor" &&
        state.comparison?.fixedZeroAxis === true
          ? true
          : undefined,
      previousYAxisLayout,
      previousSeriesPresentation,
      previousAxis,
      source: input.source ?? state.comparison?.source,
    };
    enforceStateInvariants(state);
  }

  export function setComparisonAnchor(
    state: Chart.State,
    anchorTime: number,
  ): void {
    const comparison = state.comparison;
    if (!comparison?.enabled) return;
    applyYAxisOptions(state, comparison.axisId, {
      modeAnchor: { time: anchorTime },
      autoScale: true,
      visibleExtent: undefined,
    });
    state.comparison = { ...comparison };
  }

  export function setComparisonAdjustment(
    state: Chart.State,
    adjustment: Chart.ComparisonAdjustment,
  ): void {
    if (!state.comparison?.enabled) return;
    state.comparison.adjustment = adjustment;
    enforceStateInvariants(state);
  }

  export function setComparisonFixedZeroAxis(
    state: Chart.State,
    fixed: boolean,
  ): void {
    const comparison = state.comparison;
    if (!comparison?.enabled) return;
    if (comparison.display === "indexed_to_main_at_anchor") return;
    state.comparison = {
      ...comparison,
      fixedZeroAxis: fixed ? true : undefined,
    };
    enforceStateInvariants(state);
  }

  export function disableComparisonMode(state: Chart.State): void {
    const comparison = state.comparison;
    restoreComparisonSeriesPresentation(
      state,
      comparison?.previousSeriesPresentation,
    );
    const restoredLayout = restoreComparisonYAxisLayout(
      state,
      comparison?.previousYAxisLayout,
    );
    const axisId = comparison?.axisId;
    if (!restoredLayout && axisId && getYAxis(state, axisId)) {
      const previousAxis = comparison?.previousAxis;
      const nextAxis: Partial<YAxis> = {
        mode: previousAxis?.mode ?? "normal",
        modeAnchor: undefined,
        autoScale: previousAxis?.autoScale ?? true,
        visibleExtent: previousAxis?.visibleExtent,
      };
      if (previousAxis?.labels) nextAxis.labels = previousAxis.labels;
      if (previousAxis?.margins) nextAxis.margins = previousAxis.margins;
      applyYAxisOptions(state, axisId, nextAxis);
    }
    state.comparison = undefined;
    enforceStateInvariants(state);
  }

  export function toggleComparisonMode(state: Chart.State): void {
    if (state.comparison?.enabled) {
      disableComparisonMode(state);
      return;
    }
    enableComparisonMode(state);
  }

  function createAxis(
    axisId: string,
    isChildSeries: boolean,
    paneId = ChartStateModel.MAIN_PANE_ID,
  ): YAxis {
    return {
      id: axisId,
      paneId,
      side: "right",
      visible: !isChildSeries,
      fixed: !isChildSeries,
      mode: "normal",
      autoScale: true,
      invertScale: false,
      lockZero: isChildSeries,
      margins: { top: 0.1, bottom: isChildSeries ? 0 : 0.1 },
      style: {
        borderVisible: false,
        borderColor: "#2B2B43",
        ticksVisible: false,
        tickSpacing: 50,
      },
      labels: {
        visible: true,
        style: "default",
      },
      valueLine: {
        visible: true,
        mode: "extended",
        style: "dotted",
      },
    };
  }

  function removeEmptyPanes(state: Chart.State): void {
    ChartStateModel.assertModelReady(state);
    if (state.panes.length <= 1) return;

    state.panes = state.panes.filter((pane, index) => {
      if (index === 0) return true;
      const hasSeries = ChartStateModel.seriesIdsInPane(state, pane.id).some(
        (seriesId) => !!getSeries(state, seriesId),
      );
      // A profile's owner removes it; pruning its pane first would orphan it.
      return (
        hasSeries ||
        pane.objectIds.some((id) =>
          ChartStateModel.isVerticalProfileObject(state.objects[id]),
        )
      );
    });

    ChartStateModel.syncPaneIndices(state);
    ChartStateModel.normalizePaneHeights(state);
  }

  function removeUnusedAxes(state: Chart.State): void {
    ChartStateModel.assertModelReady(state);
    const usedAxisIds = new Set<string>();
    for (const series of seriesValues(state)) {
      usedAxisIds.add(Series.getYAxisId(series));
    }

    const axes = state.config.yAxis.axes as YAxis[];
    const filtered = axes.filter((axis) => usedAxisIds.has(axis.id));

    if (filtered.length === 0) {
      filtered.push(createAxis("right", false));
    }

    // Keep deterministic axis order by side and insertion.
    state.config.yAxis.axes = filtered;

    for (const [seriesId, series] of seriesEntries(state)) {
      if (!filtered.some((axis) => axis.id === series.yAxisId)) {
        updateSeries(state, seriesId, (targetSeries) => {
          targetSeries.yAxisId = "right";
          targetSeries.axisId = "right";
        });
      }
    }

    ensurePrimaryAxisVisible(state);
  }

  function syncAxesForPane(state: Chart.State, paneId: string): void {
    const axes = state.config.yAxis.axes as YAxis[];
    const paneSeries = ChartStateModel.seriesIdsInPane(state, paneId);
    const paneAxisIds = new Set<string>();
    for (const seriesId of paneSeries) {
      const series = getSeries(state, seriesId);
      if (!series) continue;
      paneAxisIds.add(Series.getYAxisId(series));
    }

    for (const axis of axes) {
      if (!paneAxisIds.has(axis.id)) continue;
      axis.paneId = paneId;
    }
  }

  function updateYAxis(
    state: Chart.State,
    axisId: string,
    updater: (axis: YAxis) => void,
  ): void {
    const axes = state.config.yAxis.axes as YAxis[];
    const idx = axes.findIndex((a) => a.id === axisId);
    if (idx < 0) return;
    const nextAxis = cloneYAxis(axes[idx]!);
    updater(nextAxis);
    axes[idx] = nextAxis;
  }

  function reorderAxisForSideStack(
    state: Chart.State,
    axisId: string,
    side: YAxis["side"],
  ): void {
    const axes = state.config.yAxis.axes as YAxis[];
    const idx = axes.findIndex((axis) => axis.id === axisId);
    if (idx < 0) return;
    const axis = axes[idx]!;
    axes.splice(idx, 1);

    if (side === "right") {
      axes.push(axis);
      return;
    }

    const firstLeftIdx = axes.findIndex((item) => item.side === "left");
    if (firstLeftIdx < 0) {
      axes.unshift(axis);
    } else {
      axes.splice(firstLeftIdx, 0, axis);
    }
  }

  function ensurePrimaryAxisVisible(state: Chart.State): void {
    for (const pane of state.panes) {
      const primarySeriesId = ChartStateUtils.getPrimarySeriesId(
        state,
        pane.id,
      );
      if (!primarySeriesId) continue;
      const primarySeries = getSeries(state, primarySeriesId);
      if (!primarySeries) continue;
      const primaryAxisId = Series.getYAxisId(primarySeries);
      const axis = getYAxis(state, primaryAxisId);
      if (!axis) continue;
      axis.fixed = true;
      axis.visible = true;
    }
  }

  function swapPrimaryAxisPresentationRole(
    state: Chart.State,
    previousPrimarySeriesId?: string,
    nextPrimarySeriesId?: string,
  ): void {
    if (!previousPrimarySeriesId || !nextPrimarySeriesId) return;
    if (previousPrimarySeriesId === nextPrimarySeriesId) return;

    const previousPrimarySeries = getSeries(state, previousPrimarySeriesId);
    const nextPrimarySeries = getSeries(state, nextPrimarySeriesId);
    if (!previousPrimarySeries || !nextPrimarySeries) return;

    const previousAxisId = Series.getYAxisId(previousPrimarySeries);
    const nextAxisId = Series.getYAxisId(nextPrimarySeries);
    if (previousAxisId === nextAxisId) return;

    const previousAxis = getYAxis(state, previousAxisId);
    const nextAxis = getYAxis(state, nextAxisId);
    if (!previousAxis || !nextAxis) return;

    const previousRole: AxisPresentationRole = {
      fixed: previousAxis.fixed,
      visible: previousAxis.visible,
      side: previousAxis.side,
    };
    const nextRole: AxisPresentationRole = {
      fixed: nextAxis.fixed,
      visible: nextAxis.visible,
      side: nextAxis.side,
    };

    applyAxisPresentationRole(previousAxis, nextRole);
    applyAxisPresentationRole(nextAxis, previousRole);

    if (previousAxis.fixed) {
      reorderAxisForSideStack(state, previousAxis.id, previousAxis.side);
    }
    if (nextAxis.fixed) {
      reorderAxisForSideStack(state, nextAxis.id, nextAxis.side);
    }
  }

  function applyAxisPresentationRole(
    axis: YAxis,
    role: AxisPresentationRole,
  ): void {
    axis.fixed = role.fixed;
    axis.visible = role.visible;
    axis.side = role.side;
  }
}
