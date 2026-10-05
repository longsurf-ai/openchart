// Purpose: Low-level object model for chart state — pane/series/drawing CRUD, invariant validation, and pane-height normalization
// Module:  @openchart/chart-core / v2 / state

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Chart, ChartObjectId } from "@openchart/chart-core/chart/state";
import { Drawing } from "@openchart/chart-core/drawing";
import { Series } from "@openchart/chart-core/series";
import { UUID } from "@openchart/chart-core/util";
import { annotationFromDrawing } from "@openchart/chart-core/annotation/drawing";
import type { ChartAnnotation } from "@openchart/chart-core/annotation/types";

export namespace ChartStateModel {
  export const MAIN_PANE_ID = "pane-main";
  export const MAX_PANES = 8;
  export const MIN_PANE_HEIGHT = 20;
  const MAIN_SERIES_OBJECT_ID = ChartObjectId.parse("main");

  export function createPaneId(): string {
    return `pane_${UUID.random()}`;
  }

  export type SeriesObject = Chart.SeriesObject;
  export type DrawingObject = Chart.DrawingObject;
  export type ObjectState = Chart.ObjectState;

  export type ComputeNode = {
    id: string;
    definitionId?: string;
    name: string;
    outputObjectIds: string[];
    createdAt: number;
    updatedAt: number;
  };

  export function isSeriesObject(
    value: Chart.ObjectState | undefined,
  ): value is SeriesObject {
    return (
      !!value &&
      typeof value === "object" &&
      (value as { kind?: string }).kind === "series"
    );
  }

  export function isDrawingObject(
    value: Chart.ObjectState | undefined,
  ): value is DrawingObject {
    return (
      !!value &&
      typeof value === "object" &&
      (value as { kind?: string }).kind === "drawing"
    );
  }

  export function isVerticalProfileObject(
    value: Chart.ObjectState | undefined,
  ): value is Chart.VerticalProfileObject {
    return (
      !!value &&
      typeof value === "object" &&
      (value as { kind?: string }).kind === "vertical-profile"
    );
  }

  export function paneById(
    state: Chart.State,
    paneId: string,
  ): Chart.Pane | undefined {
    return findPaneById(state, paneId);
  }

  export function paneByIndex(
    state: Chart.State,
    paneIndex: number,
  ): Chart.Pane | undefined {
    return state.panes[paneIndex];
  }

  export function paneIndexForPaneId(
    state: Chart.State,
    paneId: string,
  ): number {
    const index = state.panes.findIndex((pane) => pane.id === paneId);
    return index >= 0 ? index : 0;
  }

  export function paneIndexForSeriesId(
    state: Chart.State,
    seriesId: string,
  ): number {
    const object = state.objects[ChartObjectId.parse(seriesId)];
    if (!isSeriesObject(object)) return 0;
    return paneIndexForPaneId(state, object.paneId);
  }

  export function paneForSeries(
    state: Chart.State,
    seriesId: string,
  ): Chart.Pane | undefined {
    const object = state.objects[ChartObjectId.parse(seriesId)];
    if (!isSeriesObject(object)) return undefined;
    return paneById(state, object.paneId);
  }

  export function getSeries(
    state: Chart.State,
    seriesId: string,
  ): Series.State | undefined {
    const object = state.objects[ChartObjectId.parse(seriesId)];
    if (!isSeriesObject(object)) return undefined;
    return object.series;
  }

  export function resolveSeriesData(
    state: Chart.State,
    seriesId: string,
  ): unknown[] | undefined {
    const object = state.objects[ChartObjectId.parse(seriesId)];
    if (!isSeriesObject(object)) return undefined;
    if (object.series.data.length > 0) return object.series.data;
    if (object.dataRef) {
      return state.dataSeries?.[object.dataRef]?.data ?? object.series.data;
    }
    return object.series.data;
  }

  export function resolvedSeries(
    state: Chart.State,
    seriesId: string,
  ): Series.State | undefined {
    const object = state.objects[ChartObjectId.parse(seriesId)];
    if (!isSeriesObject(object)) return undefined;
    const data = resolveSeriesData(state, seriesId);
    if (data === undefined || data === object.series.data) {
      return object.series;
    }
    return { ...object.series, data };
  }

  export function requireSeries(
    state: Chart.State,
    seriesId: string,
  ): Series.State {
    const series = getSeries(state, seriesId);
    if (series) return series;
    throw new Error(
      `[ChartStateModel:E_SERIES_NOT_FOUND] chartId=${state.id} seriesId=${seriesId}`,
    );
  }

