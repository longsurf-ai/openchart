// Purpose: Factory functions to create canonical Chart.State and Series.State with validated defaults
// Module:  @openchart/chart-core / v2 / state

import { Chart } from "@openchart/chart-core/chart/state";
import { Series } from "@openchart/chart-core/series";
import { ChartConfig } from "@openchart/chart-core/config";
import { UUID } from "@openchart/chart-core/util";
import { addAxis } from "@openchart/chart-core/v2/x-scale";
import { ChartStateModel } from "./model";

type SeriesInput = {
  type: string;
  data?: unknown[];
  options?: Record<string, unknown>;
  paneIndex?: number;
  xAxisId?: string;
  yAxisId?: string;
  fieldMap?: Record<string, string>;
  parentId?: string;
};

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

export function createState(options?: {
  id?: string;
  config?: Partial<ChartConfig.Full>;
  series?: Record<string, SeriesInput>;
}): Chart.State {
  const id = options?.id ?? UUID.random();
  const state = Chart.create(id, options?.config);

  if (options?.series) {
    for (const [seriesId, seriesConfig] of Object.entries(options.series)) {
      const parsedOptions = parseSeriesOptions(
        seriesConfig.type,
        seriesConfig.options,
      );
      const xAxisId = seriesConfig.xAxisId ?? state.config.xAxis.activeId;
      if (!state.config.xAxis.axes.find((axis) => axis.id === xAxisId)) {
        addAxis(state.config.xAxis, { id: xAxisId });
      }

      const paneIndex = Number.isFinite(seriesConfig.paneIndex)
        ? Math.max(0, Math.floor(seriesConfig.paneIndex!))
        : 0;
      while (state.panes.length <= paneIndex) {
        const nextIndex = state.panes.length;
        state.panes.push({
          id:
            nextIndex === 0
              ? ChartStateModel.MAIN_PANE_ID
              : ChartStateModel.createPaneId(),
          index: nextIndex,
          height: state.config.chart.dimensions.height / (nextIndex + 1),
          objectIds: [],
        });
      }
      const pane = state.panes[paneIndex]!;
      const series: Series.State = {
        id: seriesId,
        type: seriesConfig.type,
        options: parsedOptions,
        data: seriesConfig.data ?? [],
        xAxisId,
        yAxisId: seriesConfig.yAxisId ?? "right",
        axisId: seriesConfig.yAxisId ?? "right",
        fieldMap: seriesConfig.fieldMap,
        parentId: seriesConfig.parentId,
      };
      ChartStateModel.upsertSeriesObject(
        state,
        seriesId,
        pane.id,
        series,
        "provider",
      );
    }
  }

  if (!state.objects) state.objects = {};
  if (!state.indicators) state.indicators = {};
  for (let i = 0; i < state.panes.length; i++) {
    const pane = state.panes[i]!;
    if (i === 0) {
      pane.id = ChartStateModel.MAIN_PANE_ID;
    } else if (!pane.id || pane.id === ChartStateModel.MAIN_PANE_ID) {
      pane.id = ChartStateModel.createPaneId();
    }
    pane.index = i;
    if (!Array.isArray(pane.objectIds)) pane.objectIds = [];
  }
  ChartStateModel.syncPaneIndices(state);

  state.schemaVersion = 3;
  ChartStateModel.assertModelReady(state);
  return state;
}

export function createSeriesState(
  type: string,
  options?: {
    id?: string;
    data?: unknown[];
    options?: Record<string, unknown>;
    xAxisId?: string;
    yAxisId?: string;
    fieldMap?: Record<string, string>;
    parentId?: string;
  },
): Series.State {
  const id = options?.id ?? UUID.random();
  const parsedOptions = parseSeriesOptions(type, options?.options);

  return {
    id,
    type,
    options: parsedOptions,
    data: options?.data ?? [],
    xAxisId: options?.xAxisId ?? "main",
    yAxisId: options?.yAxisId ?? "right",
    fieldMap: options?.fieldMap,
    parentId: options?.parentId,
  };
}
