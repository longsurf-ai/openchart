// Purpose: Tests for assembling browser-equivalent chart state for headless renders
// Module:  @openchart/chart-core / headless

import { describe, expect, it } from "vitest";
import { Series } from "@openchart/chart-core/series";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import { ChartStateUtils } from "@openchart/chart-core/v2/state/utilities";
import { assembleChartState } from "./state-builder";

const bars = Array.from({ length: 20 }, (_, index) => ({
  time: 1_700_000_000 + index * 86_400,
  open: 100 + index,
  high: 102 + index,
  low: 98 + index,
  close: 101 + index,
  volume: 1_000_000,
}));

describe("assembleChartState", () => {
  it("shares a y-axis across non-overlay indicator outputs", () => {
    const state = assembleChartState(
      {
        symbol: "AAPL",
        resolution: "1d",
        indicators: [{ name: "RSI" }],
      },
      { bars },
      {
        RSI: {
          overlay: false,
          columns: {
            rsi: bars.map((_, index) => 45 + Math.sin(index) * 10),
            rsiMa: bars.map(() => 50),
            upperBand: bars.map(() => 70),
            middleBand: bars.map(() => 50),
            lowerBand: bars.map(() => 30),
          },
        },
      },
    );

    const outputIds = [
      "RSI_0_rsi",
      "RSI_0_rsiMa",
      "RSI_0_upperBand",
      "RSI_0_middleBand",
      "RSI_0_lowerBand",
    ];
    const axisIds = outputIds.map((id) => {
      const series = ChartStateModel.getSeries(state, id);
      expect(series).toBeTruthy();
      return Series.getYAxisId(series!);
    });

    expect(new Set(axisIds)).toHaveLength(1);
    expect(ChartStateUtils.getYAxis(state, axisIds[0]!)).toMatchObject({
      autoScale: false,
      visibleExtent: { min: 0, max: 100 },
    });
    expect(
      ChartStateModel.getSeries(state, "RSI_0_upperBand")?.options,
    ).toMatchObject({
      bandFillToSeriesId: "RSI_0_lowerBand",
      bandFillColor: "rgba(155, 109, 243, 0.12)",
    });
  });
});