  export function seriesEntries(
    state: Chart.State,
  ): Array<[ChartObjectId, Series.State]> {
    const entries: Array<[ChartObjectId, Series.State]> = [];
    const seen = new Set<ChartObjectId>();
    for (const pane of state.panes) {
      for (const objectId of pane.objectIds) {
        const object = state.objects[objectId];
        if (!isSeriesObject(object)) continue;
        if (seen.has(object.seriesId)) continue;
        seen.add(object.seriesId);
        entries.push([object.seriesId, object.series]);
      }
    }
    return entries;
  }

  export function resolvedSeriesEntries(
    state: Chart.State,
  ): Array<[ChartObjectId, Series.State]> {
    return seriesEntries(state).map(([seriesId, series]) => {
      const data = resolveSeriesData(state, seriesId);
      return [
        seriesId,
        data === undefined || data === series.data
          ? series
          : { ...series, data },
      ];
    });
  }

  export function seriesIds(state: Chart.State): ChartObjectId[] {
    const ids: ChartObjectId[] = [];
    const seen = new Set<ChartObjectId>();
    for (const pane of state.panes) {
      for (const objectId of pane.objectIds) {
        const object = state.objects[objectId];
        if (!isSeriesObject(object)) continue;
        if (seen.has(object.seriesId)) continue;
        seen.add(object.seriesId);
        ids.push(object.seriesId);
      }
    }
    return ids;
  }

  export function mainSeries(state: Chart.State): Series.State | undefined {
    for (const object of Object.values(state.objects)) {
      if (isSeriesObject(object) && object.role === "main")
        return resolvedSeries(state, object.seriesId);
    }
    const main = resolvedSeries(state, MAIN_SERIES_OBJECT_ID);
    if (main) return main;
    for (const id of paneById(state, MAIN_PANE_ID)?.objectIds ?? []) {
      const object = state.objects[id];
      if (
        isSeriesObject(object) &&
        object.source === "provider" &&
        !object.series.parentId &&
        object.series.type !== "Histogram"
      ) {
        return resolvedSeries(state, id);
      }
    }
    return undefined;
  }

  export function seriesValues(state: Chart.State): Series.State[] {
    return seriesEntries(state).map(([, series]) => series);
  }

  export function resolvedSeriesValues(state: Chart.State): Series.State[] {
    return resolvedSeriesEntries(state).map(([, series]) => series);
  }

  /** Find the chart-local indicator grouping node that owns a visual series ID. */
  export function indicatorForSeries(
    state: Chart.State,
    seriesId: string,
  ): { instanceId: string; node: Chart.IndicatorNode } | undefined {
    for (const [instanceId, node] of Object.entries(state.indicators ?? {})) {
      if (node.outputObjectIds?.includes(seriesId)) {
        return { instanceId, node };
      }
    }
    return undefined;
  }

  /** Create a shared DataSeriesEntry. */
  export function createDataSeries(
    state: Chart.State,
    id: string,
    columns: string[],
  ): void {
    if (!state.dataSeries) state.dataSeries = {};
    state.dataSeries[id] = { id, data: [], columns };
  }

  /** Write data to a shared DataSeriesEntry. */
  export function setDataSeriesData(
    state: Chart.State,
    dataId: string,
    data: unknown[],
  ): void {
    if (!state.dataSeries?.[dataId]) return;
    state.dataSeries[dataId].data = data;
  }

  /** Get a SeriesObject (not just Series.State) by ID. */
  export function getSeriesObject(
    state: Chart.State,
    seriesId: string,
  ): SeriesObject | undefined {
    const object = state.objects[ChartObjectId.parse(seriesId)];
    if (!isSeriesObject(object)) return undefined;
    return object;
  }

  export function seriesObjectIds(
    state: Chart.State,
    paneId?: string,
  ): ChartObjectId[] {
    const ids: ChartObjectId[] = [];
    const targetPanes = paneId
      ? state.panes.filter((pane) => pane.id === paneId)
      : state.panes;
    for (const pane of targetPanes) {
      for (const objectId of pane.objectIds) {
        const object = state.objects[objectId];
        if (isSeriesObject(object)) {
          ids.push(object.id);
        }
      }
    }
    return ids;
  }

