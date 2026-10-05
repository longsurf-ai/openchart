import { describe, expect, it } from "vitest";
import { v2 } from "@openchart/chart-core";
import { Series } from "@openchart/chart-core/series";

describe("Pane axis autoscale semantics", () => {
  it("ignores stale visibleExtent when axis autoScale is true", () => {
    const state = v2.createState();
    const main = v2.ChartStateUtils.addSeries(state, {
      type: "Candlestick",
      pane: 0,
    });
    const secondary = v2.ChartStateUtils.addSeries(state, {
      type: "Candlestick",
      pane: 1,
    });
    expect(main).toBeTruthy();
    expect(secondary).toBeTruthy();

    const secondarySeries = v2.ChartStateUtils.getSeries(state, secondary)!;
    const axisId = Series.getYAxisId(secondarySeries);
    const axis = state.config.yAxis.axes.find((item) => item.id === axisId);
    expect(axis).toBeTruthy();

    axis.autoScale = true;
    axis.visibleExtent = { min: 0, max: 150 };
    axis.lockZero = true;

    // Simulate A/L auto toggle-off then on flow that should clear manual range influence.
    v2.ChartStateUtils.applyYAxisOptions(state, axisId, {
      autoScale: true,
      mode: "normal",
    });

    expect(axis.autoScale).toBe(true);
    // Manual range may still exist in persisted state, but renderer should ignore it while autoScale=true.
    expect(axis.visibleExtent).toEqual({ min: 0, max: 150 });
  });
});
