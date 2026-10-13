// Purpose: Tests for v2 chart API helper invariants
// Module:  @openchart/chart-core / v2 / api

import { describe, expect, it } from "vitest";
import { createState } from "@openchart/chart-core/v2/state/defaults";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import { ChartStateUtils } from "@openchart/chart-core/v2/state/utilities";
import { computeVisibleExtent } from "./helpers";

describe("computeVisibleExtent", () => {
  it("excludes hidden outputs and their histogram zero baseline", () => {
    const state = createState({
      series: {
        selected: {
          type: "Line",
          data: [
            { time: 1, value: 110 },
            { time: 2, value: 120 },
          ],
        },
        hidden: {
          type: "Histogram",
          options: { visible: false },
          data: [
            { time: 1, value: 10_000 },
            { time: 2, value: 20_000 },
          ],
        },
      },
    });
    expect(computeVisibleExtent({ state }, "right")).toEqual({
      min: 110,
      max: 120,
    });
    ChartStateUtils.applySeriesOptions(state, "hidden", { visible: true });
    expect(computeVisibleExtent({ state }, "right")).toEqual({
      min: 0,
      max: 20_000,
    });
    ChartStateUtils.applySeriesOptions(state, "selected", { visible: false });
    ChartStateUtils.applySeriesOptions(state, "hidden", { visible: false });
    expect(computeVisibleExtent({ state }, "right")).toEqual({
      min: 0,
      max: 100,
    });
  });

  it("uses resolved dataRef series data for axis extents", () => {
    const state = createState({
      series: {
        main: {
          type: "Line",
          data: [],
          fieldMap: { value: "close" },
        },
      },
    });
    ChartStateModel.createDataSeries(state, "shared-main", ["time", "close"]);
    ChartStateModel.setDataSeriesData(state, "shared-main", [
      { time: 1, close: 10 },
      { time: 2, close: 20 },
      { time: 3, close: 30 },
    ]);
    ChartStateModel.upsertSeriesObject(
      state,
      "main",
      ChartStateModel.MAIN_PANE_ID,
      ChartStateModel.getSeries(state, "main"),
      "provider",
      "shared-main",
    );

    expect(computeVisibleExtent({ state }, "right")).toEqual({
      min: 10,
      max: 30,
    });
  });
});