  export function seriesIdsInPane(
    state: Chart.State,
    paneId: string,
  ): ChartObjectId[] {
    const pane = paneById(state, paneId);
    if (!pane) return [];
    const ids: ChartObjectId[] = [];
    for (const objectId of pane.objectIds) {
      const object = state.objects[objectId];
      if (isSeriesObject(object)) {
        ids.push(object.seriesId);
      }
    }
    return ids;
  }

  export function drawingItems(state: Chart.State): Drawing.Item[] {
    const items: Drawing.Item[] = [];
    for (const pane of state.panes) {
      for (const objectId of pane.objectIds) {
        const object = state.objects[objectId];
        if (!isDrawingObject(object)) continue;
        items.push(object.item);
      }
    }
    return items;
  }

  /** Derive annotation overlays from chart objects; legacy records and drafts keep their existing owners.
   * @example const annotations = ChartStateModel.annotationItems(state);
   */
  export function annotationItems(
    state: Chart.State,
  ): ChartAnnotation.Renderable[] {
    const drawings = drawingItems(state).filter(
      (item) => item.type === "annotation",
    );
    if (drawings.length === 0) return state.annotations;
    return [...state.annotations, ...drawings.map(annotationFromDrawing)];
  }

  export function upsertDrawingObject(
    state: Chart.State,
    item: Drawing.Item,
    paneId?: string,
  ): void {
    assertModelReady(state);
    const id = ChartObjectId.parse(item.id);
    const existing = state.objects[id];
    if (existing && !isDrawingObject(existing)) {
      throw new Error(`Object ${id} is not a drawing`);
    }
    const targetPaneId =
      paneId ??
      existing?.paneId ??
      state.config.yAxis.axes.find(
        (axis) => axis.id === item.anchors[0]?.axisId,
      )?.paneId ??
      MAIN_PANE_ID;
    if (!paneById(state, targetPaneId)) {
      throw new Error(`Unknown drawing pane ${targetPaneId}`);
    }
    state.objects[id] = {
      ...existing,
      id,
      kind: "drawing",
      paneId: targetPaneId,
      item: Drawing.normalize(item),
    };
    for (const pane of state.panes) {
      if (pane.id !== targetPaneId) removeObjectFromPane(state, pane.id, id);
    }
    addObjectToPane(state, targetPaneId, id);
  }

  export function removeDrawingObject(
    state: Chart.State,
    drawingId: string,
  ): void {
    assertModelReady(state);
    const id = ChartObjectId.parse(drawingId);
    if (!isDrawingObject(state.objects[id])) return;
    delete state.objects[id];
    for (const pane of state.panes) removeObjectFromPane(state, pane.id, id);
    const drawings = state.drawings;
    if (drawings.selectedId === id) drawings.selectedId = undefined;
    if (drawings.hoveredId === id) drawings.hoveredId = undefined;
    if (state.activeAnnotationId === id) state.activeAnnotationId = undefined;
    if (state.hoveredAnnotationId === id) {
      state.hoveredAnnotationId = undefined;
      state.hoveredAnnotationPart = undefined;
    }
    if (state.expandedAnnotation?.id === id)
      state.expandedAnnotation = undefined;
    if (drawings.contextMenu?.id === id) drawings.contextMenu = undefined;
    if (drawings.configId === id) drawings.configId = undefined;
  }

  /**
   * Place or replace a vertical profile in `paneId`, drawn on `axisId`'s y
   * scale. The profile is transient view state owned by its React component.
   * @throws When the id belongs to another object kind or the pane is unknown.
   * @example ChartStateModel.upsertVerticalProfileObject(state, { id: "vp", paneId: "pane-main", axisId: "right", profile });
   */
  export function upsertVerticalProfileObject(
    state: Chart.State,
    object: Omit<Chart.VerticalProfileObject, "id" | "kind"> & { id: string },
  ): void {
    assertModelReady(state);
    const id = ChartObjectId.parse(object.id);
    const existing = state.objects[id];
    if (existing && !isVerticalProfileObject(existing)) {
      throw new Error(`Object ${id} is not a vertical profile`);
    }
    if (!paneById(state, object.paneId)) {
      throw new Error(`Unknown vertical profile pane ${object.paneId}`);
    }
    state.objects[id] = { ...object, id, kind: "vertical-profile" };
    for (const pane of state.panes) {
      if (pane.id !== object.paneId) removeObjectFromPane(state, pane.id, id);
    }
    addObjectToPane(state, object.paneId, id);
  }

