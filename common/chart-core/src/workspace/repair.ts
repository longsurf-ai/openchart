// Purpose: Repair persisted dashboard workspace shape before hydration or save
// Module:  @openchart/chart-core / workspace

export type WorkspaceRepairChange = {
  code: string;
  path: string;
  detail?: unknown;
};

export type WorkspaceRepairResult = {
  workspace: unknown;
  changed: boolean;
  changes: WorkspaceRepairChange[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneWorkspace(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  return structuredClone(value);
}

function canonicalPaneId(index: number): string {
  return index === 0 ? "pane-main" : `pane-${index + 1}`;
}

function numericIndex(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function pushMainFirst(ids: string[]): string[] {
  const out = stringArray(ids);
  const mainIndex = out.indexOf("main");
  if (mainIndex > 0) {
    out.splice(mainIndex, 1);
    out.unshift("main");
  }
  return out;
}

function isRuntimeVolumeAxisId(axisId: unknown): boolean {
  return (
    axisId === "volume" ||
    (typeof axisId === "string" && axisId.endsWith(":volume"))
  );
}

function addChange(
  changes: WorkspaceRepairChange[],
  code: string,
  path: string,
  detail?: unknown,
): void {
  changes.push({ code, path, detail });
}

function repairConfigAxes(
  chart: Record<string, unknown>,
  paneIdRemap: ReadonlyMap<string, string>,
  objectAxisPaneIds: ReadonlyMap<string, string>,
  changes: WorkspaceRepairChange[],
  chartPath: string,
): void {
  const config = chart.config;
  if (!isPlainObject(config)) return;
  const yAxis = config.yAxis;
  if (!isPlainObject(yAxis) || !Array.isArray(yAxis.axes)) return;

  const nextAxes: unknown[] = [];
  for (const [axisIndex, rawAxis] of yAxis.axes.entries()) {
    if (!isPlainObject(rawAxis)) {
      nextAxes.push(rawAxis);
      continue;
    }
    const axis = rawAxis as Record<string, unknown>;
    if (isRuntimeVolumeAxisId(axis.id)) {
      addChange(
        changes,
        "drop-runtime-volume-axis",
        `${chartPath}.config.yAxis.axes.${axisIndex}`,
      );
      continue;
    }
    if (typeof axis.paneId === "string") {
      const remapped = paneIdRemap.get(axis.paneId);
      const owningPane =
        typeof axis.id === "string"
          ? objectAxisPaneIds.get(axis.id)
          : undefined;
      const nextPaneId = owningPane ?? remapped;
      if (nextPaneId && nextPaneId !== axis.paneId) {
        axis.paneId = nextPaneId;
        addChange(
          changes,
          "repair-axis-pane",
          `${chartPath}.config.yAxis.axes.${axisIndex}`,
        );
      }
    }
    nextAxes.push(axis);
  }
  yAxis.axes = nextAxes;
}

function repairComparison(
  chart: Record<string, unknown>,
  objectIds: ReadonlySet<string>,
  axisIds: ReadonlySet<string>,
  changes: WorkspaceRepairChange[],
  chartPath: string,
): void {
  const comparison = chart.comparison;
  if (!isPlainObject(comparison) || comparison.enabled !== true) {
    if (comparison !== undefined) {
      delete chart.comparison;
      addChange(changes, "drop-disabled-comparison", `${chartPath}.comparison`);
    }
    return;
  }

  const mainSeriesId =
    typeof comparison.mainSeriesId === "string"
      ? comparison.mainSeriesId
      : "main";
  const axisId = typeof comparison.axisId === "string" ? comparison.axisId : "";
  const auxiliarySeriesIds = stringArray(comparison.auxiliarySeriesIds);
  const missingAuxiliary = auxiliarySeriesIds.some((id) => !objectIds.has(id));
  if (
    !objectIds.has(mainSeriesId) ||
    !axisIds.has(axisId) ||
    missingAuxiliary
  ) {
    delete chart.comparison;
    addChange(changes, "drop-stale-comparison", `${chartPath}.comparison`, {
      mainSeriesId,
      axisId,
      auxiliarySeriesIds,
    });
    return;
  }

  comparison.mainSeriesId = mainSeriesId;
  comparison.axisId = axisId;
  comparison.auxiliarySeriesIds = auxiliarySeriesIds;
}

function repairIndicators(
  chart: Record<string, unknown>,
  objectIds: ReadonlySet<string>,
  changes: WorkspaceRepairChange[],
  chartPath: string,
): void {
  if (!isPlainObject(chart.indicators)) {
    chart.indicators = {};
    return;
  }

  for (const [instanceId, rawIndicator] of Object.entries(chart.indicators)) {
    if (!isPlainObject(rawIndicator)) {
      delete chart.indicators[instanceId];
      addChange(
        changes,
        "drop-invalid-indicator",
        `${chartPath}.indicators.${instanceId}`,
      );
      continue;
    }
    const outputObjectIds = stringArray(rawIndicator.outputObjectIds).filter(
      (id) => objectIds.has(id),
    );
    if (outputObjectIds.length === 0) {
      delete chart.indicators[instanceId];
      addChange(
        changes,
        "drop-empty-indicator",
        `${chartPath}.indicators.${instanceId}`,
      );
      continue;
    }
    rawIndicator.outputObjectIds = outputObjectIds;
  }
}

function repairChart(
  chartId: string,
  rawChart: unknown,
  changes: WorkspaceRepairChange[],
): unknown {
  if (!isPlainObject(rawChart)) {
    addChange(changes, "drop-invalid-chart", `charts.${chartId}`);
    return undefined;
  }

  const chart = rawChart;
  if (chart.id !== chartId) {
    chart.id = chartId;
    addChange(changes, "repair-chart-id", `charts.${chartId}.id`);
  }

  const sourcePanes = Array.isArray(chart.panes) ? chart.panes : [];
  const orderedPanes = (sourcePanes.length > 0 ? sourcePanes : [{}]).sort(
    (a, b) =>
      numericIndex(isPlainObject(a) ? a.index : undefined, 0) -
      numericIndex(isPlainObject(b) ? b.index : undefined, 0),
  );

  const paneIdRemap = new Map<string, string>();
  const panes = orderedPanes.map((rawPane, index) => {
    const pane = isPlainObject(rawPane) ? rawPane : {};
    const nextId = canonicalPaneId(index);
    if (typeof pane.id === "string" && pane.id.length > 0) {
      paneIdRemap.set(pane.id, nextId);
    }
    if (pane.id !== nextId || pane.index !== index) {
      addChange(
        changes,
        "repair-pane-identity",
        `charts.${chartId}.panes.${index}`,
      );
    }
    return {
      ...pane,
      id: nextId,
      index,
      height: positiveNumber(pane.height, 1),
      objectIds: stringArray(pane.objectIds),
    };
  });

  const validPaneIds = new Set(panes.map((pane) => pane.id));
  const objects: Record<string, Record<string, unknown>> = {};
  for (const [objectId, rawObject] of Object.entries(
    isPlainObject(chart.objects) ? chart.objects : {},
  )) {
    if (!isPlainObject(rawObject)) {
      addChange(
        changes,
        "drop-invalid-object",
        `charts.${chartId}.objects.${objectId}`,
      );
      continue;
    }
    const paneId =
      typeof rawObject.paneId === "string"
        ? (paneIdRemap.get(rawObject.paneId) ?? rawObject.paneId)
        : "pane-main";
    const nextPaneId = validPaneIds.has(paneId) ? paneId : "pane-main";
    if (rawObject.kind === "series") {
      if (!isPlainObject(rawObject.series)) {
        addChange(
          changes,
          "drop-invalid-series-object",
          `charts.${chartId}.objects.${objectId}`,
        );
        continue;
      }
      const series = rawObject.series;
      const yAxisId =
        typeof series.yAxisId === "string" && series.yAxisId.length > 0
          ? series.yAxisId
          : typeof series.axisId === "string" && series.axisId.length > 0
            ? series.axisId
            : typeof rawObject.axisId === "string"
              ? rawObject.axisId
              : "right";
      objects[objectId] = {
        ...rawObject,
        id: objectId,
        paneId: nextPaneId,
        seriesId: objectId,
        axisId:
          typeof rawObject.axisId === "string" ? rawObject.axisId : yAxisId,
        series: {
          ...series,
          id: objectId,
          data: [],
          xAxisId: typeof series.xAxisId === "string" ? series.xAxisId : "main",
          yAxisId,
          axisId: yAxisId,
        },
      };
      continue;
    }
    if (rawObject.kind === "drawing") {
      objects[objectId] = {
        ...rawObject,
        id: objectId,
        paneId: nextPaneId,
      };
      continue;
    }
    addChange(
      changes,
      "drop-unknown-object",
      `charts.${chartId}.objects.${objectId}`,
    );
  }

  const objectIds = new Set(Object.keys(objects));
  const paneMembership = new Map<string, string[]>();
  for (const pane of panes) {
    paneMembership.set(
      pane.id,
      pushMainFirst(
        pane.objectIds.filter((objectId) => objectIds.has(objectId)),
      ),
    );
  }
  for (const [objectId, object] of Object.entries(objects)) {
    const paneId =
      typeof object.paneId === "string" && validPaneIds.has(object.paneId)
        ? object.paneId
        : "pane-main";
    const membership = paneMembership.get(paneId) ?? [];
    if (!membership.includes(objectId)) membership.push(objectId);
    paneMembership.set(paneId, pushMainFirst(membership));
  }

  let compactPanes = panes
    .map((pane) => ({
      ...pane,
      objectIds: paneMembership.get(pane.id) ?? [],
    }))
    .filter((pane, index) => index === 0 || pane.objectIds.length > 0);
  if (compactPanes.length === 0) {
    compactPanes = [{ id: "pane-main", index: 0, height: 1, objectIds: [] }];
  }

  const compactRemap = new Map<string, string>();
  compactPanes = compactPanes.map((pane, index) => {
    const nextId = canonicalPaneId(index);
    compactRemap.set(pane.id, nextId);
    return {
      ...pane,
      id: nextId,
      index,
      objectIds: pushMainFirst(pane.objectIds),
    };
  });
  for (const object of Object.values(objects)) {
    if (typeof object.paneId === "string") {
      object.paneId = compactRemap.get(object.paneId) ?? object.paneId;
    }
  }

  chart.panes = compactPanes;
  chart.objects = objects;

  const objectAxisPaneIds = new Map<string, string>();
  for (const object of Object.values(objects)) {
    if (
      object.kind === "series" &&
      typeof object.axisId === "string" &&
      typeof object.paneId === "string"
    ) {
      objectAxisPaneIds.set(object.axisId, object.paneId);
    }
  }
  const finalPaneRemap = new Map([...paneIdRemap, ...compactRemap]);
  repairConfigAxes(
    chart,
    finalPaneRemap,
    objectAxisPaneIds,
    changes,
    `charts.${chartId}`,
  );

  const axisIds = new Set(objectAxisPaneIds.keys());
  repairIndicators(chart, objectIds, changes, `charts.${chartId}`);
  repairComparison(chart, objectIds, axisIds, changes, `charts.${chartId}`);
  return chart;
}

function visibleChartIdsFromLayout(
  layout: unknown,
  charts: Record<string, unknown>,
): string[] {
  if (isPlainObject(layout) && Array.isArray(layout.cells)) {
    const ids = layout.cells.flatMap((cell) => {
      if (!isPlainObject(cell)) return [];
      return cell.kind === "chart" && typeof cell.resourceId === "string"
        ? [cell.resourceId]
        : [];
    });
    if (ids.length > 0) return stringArray(ids);
  }
  if (isPlainObject(layout) && isPlainObject(layout.positions)) {
    const ids = Object.keys(layout.positions);
    if (ids.length > 0) return stringArray(ids);
  }
  return Object.keys(charts);
}

export function repairDashboardWorkspace(
  input: unknown,
): WorkspaceRepairResult {
  const workspace = cloneWorkspace(input);
  const changes: WorkspaceRepairChange[] = [];
  if (!isPlainObject(workspace)) {
    return { workspace: input, changed: false, changes };
  }

  const chartsSource = isPlainObject(workspace.charts) ? workspace.charts : {};
  const visibleChartIds = visibleChartIdsFromLayout(
    workspace.layout,
    chartsSource,
  );
  const charts: Record<string, unknown> = {};
  for (const chartId of visibleChartIds) {
    const repaired = repairChart(chartId, chartsSource[chartId], changes);
    if (repaired) charts[chartId] = repaired;
  }
  const repairedChartIds = Object.keys(charts);
  const repairedChartIdSet = new Set(repairedChartIds);
  if (Object.keys(charts).length !== Object.keys(chartsSource).length) {
    addChange(changes, "scope-workspace-charts", "charts");
  }
  workspace.charts = charts;
  workspace.dataSeries = isPlainObject(workspace.dataSeries)
    ? workspace.dataSeries
    : {};

  const seriesInputs: Record<string, unknown> = {};
  const sourceInputs = isPlainObject(workspace.seriesInputs)
    ? workspace.seriesInputs
    : {};
  for (const chartId of repairedChartIds) {
    const chart = charts[chartId];
    if (!isPlainObject(chart) || !isPlainObject(chart.objects)) continue;
    const validSeriesIds = new Set(Object.keys(chart.objects));
    const chartInputs = isPlainObject(sourceInputs[chartId])
      ? sourceInputs[chartId]
      : {};
    seriesInputs[chartId] = Object.fromEntries(
      Object.entries(chartInputs).filter(([seriesId]) =>
        validSeriesIds.has(seriesId),
      ),
    );
  }
  workspace.seriesInputs = seriesInputs;

  const layout = workspace.layout;
  if (isPlainObject(layout)) {
    if (Array.isArray(layout.cells)) {
      layout.cells = layout.cells.filter(
        (cell) =>
          isPlainObject(cell) &&
          (cell.kind !== "chart" ||
            (typeof cell.resourceId === "string" &&
              repairedChartIdSet.has(cell.resourceId))),
      );
    }
    if (isPlainObject(layout.positions)) {
      layout.positions = Object.fromEntries(
        Object.entries(layout.positions).filter(([chartId]) =>
          repairedChartIdSet.has(chartId),
        ),
      );
    }
    if (Array.isArray(layout.links)) {
      layout.links = layout.links.filter(
        (link) =>
          isPlainObject(link) &&
          typeof link.from === "string" &&
          typeof link.to === "string" &&
          repairedChartIdSet.has(link.from) &&
          repairedChartIdSet.has(link.to),
      );
    }
  }

  return {
    workspace,
    changed: changes.length > 0,
    changes,
  };
}
