// Purpose: Assemble a valid Chart.State from a ChartSpec + fetched data for headless rendering
// Module:  @openchart/chart-core / headless

import { Chart } from "@openchart/chart-core/chart/state";
import { ChartConfig } from "@openchart/chart-core/config";
import { Series } from "@openchart/chart-core/series";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import { ChartStateUtils } from "@openchart/chart-core/v2/state/utilities";
import { createSeriesState } from "@openchart/chart-core/v2/state/defaults";
import type { ConfigTypes } from "@openchart/chart-core/config";

/** OHLCV bar as returned by the API. */
export interface OhlcvBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Pre-fetched data for the main series. */
export interface SeriesData {
  bars: OhlcvBar[];
}

/** Pre-fetched indicator output data. */
export interface IndicatorData {
  /** Output column name → array of values (same length as main bars). */
  columns: Record<string, Array<number | null>>;
  /** Whether this indicator overlays on the main chart (true) or gets its own pane (false). */
  overlay: boolean;
}

/** Indicator specification in the chart spec. */
export interface IndicatorSpec {
  name: string;
  params?: Record<string, unknown>;
  style?: Record<
    string,
    {
      color?: string;
      lineWidth?: number;
      lineStyle?: "solid" | "dashed" | "dotted";
    }
  >;
}

/** Full chart spec describing what to render. */
export interface ChartSpec {
  /** Instrument symbol (for display purposes in headless mode). */
  symbol: string;
  /** Bar resolution string (e.g. '1d', '1h'). */
  resolution: string;
  /** Series type for the main data. */
  seriesType?:
    "Candlestick" | "Line" | "Area" | "Bar" | "Histogram" | "Baseline";
  /** Partial options override for the main series type. */
  seriesOptions?: Record<string, unknown>;
  /** Indicator definitions. Data must be pre-fetched and passed separately. */
  indicators?: IndicatorSpec[];
  /** Deep-partial override for the unified chart config. */
  config?: ConfigTypes.DeepPartial<ChartConfig.Full>;
  /** Output dimensions. */
  output?: {
    width?: number;
    height?: number;
  };
}

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 600;

/**
 * Assemble a complete, valid Chart.State from a spec and pre-fetched data.
 *
 * This is a pure function — no network calls, no reactivity.
 * Callers are responsible for fetching bars and indicator data beforehand.
 */