  /** Remove a vertical profile; other kinds and unknown ids are left alone. */
  export function removeVerticalProfileObject(
    state: Chart.State,
    profileId: string,
  ): void {
    assertModelReady(state);
    const id = ChartObjectId.parse(profileId);
    if (!isVerticalProfileObject(state.objects[id])) return;
    delete state.objects[id];
    for (const pane of state.panes) removeObjectFromPane(state, pane.id, id);
  }

  export function upsertSeriesObject(
    state: Chart.State,
    seriesId: string,
    paneId: string,
    nextSeries?: Series.State,
    source: "provider" | "derived" | "computed" | "metric" = "provider",
    dataRef?: string,
  ): void {
    const objectId = ChartObjectId.parse(seriesId);
    const existing = state.objects[objectId];
    const current = isSeriesObject(existing) ? existing.series : undefined;
    const series = nextSeries ?? current;
    if (!series) return;
    const pane = findPaneById(state, paneId);
    if (!pane) return;
    const normalizedSeries: Series.State = {
      ...series,
      id: objectId,
      yAxisId: Series.getYAxisId(series),
      axisId: Series.getYAxisId(series),
    };
    const resolvedDataRef =
      dataRef ?? (isSeriesObject(existing) ? existing.dataRef : undefined);
    const next: SeriesObject = isSeriesObject(existing)
      ? {
          ...existing,
          paneId,
          axisId: Series.getYAxisId(normalizedSeries),
          comparable: isComparableSeries(normalizedSeries),
          dataRef: resolvedDataRef,
          series: normalizedSeries,
        }
      : {
          id: objectId,
          kind: "series",
          paneId,
          seriesId: objectId,
          axisId: Series.getYAxisId(normalizedSeries),
          source,
          comparable: isComparableSeries(normalizedSeries),
          dataRef: resolvedDataRef,
          series: normalizedSeries,
        };
    for (const p of state.panes) {
      if (p.id === paneId) continue;
      removeObjectFromPane(state, p.id, objectId);
    }
    state.objects[objectId] = next;
    addObjectToPane(state, paneId, objectId);
  }

  export function removeSeriesObject(
    state: Chart.State,
    seriesId: string,
  ): void {
    const objectId = ChartObjectId.parse(seriesId);
    delete state.objects[objectId];
    for (const pane of state.panes) {
      removeObjectFromPane(state, pane.id, objectId);
    }
  }

  export function setObjectPane(
    state: Chart.State,
    objectId: string,
    paneId: string,
  ): void {
    assertModelReady(state);
    const id = ChartObjectId.parse(objectId);
    const pane = paneById(state, paneId);
    const object = state.objects[id];
    if (!pane || !object) return;
    for (const p of state.panes) {
      removeObjectFromPane(state, p.id, id);
    }
    addObjectToPane(state, paneId, id);
    if (isSeriesObject(object)) {
      object.paneId = paneId;
    }
    if (isDrawingObject(object) || isVerticalProfileObject(object)) {
      object.paneId = paneId;
    }
  }

  export function assertModelReady(state: Chart.State): void {
    const issue = firstModelIssue(state);
    if (!issue) return;
    throw new Error(
      `[ChartStateModel:${issue.code}] chartId=${state.id} ${issue.message}`,
    );
  }

  export function normalizePaneHeights(state: Chart.State): void {
    assertModelReady(state);
    const total = state.config.chart.dimensions.height;
    const sum = state.panes.reduce(
      (acc, pane) => acc + Math.max(1, pane.height),
      0,
    );
    if (sum <= 0) {
      const each = total / Math.max(1, state.panes.length);
      for (const pane of state.panes) pane.height = each;
      return;
    }
    for (const pane of state.panes) {
      pane.height = Math.max(
        MIN_PANE_HEIGHT,
        (Math.max(1, pane.height) / sum) * total,
      );
    }
  }

  export function syncPaneIndices(state: Chart.State): void {
    for (let index = 0; index < state.panes.length; index += 1) {
      const pane = state.panes[index];
      if (!pane) continue;
      pane.index = index;
    }
  }

  function addObjectToPane(
    state: Chart.State,
    paneId: string,
    objectId: ChartObjectId,
  ): void {
    const pane = findPaneById(state, paneId);
    if (!pane) return;
    if (pane.objectIds.includes(objectId)) return;
    pane.objectIds.push(objectId);
    ensureMainFirst(pane);
  }