export function assembleChartState(
  spec: ChartSpec,
  seriesData: SeriesData,
  indicatorDataMap?: Record<string, IndicatorData>,
): Chart.State {
  const width = spec.output?.width ?? DEFAULT_WIDTH;
  const height = spec.output?.height ?? DEFAULT_HEIGHT;

  // Build config with full defaults, then apply user overrides
  const config = ChartConfig.create({
    ...spec.config,
    chart: {
      ...spec.config?.chart,
      dimensions: {
        width,
        height,
        autoResize: false,
        ...spec.config?.chart?.dimensions,
      },
    },
  });

  const state = Chart.create(`headless-${Date.now()}`);
  state.config = config;
  // Update main pane height to match configured dimensions
  state.panes[0]!.height = height;

  // Create main series
  const seriesType = spec.seriesType ?? "Candlestick";
  const mainSeriesId = "main";

  // Candlestick/Bar use OHLCV directly; others use {time, value} (close price)
  const needsOhlcv = seriesType === "Candlestick" || seriesType === "Bar";
  const mainData = needsOhlcv
    ? seriesData.bars
    : seriesData.bars.map((b) => ({ time: b.time, value: b.close }));
  const mainFieldMap = needsOhlcv ? undefined : { x: "time", y: "value" };

  const mainSeries = createSeriesState(seriesType, {
    id: mainSeriesId,
    data: mainData,
    options: {
      title: spec.symbol,
      ...spec.seriesOptions,
    },
    fieldMap: mainFieldMap,
  });

  ChartStateModel.upsertSeriesObject(
    state,
    mainSeriesId,
    ChartStateModel.MAIN_PANE_ID,
    mainSeries,
    "provider",
  );

  // Add indicator series
  if (spec.indicators && indicatorDataMap) {
    for (const [idx, indicator] of spec.indicators.entries()) {
      const data = indicatorDataMap[indicator.name];
      if (!data) continue;

      const isOverlay = data.overlay;
      let paneId: string;
      let sharedAxisSeriesId: string | null = null;

      if (isOverlay) {
        paneId = ChartStateModel.MAIN_PANE_ID;
      } else {
        // Create a sub-pane for non-overlay indicators
        paneId = ChartStateModel.createPaneId();
        state.panes.push({
          id: paneId,
          index: state.panes.length,
          height: Math.round(height * 0.25),
          objectIds: [],
        });
      }

      // Create a series for each output column
      const outputSeriesIds: Record<string, string> = {};
      for (const [columnName, values] of Object.entries(data.columns)) {
        const seriesId = `${indicator.name}_${idx}_${columnName}`;
        const styleOverride = indicator.style?.[columnName];

        // Map indicator data to {time, value} format using main series timestamps
        const lineData = values.map((v, i) => ({
          time: seriesData.bars[i]?.time ?? 0,
          value: v,
        }));

        const indicatorSeries = createSeriesState("Line", {
          id: seriesId,
          data: lineData,
          options: {
            title: `${indicator.name} ${columnName}`,
            visible: true,
            ...(styleOverride?.color && { color: styleOverride.color }),
            ...(styleOverride?.lineWidth && {
              lineWidth: styleOverride.lineWidth,
            }),
            ...(styleOverride?.lineStyle && {
              lineStyle: styleOverride.lineStyle,
            }),
          },
          fieldMap: { x: "time", y: "value" },
        });

        ChartStateModel.upsertSeriesObject(
          state,
          seriesId,
          paneId,
          indicatorSeries,
          "derived",
        );

        if (isOverlay) {
          ChartStateUtils.shareYAxis(state, seriesId, mainSeriesId);
        } else if (sharedAxisSeriesId) {
          ChartStateUtils.shareYAxis(state, seriesId, sharedAxisSeriesId);
        } else {
          ChartStateUtils.useOwnAxis(state, seriesId);
          sharedAxisSeriesId = seriesId;
        }
        outputSeriesIds[columnName] = seriesId;
      }

      if (indicator.name.trim().toLowerCase() === "rsi") {
        const rsiDefaults: Record<string, Record<string, unknown>> = {
          rsi: { title: "RSI", color: "#8b5cf6", lineWidth: 1 },
          rsiMa: {
            title: "RSI-based MA",
            color: "#facc15",
            lineWidth: 1,
          },
          upperBand: {
            title: "Upper Band",
            color: "#8a8f99",
            lineWidth: 1,
            lineStyle: "dashed",
            lastValueVisible: false,
            valueLineVisible: false,
            crosshairMarkerVisible: false,
          },
          middleBand: {
            title: "Middle Band",
            color: "#a7abb3",
            lineWidth: 1,
            lineStyle: "dotted",
            lastValueVisible: false,
            valueLineVisible: false,
            crosshairMarkerVisible: false,
          },
          lowerBand: {
            title: "Lower Band",
            color: "#8a8f99",
            lineWidth: 1,
            lineStyle: "dashed",
            lastValueVisible: false,
            valueLineVisible: false,
            crosshairMarkerVisible: false,
          },
        };
        for (const [columnName, seriesId] of Object.entries(outputSeriesIds)) {
          const defaults = rsiDefaults[columnName];
          if (defaults) {
            ChartStateUtils.applySeriesOptions(state, seriesId, defaults);
          }
        }
        const upperSeriesId = outputSeriesIds.upperBand;
        const lowerSeriesId = outputSeriesIds.lowerBand;
        const rsiSeriesId = outputSeriesIds.rsi ?? upperSeriesId;
        if (upperSeriesId && lowerSeriesId) {
          ChartStateUtils.applySeriesOptions(state, upperSeriesId, {
            bandFillToSeriesId: lowerSeriesId,
            bandFillColor: "rgba(155, 109, 243, 0.12)",
          });
        }
        if (rsiSeriesId) {
          const rsiSeries = ChartStateModel.getSeries(state, rsiSeriesId);
          if (rsiSeries) {
            ChartStateUtils.applyYAxisOptions(
              state,
              Series.getYAxisId(rsiSeries),
              {
                autoScale: false,
                visibleExtent: { min: 0, max: 100 },
                margins: { top: 0.06, bottom: 0.06 },
              },
            );
          }
        }
      }
    }
  }

  const indicatorPaneCount = state.panes.length - 1;
  if (indicatorPaneCount > 0 && state.panes[0]) {
    const mainHeight = Math.round(height * 0.68);
    const indicatorHeight = Math.max(
      96,
      Math.round((height - mainHeight) / indicatorPaneCount),
    );
    state.panes[0].height = mainHeight;
    for (let index = 1; index < state.panes.length; index++) {
      state.panes[index]!.height = indicatorHeight;
    }
  }

  // Re-normalize pane indices
  ChartStateModel.syncPaneIndices(state);
  ChartStateModel.assertModelReady(state);

  return state;
}