  /** Main series is always first in objectIds — enforced on every mutation. */
  export function ensureMainFirst(pane: Chart.Pane): void {
    const idx = pane.objectIds.indexOf(MAIN_SERIES_OBJECT_ID);
    if (idx > 0) {
      pane.objectIds.splice(idx, 1);
      pane.objectIds.unshift(MAIN_SERIES_OBJECT_ID);
    }
  }

  function removeObjectFromPane(
    state: Chart.State,
    paneId: string,
    objectId: ChartObjectId,
  ): void {
    const pane = findPaneById(state, paneId);
    if (!pane) return;
    const idx = pane.objectIds.indexOf(objectId);
    if (idx >= 0) pane.objectIds.splice(idx, 1);
  }

  function findPaneById(
    state: Chart.State,
    paneId: string,
  ): Chart.Pane | undefined {
    return state.panes.find((pane) => pane.id === paneId);
  }

  type ModelIssue = { code: string; message: string };

  function firstModelIssue(state: Chart.State): ModelIssue | null {
    if (state.schemaVersion !== 3) {
      return {
        code: "E_SCHEMA_VERSION",
        message: `expected schemaVersion=3, got ${String(state.schemaVersion)}`,
      };
    }
    if (!state.panes || state.panes.length === 0) {
      return { code: "E_PANES_MISSING", message: "expected at least one pane" };
    }
    if (!state.objects || typeof state.objects !== "object") {
      return { code: "E_OBJECTS_MISSING", message: "expected objects map" };
    }
    if (!state.indicators || typeof state.indicators !== "object") {
      return {
        code: "E_INDICATORS_MISSING",
        message: "expected indicators map",
      };
    }

    const paneById = new Set<string>();
    const paneForObjectId = new Map<string, string>();
    for (let i = 0; i < state.panes.length; i++) {
      const pane = state.panes[i];
      if (!pane)
        return {
          code: "E_PANE_MISSING",
          message: `missing pane at index=${i}`,
        };
      if (!pane.id)
        return {
          code: "E_PANE_ID_MISSING",
          message: `missing pane id at index=${i}`,
        };
      if (pane.index !== i) {
        return {
          code: "E_PANE_INDEX_INVALID",
          message: `pane id=${pane.id} has index=${pane.index}, expected ${i}`,
        };
      }
      if (i === 0 && pane.id !== MAIN_PANE_ID) {
        return {
          code: "E_PANE_ID_INVALID",
          message: `pane index=0 has id=${pane.id}, expected ${MAIN_PANE_ID}`,
        };
      }
      if (i > 0 && pane.id === MAIN_PANE_ID) {
        return {
          code: "E_PANE_ID_INVALID",
          message: `non-main pane index=${i} cannot reuse ${MAIN_PANE_ID}`,
        };
      }
      if (!Array.isArray(pane.objectIds)) {
        return {
          code: "E_PANE_OBJECTIDS_INVALID",
          message: `pane id=${pane.id} has non-array objectIds`,
        };
      }
      if (paneById.has(pane.id)) {
        return {
          code: "E_PANE_ID_DUPLICATE",
          message: `duplicate pane id=${pane.id}`,
        };
      }
      paneById.add(pane.id);
      const paneObjectIds = new Set<string>();
      for (const objectId of pane.objectIds) {
        if (paneObjectIds.has(objectId)) {
          return {
            code: "E_PANE_OBJECT_DUPLICATE",
            message: `pane id=${pane.id} has duplicate objectId=${objectId}`,
          };
        }
        paneObjectIds.add(objectId);
        if (!state.objects[objectId]) {
          return {
            code: "E_PANE_OBJECT_REF_MISSING",
            message: `pane id=${pane.id} references missing objectId=${objectId}`,
          };
        }
        const mappedPaneId = paneForObjectId.get(objectId);
        if (mappedPaneId && mappedPaneId !== pane.id) {
          return {
            code: "E_OBJECT_MULTI_PANE",
            message: `objectId=${objectId} belongs to paneId=${mappedPaneId} and paneId=${pane.id}`,
          };
        }
        paneForObjectId.set(objectId, pane.id);
      }
    }

    const seriesIdSet = new Set<string>();
    for (const [objectId, object] of Object.entries(state.objects)) {
      if (isSeriesObject(object)) {
        if (object.id !== objectId) {
          return {
            code: "E_SERIES_OBJECT_ID_MISMATCH",
            message: `series object key=${objectId} has id=${object.id}`,
          };
        }
        if (!object.seriesId) {
          return {
            code: "E_SERIES_OBJECT_SERIESID_MISSING",
            message: `series object id=${object.id} has missing seriesId`,
          };
        }
        if (object.seriesId !== objectId) {
          return {
            code: "E_SERIES_OBJECT_MISMATCH",
            message: `series object id=${object.id} has seriesId=${object.seriesId}, expected ${objectId}`,
          };
        }
        if (seriesIdSet.has(object.seriesId)) {
          return {
            code: "E_SERIES_ID_DUPLICATE",
            message: `duplicate seriesId=${object.seriesId}`,
          };
        }
        seriesIdSet.add(object.seriesId);
        if (!object.series || typeof object.series !== "object") {
          return {
            code: "E_SERIES_PAYLOAD_MISSING",
            message: `series object id=${object.id} missing series payload`,
          };
        }
        if (object.series.id !== object.seriesId) {
          return {
            code: "E_SERIES_PAYLOAD_ID_MISMATCH",
            message: `series payload id=${object.series.id} does not match seriesId=${object.seriesId}`,
          };
        }
        if (!paneById.has(object.paneId)) {
          return {
            code: "E_SERIES_OBJECT_PANE_MISSING",
            message: `seriesId=${object.seriesId} points to unknown paneId=${object.paneId}`,
          };
        }
        const mappedPaneId = paneForObjectId.get(object.id);
        if (!mappedPaneId) {
          return {
            code: "E_SERIES_OBJECT_ORPHAN",
            message: `seriesId=${object.seriesId} missing from pane objectIds`,
          };
        }
        if (mappedPaneId !== object.paneId) {
          return {
            code: "E_PANE_SERIES_MEMBERSHIP",
            message: `seriesId=${object.seriesId} mapped to paneId=${mappedPaneId}, object paneId=${object.paneId}`,
          };
        }
        const axisId = Series.getYAxisId(object.series);
        if (object.axisId !== axisId) {
          return {
            code: "E_SERIES_AXIS_MISMATCH",
            message: `seriesId=${object.seriesId} object axisId=${object.axisId} but series axisId=${axisId}`,
          };
        }
        continue;
      }
      if (isDrawingObject(object)) {
        if (object.id !== objectId) {
          return {
            code: "E_DRAWING_OBJECT_ID_MISMATCH",
            message: `drawing object key=${objectId} has id=${object.id}`,
          };
        }
        if (!paneById.has(object.paneId)) {
          return {
            code: "E_DRAWING_OBJECT_PANE_MISSING",
            message: `drawingId=${object.id} points to unknown paneId=${object.paneId}`,
          };
        }
        const mappedPaneId = paneForObjectId.get(object.id);
        if (!mappedPaneId) {
          return {
            code: "E_DRAWING_OBJECT_ORPHAN",
            message: `drawingId=${object.id} missing from pane objectIds`,
          };
        }
        if (mappedPaneId !== object.paneId) {
          return {
            code: "E_DRAWING_OBJECT_PANE_MISMATCH",
            message: `drawingId=${object.id} mapped to paneId=${mappedPaneId}, object paneId=${object.paneId}`,
          };
        }
        continue;
      }
      if (isVerticalProfileObject(object)) {
        if (object.id !== objectId) {
          return {
            code: "E_PROFILE_OBJECT_ID_MISMATCH",
            message: `profile object key=${objectId} has id=${object.id}`,
          };
        }
        if (!paneById.has(object.paneId)) {
          return {
            code: "E_PROFILE_OBJECT_PANE_MISSING",
            message: `profileId=${object.id} points to unknown paneId=${object.paneId}`,
          };
        }
        if (paneForObjectId.get(object.id) !== object.paneId) {
          return {
            code: "E_PROFILE_OBJECT_PANE_MISMATCH",
            message: `profileId=${object.id} is not in its pane's objectIds`,
          };
        }
        continue;
      }
      return {
        code: "E_OBJECT_KIND_INVALID",
        message: `object id=${objectId} has unsupported kind`,
      };
    }

    for (const objectId of Object.keys(state.objects)) {
      if (!paneForObjectId.has(objectId)) {
        return {
          code: "E_OBJECT_NOT_IN_PANE",
          message: `object id=${objectId} is not referenced by any pane`,
        };
      }
    }

    return null;
  }

  function isComparableSeries(series: Series.State): boolean {
    if (series.type === "Histogram") return false;
    if (series.parentId) return false;
    return true;
  }
}
