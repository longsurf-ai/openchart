// Purpose: Tests for ChartStateUtils — covers series CRUD, resize, scrolling, axis management, crosshair, and invariant enforcement
// Module:  @openchart/chart-core / v2 / state

import { describe, it, expect } from "vitest";
import { ChartStateModel } from "./model";
import { ChartStateUtils } from "./utilities";
import { createState } from "./defaults";
import { getAxis } from "@openchart/chart-core/v2/x-scale";
import { ChartObjectId } from "@openchart/chart-core/chart/state";

describe("ChartStateUtils", () => {
  describe("addSeries", () => {
    it("returns created series id", () => {
      const state = createState();
      const seriesId = ChartStateUtils.addSeries(state, { type: "Line" });

      expect(typeof seriesId).toBe("string");
      expect(seriesId.length).toBeGreaterThan(0);
      expect(ChartStateUtils.getSeries(state, seriesId)).toBeDefined();
    });

    it("adds series to empty state", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [{ time: 1, value: 100 }],
      });

      const seriesIds = ChartStateUtils.seriesIds(state);
      expect(seriesIds).toHaveLength(1);
      expect(ChartStateUtils.getSeries(state, seriesIds[0]!)!.type).toBe(
        "Line",
      );
    });

    it("adds series to existing state", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.addSeries(state, { type: "Area" });

      expect(ChartStateUtils.seriesIds(state)).toHaveLength(2);
    });

    it("creates axis when needed for histogram", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Histogram",
      });

      const series = ChartStateUtils.seriesEntries(state)[0]![1];
      expect(series.yAxisId).toMatch(/^histogram-/);

      const axes = state.config.yAxis.axes;
      const histogramAxis = axes.find((a) => a.id === series.yAxisId);
      expect(histogramAxis).toBeDefined();
      expect(histogramAxis!.lockZero).toBe(true);
      expect(histogramAxis!.visible).toBe(false);
      expect(histogramAxis!.fixed).toBe(false);
    });

    it("preserves an existing shared axis when a histogram joins", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, { type: "Line", yAxisId: "study" });
      ChartStateUtils.applyYAxisOptions(state, "study", {
        side: "left",
        autoScale: false,
        mode: "logarithmic",
      });
      const axis = structuredClone(ChartStateUtils.getYAxis(state, "study"));
      ChartStateUtils.addSeries(state, {
        type: "Histogram",
        yAxisId: "study",
      });
      expect(ChartStateUtils.getYAxis(state, "study")).toEqual(axis);
    });

    it("assigns to correct pane", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        pane: 1,
      });

      const series = ChartStateUtils.seriesEntries(state)[0]![1];
      expect(ChartStateModel.paneIndexForSeriesId(state, series.id)).toBe(1);
      expect(state.panes).toHaveLength(2);
    });

    it("keeps an authored main series independent of object ID and pane order", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        id: "comparison",
        type: "Line",
        pane: 0,
      });
      ChartStateUtils.addSeries(state, {
        id: "csr_price",
        type: "Candlestick",
        pane: 1,
      });
      ChartStateModel.getSeriesObject(state, "csr_price")!.role = "main";
      ChartStateUtils.setSeriesData(state, "csr_price", [
        { time: 1, close: 10 },
      ]);
      expect(ChartStateModel.mainSeries(state)?.id).toBe("csr_price");
      expect(ChartStateUtils.mainSeries(state)?.id).toBe("csr_price");
    });

    it("opens a detached pane at roughly a quarter of the chart height", () => {
      const state = createState({
        series: {
          main: { type: "Candlestick" },
        },
      });

      ChartStateUtils.addSeries(state, {
        type: "Line",
        pane: 1,
      });

      const totalHeight = state.panes.reduce(
        (sum, pane) => sum + pane.height,
        0,
      );
      expect(state.panes[1]!.height / totalHeight).toBeCloseTo(0.25, 6);
    });

    it("mutates state in place", () => {
      const state = createState();
      const originalSeriesCount = ChartStateUtils.seriesIds(state).length;
      ChartStateUtils.addSeries(state, { type: "Line" });

      expect(ChartStateUtils.seriesIds(state).length).toBe(
        originalSeriesCount + 1,
      );
    });

    it("resolves shared dataRef data through read APIs", () => {
      const state = createState({
        series: {
          main: { type: "Line", data: [] },
        },
      });
      ChartStateModel.createDataSeries(state, "shared-main", ["time", "close"]);
      ChartStateModel.setDataSeriesData(state, "shared-main", [
        { time: 10, close: 100 },
      ]);
      ChartStateUtils.addSeries(state, {
        id: "shared-series",
        type: "Line",
        data: [],
        dataRef: "shared-main",
      });

      expect(ChartStateUtils.getSeries(state, "shared-series")?.data).toEqual([
        { time: 10, close: 100 },
      ]);
      expect(
        ChartStateUtils.seriesEntries(state).find(
          ([id]) => id === "shared-series",
        )?.[1].data,
      ).toEqual([{ time: 10, close: 100 }]);

      ChartStateModel.upsertSeriesObject(
        state,
        "main",
        ChartStateModel.MAIN_PANE_ID,
        ChartStateModel.getSeries(state, "main"),
        "provider",
        "shared-main",
      );
      expect(ChartStateUtils.mainSeries(state)?.data).toEqual([
        { time: 10, close: 100 },
      ]);
    });

    it("keeps visual writes isolated from optional shared dataRef backing", () => {
      const state = createState();
      ChartStateModel.createDataSeries(state, "shared-main", ["time", "close"]);
      ChartStateModel.setDataSeriesData(state, "shared-main", [
        { time: 1, close: 1 },
      ]);
      ChartStateUtils.addSeries(state, {
        id: "shared-series",
        type: "Line",
        data: [],
        dataRef: "shared-main",
      });

      ChartStateUtils.setSeriesData(state, "shared-series", [
        { time: 10, close: 100 },
      ]);
      ChartStateUtils.updateSeriesBar(state, "shared-series", {
        time: 20,
        close: 110,
      });
      ChartStateUtils.updateSeriesBar(state, "shared-series", {
        time: 20,
        close: 120,
      });

      expect(state.dataSeries?.["shared-main"]?.data).toEqual([
        { time: 1, close: 1 },
      ]);
      expect(ChartStateUtils.getSeries(state, "shared-series")?.data).toEqual([
        { time: 10, close: 100 },
        { time: 20, close: 120 },
      ]);
    });
  });

  describe("removeSeries", () => {
    it("removes series from state", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, { type: "Line" });
      const seriesId = ChartStateUtils.seriesIds(state)[0]!;

      ChartStateUtils.removeSeries(state, seriesId);
      expect(ChartStateUtils.seriesIds(state)).toHaveLength(0);
    });

    it("removes from pane objectIds", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, { type: "Line" });
      const seriesId = ChartStateUtils.seriesIds(state)[0]!;

      expect(state.panes[0]!.objectIds).toContain(seriesId);

      ChartStateUtils.removeSeries(state, seriesId);
      expect(state.panes[0]!.objectIds).not.toContain(seriesId);
    });

    it("handles non-existent series gracefully", () => {
      const state = createState();
      const originalState = JSON.stringify(state);
      ChartStateUtils.removeSeries(state, "non-existent");

      expect(JSON.stringify(state)).toBe(originalState);
    });

    it("removes orphaned axis after deleting last series bound to it", () => {
      const state = createState();
      const seriesId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.useOwnAxis(state, seriesId);
      const axisId = ChartStateUtils.getSeries(state, seriesId)!.yAxisId;

      expect(state.config.yAxis.axes.some((a) => a.id === axisId)).toBe(true);
      ChartStateUtils.removeSeries(state, seriesId);
      expect(state.config.yAxis.axes.some((a) => a.id === axisId)).toBe(false);
    });

    it("removes empty non-main panes", () => {
      const state = createState();
      const seriesId = ChartStateUtils.addSeries(state, {
        type: "Line",
        pane: 1,
      });

      expect(state.panes.length).toBe(2);
      ChartStateUtils.removeSeries(state, seriesId);
      expect(state.panes.length).toBe(1);
    });

    it("reindexes surviving pane-scoped series and axes after removing a middle pane", () => {
      const state = createState();
      const first = ChartStateUtils.addSeries(state, { type: "Line", pane: 1 });
      const second = ChartStateUtils.addSeries(state, {
        type: "Line",
        pane: 2,
      });
      const third = ChartStateUtils.addSeries(state, { type: "Line", pane: 3 });

      ChartStateUtils.useOwnAxis(state, second);
      ChartStateUtils.useOwnAxis(state, third);

      const secondPaneId = (state.objects[second] as { paneId: string }).paneId;
      const thirdPaneId = (state.objects[third] as { paneId: string }).paneId;
      const secondAxisId = ChartStateUtils.getSeries(state, second)!.yAxisId;
      const thirdAxisId = ChartStateUtils.getSeries(state, third)!.yAxisId;

      ChartStateUtils.removeSeries(state, first);

      expect(state.panes.map((pane) => pane.id)).toEqual([
        ChartStateModel.MAIN_PANE_ID,
        secondPaneId,
        thirdPaneId,
      ]);

      const secondObject = state.objects[second];
      const thirdObject = state.objects[third];
      expect(ChartStateModel.paneIndexForSeriesId(state, second)).toBe(1);
      expect(ChartStateModel.paneIndexForSeriesId(state, third)).toBe(2);
      expect((secondObject as { paneId: string }).paneId).toBe(secondPaneId);
      expect((thirdObject as { paneId: string }).paneId).toBe(thirdPaneId);

      const secondAxis = state.config.yAxis.axes.find(
        (axis) => axis.id === secondAxisId,
      );
      const thirdAxis = state.config.yAxis.axes.find(
        (axis) => axis.id === thirdAxisId,
      );
      expect(secondAxis?.paneId).toBe(secondPaneId);
      expect(thirdAxis?.paneId).toBe(thirdPaneId);

      expect(() => ChartStateUtils.removeSeries(state, third)).not.toThrow();
    });
  });

  describe("useOwnAxis", () => {
    it("removes the pane default axis after rebinding a pane series to its own axis", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Line",
        pane: 1,
      });
      const paneId = (state.objects[compareId] as { paneId: string }).paneId;
      const defaultAxisId = ChartStateUtils.getSeries(
        state,
        compareId,
      )!.yAxisId;

      ChartStateUtils.useOwnAxis(state, compareId);

      const compareAxisId = ChartStateUtils.getSeries(
        state,
        compareId,
      )!.yAxisId;
      expect(compareAxisId).not.toBe(defaultAxisId);
      expect(
        state.config.yAxis.axes.some((axis) => axis.id === defaultAxisId),
      ).toBe(false);

      const paneAxes = state.config.yAxis.axes.filter(
        (axis) => axis.paneId === paneId,
      );
      expect(paneAxes.map((axis) => axis.id)).toEqual([compareAxisId]);
      expect(paneAxes[0]?.fixed).toBe(true);
      expect(paneAxes[0]?.visible).toBe(true);
    });

    it("keeps metric pane axes independent when series ids share a prefix", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const shares = ChartStateUtils.addSeries(state, {
        id: "fundamental_AAPL_sharesOutstanding_Q_1",
        type: "Line",
        pane: 1,
        source: "metric",
      });
      const revenue = ChartStateUtils.addSeries(state, {
        id: "fundamental_AAPL_revenue_Q_2",
        type: "Line",
        pane: 2,
        source: "metric",
      });

      ChartStateUtils.useOwnAxis(state, shares);
      ChartStateUtils.useOwnAxis(state, revenue);

      const sharesAxisId = ChartStateUtils.getSeries(state, shares)!.yAxisId;
      const revenueAxisId = ChartStateUtils.getSeries(state, revenue)!.yAxisId;
      const sharesPaneId = (state.objects[shares] as { paneId: string }).paneId;
      const revenuePaneId = (state.objects[revenue] as { paneId: string })
        .paneId;

      expect(sharesAxisId).not.toBe(revenueAxisId);
      expect(
        state.config.yAxis.axes.find((axis) => axis.id === sharesAxisId)
          ?.paneId,
      ).toBe(sharesPaneId);
      expect(
        state.config.yAxis.axes.find((axis) => axis.id === revenueAxisId)
          ?.paneId,
      ).toBe(revenuePaneId);
      expect(
        ChartStateUtils.getSeriesIdsByYAxis(state, sharesAxisId, sharesPaneId),
      ).toEqual([shares]);
      expect(
        ChartStateUtils.getSeriesIdsByYAxis(
          state,
          revenueAxisId,
          revenuePaneId,
        ),
      ).toEqual([revenue]);
    });

    it("repairs legacy metric axes shared across panes", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const shares = ChartStateUtils.addSeries(state, {
        id: "fundamental_AAPL_sharesOutstanding_Q_1",
        type: "Line",
        pane: 1,
        source: "metric",
        yAxisId: "line-fundame",
      });
      const revenue = ChartStateUtils.addSeries(state, {
        id: "fundamental_AAPL_revenue_Q_2",
        type: "Line",
        pane: 2,
        source: "metric",
        yAxisId: "line-fundame",
      });
      const revenuePaneId = (state.objects[revenue] as { paneId: string })
        .paneId;
      state.config.yAxis.axes.find(
        (axis) => axis.id === "line-fundame",
      )!.paneId = revenuePaneId;

      expect(ChartStateUtils.enforceStateInvariants(state)).toBe(true);

      const sharesAxisId = ChartStateUtils.getSeries(state, shares)!.yAxisId;
      const revenueAxisId = ChartStateUtils.getSeries(state, revenue)!.yAxisId;
      const sharesPaneId = (state.objects[shares] as { paneId: string }).paneId;

      expect(sharesAxisId).not.toBe(revenueAxisId);
      expect(
        state.config.yAxis.axes.find((axis) => axis.id === sharesAxisId)
          ?.paneId,
      ).toBe(sharesPaneId);
      expect(
        state.config.yAxis.axes.find((axis) => axis.id === revenueAxisId)
          ?.paneId,
      ).toBe(revenuePaneId);
    });
  });

  describe("setSeriesData", () => {
    it("replaces data array", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [{ time: 1, value: 100 }],
      });
      const seriesId = ChartStateUtils.seriesIds(state)[0]!;

      const newData = [
        { time: 1, value: 100 },
        { time: 2, value: 200 },
      ];
      ChartStateUtils.setSeriesData(state, seriesId, newData);

      expect(ChartStateUtils.getSeries(state, seriesId)!.data).toHaveLength(2);
    });

    it("mutates state in place", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, { type: "Line" });
      const seriesId = ChartStateUtils.seriesIds(state)[0]!;

      ChartStateUtils.setSeriesData(state, seriesId, [{ time: 1, value: 100 }]);
      expect(ChartStateUtils.getSeries(state, seriesId)!.data).toHaveLength(1);
    });
  });

  describe("updateSeriesBar", () => {
    it("appends new bar", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [{ time: 1, value: 100 }],
      });
      const seriesId = ChartStateUtils.seriesIds(state)[0]!;

      ChartStateUtils.updateSeriesBar(state, seriesId, {
        time: 2,
        value: 200,
      });

      expect(ChartStateUtils.getSeries(state, seriesId)!.data).toHaveLength(2);
    });

    it("updates last bar if same time", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [{ time: 1, value: 100 }],
      });
      const seriesId = ChartStateUtils.seriesIds(state)[0]!;

      ChartStateUtils.updateSeriesBar(state, seriesId, {
        time: 1,
        value: 150,
      });

      expect(ChartStateUtils.getSeries(state, seriesId)!.data).toHaveLength(1);
      expect(
        (
          ChartStateUtils.getSeries(state, seriesId)!.data[0] as {
            value: number;
          }
        ).value,
      ).toBe(150);
    });
  });

  describe("resize", () => {
    it("updates dimensions", () => {
      const state = createState();
      ChartStateUtils.resize(state, 1000, 600);

      expect(state.config.chart.dimensions.width).toBe(1000);
      expect(state.config.chart.dimensions.height).toBe(600);
    });

    it("preserves autoResize setting", () => {
      const state = createState();
      state.config.chart.dimensions.autoResize = true;
      ChartStateUtils.resize(state, 1000, 600);

      expect(state.config.chart.dimensions.autoResize).toBe(true);
    });

    it("updates pane heights", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, { type: "Line", pane: 0 });
      ChartStateUtils.addSeries(state, { type: "Histogram", pane: 1 });

      ChartStateUtils.resize(state, 800, 600);

      expect(state.panes[0]!.height).toBe(450);
      expect(state.panes[1]!.height).toBe(150);
    });

    it("does not rewrite dimensions when the size is unchanged", () => {
      const state = createState();
      const dimensions = state.config.chart.dimensions;

      ChartStateUtils.resize(state, dimensions.width, dimensions.height);

      expect(state.config.chart.dimensions).toBe(dimensions);
    });
  });

  describe("setVisibleRange", () => {
    it("calculates correct barSpacing", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: Array.from({ length: 100 }, (_, i) => ({ time: i, value: i })),
      });

      ChartStateUtils.setVisibleRange(state, 0, 50);

      expect(getAxis(state.config.xAxis).spacing.barSpacing).toBeGreaterThan(
        10,
      );
    });

    it("calculates correct rightOffset", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: Array.from({ length: 100 }, (_, i) => ({ time: i, value: i })),
      });

      ChartStateUtils.setVisibleRange(state, 0, 50);

      expect(getAxis(state.config.xAxis).spacing.rightOffset).toBeLessThan(0);
      for (let i = 0; i < 100; i++) {
        const range = ChartStateUtils.getVisibleRange(state);
        expect(range).toEqual({ from: 0, to: 50 });
        ChartStateUtils.setVisibleRange(state, range.from, range.to);
      }
    });
  });

  describe("fitContent", () => {
    it("fits all data in view", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: Array.from({ length: 50 }, (_, i) => ({ time: i, value: i })),
      });

      ChartStateUtils.fitContent(state);

      expect(getAxis(state.config.xAxis).spacing.rightOffset).toBe(0);
    });

    it("handles empty data", () => {
      const state = createState();
      const originalOffset = getAxis(state.config.xAxis).spacing.rightOffset;
      ChartStateUtils.fitContent(state);

      expect(getAxis(state.config.xAxis).spacing.rightOffset).toBe(
        originalOffset,
      );
    });
  });

  describe("scrollToRealTime", () => {
    it("sets rightOffset to 0", () => {
      const state = createState();
      getAxis(state.config.xAxis).spacing.rightOffset = 50;

      ChartStateUtils.scrollToRealTime(state);

      expect(getAxis(state.config.xAxis).spacing.rightOffset).toBe(0);
    });
  });

  describe("resetXAxisViewport", () => {
    it("resets ordinal spacing and scroll to defaults", () => {
      const state = createState();
      const axis = getAxis(state.config.xAxis);
      axis.spacing.barSpacing = 50;
      axis.spacing.rightOffset = 42;

      ChartStateUtils.resetXAxisViewport(state);

      expect(getAxis(state.config.xAxis).spacing).toEqual({
        barSpacing: 6,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        rightOffset: 0,
      });
    });
  });

  describe("xAxis management", () => {
    it("adds and activates a new x-axis", () => {
      const state = createState();

      ChartStateUtils.addXAxis(state, {
        id: "events",
        mode: "linear",
        field: "eventDay",
      });
      ChartStateUtils.setActiveXAxis(state, "events");

      expect(
        state.config.xAxis.axes.find((axis) => axis.id === "events"),
      ).toBeDefined();
      expect(state.config.xAxis.activeId).toBe("events");
    });

    it("binds series to another x-axis", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, { type: "Line" });
      const seriesId = ChartStateUtils.seriesIds(state)[0]!;

      ChartStateUtils.addXAxis(state, { id: "secondary", mode: "ordinal" });
      ChartStateUtils.bindSeriesToXAxis(state, seriesId, "secondary");

      expect(ChartStateUtils.getSeries(state, seriesId)!.xAxisId).toBe(
        "secondary",
      );
    });

    it("removes x-axis and rebinds affected series", () => {
      const state = createState();
      ChartStateUtils.addXAxis(state, { id: "secondary", mode: "ordinal" });
      ChartStateUtils.addSeries(state, { type: "Line", xAxisId: "secondary" });
      const seriesId = ChartStateUtils.seriesIds(state)[0]!;

      ChartStateUtils.removeXAxis(state, "secondary");

      expect(
        state.config.xAxis.axes.find((axis) => axis.id === "secondary"),
      ).toBeUndefined();
      expect(ChartStateUtils.getSeries(state, seriesId)!.xAxisId).toBe(
        state.config.xAxis.activeId,
      );
    });
  });

  describe("setCrosshair", () => {
    it("sets crosshair position", () => {
      const state = createState();
      ChartStateUtils.setCrosshair(state, 100, 200, 5);

      expect(state.crosshair.x).toBe(100);
      expect(state.crosshair.y).toBe(200);
      expect(state.crosshair.logicalIndex).toBe(5);
    });

    it("sets visibility to true", () => {
      const state = createState();
      ChartStateUtils.setCrosshair(state, 100, 200, 5);

      expect(state.crosshair.visible).toBe(true);
    });

    it("stores time if provided", () => {
      const state = createState();
      const time = Date.now();
      ChartStateUtils.setCrosshair(state, 100, 200, 5, time);

      expect(state.crosshair.time).toBe(time);
    });
  });

  describe("hideCrosshair", () => {
    it("sets visibility to false", () => {
      const state = createState();
      ChartStateUtils.setCrosshair(state, 100, 200, 5);

      ChartStateUtils.hideCrosshair(state);

      expect(state.crosshair.visible).toBe(false);
    });
  });

  describe("setHoveredAxis", () => {
    it("sets hovered axis ID", () => {
      const state = createState();
      ChartStateUtils.setHoveredAxis(state, "right");

      expect(state.hoveredAxisId).toBe("right");
    });

    it("clears hovered axis when undefined", () => {
      const state = createState();
      ChartStateUtils.setHoveredAxis(state, "right");

      ChartStateUtils.setHoveredAxis(state, undefined);

      expect(state.hoveredAxisId).toBeUndefined();
    });
  });

  describe("applySeriesOptions", () => {
    it("merges options", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        options: { color: "red" } as Record<string, unknown>,
      });
      const seriesId = ChartStateUtils.seriesIds(state)[0]!;

      ChartStateUtils.applySeriesOptions(state, seriesId, {
        lineWidth: 3,
      } as Record<string, unknown>);

      expect(
        (
          ChartStateUtils.getSeries(state, seriesId)!.options as {
            color: string;
          }
        ).color,
      ).toBe("red");
      expect(
        (
          ChartStateUtils.getSeries(state, seriesId)!.options as {
            lineWidth: number;
          }
        ).lineWidth,
      ).toBe(3);
    });
  });

  describe("getVisibleRange", () => {
    it("returns current visible range", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: Array.from({ length: 100 }, (_, i) => ({ time: i, value: i })),
      });

      const range = ChartStateUtils.getVisibleRange(state);

      expect(range.from).toBeDefined();
      expect(range.to).toBeDefined();
      expect(range.to).toBeGreaterThan(range.from);
    });
  });

  describe("getDataLength", () => {
    it("returns total data length", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: Array.from({ length: 50 }, (_, i) => ({ time: i, value: i })),
      });

      const length = ChartStateUtils.getDataLength(state);

      expect(length).toBe(50);
    });

    it("returns max across all series", () => {
      const state = createState();
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: Array.from({ length: 50 }, (_, i) => ({ time: i, value: i })),
      });
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: Array.from({ length: 100 }, (_, i) => ({ time: i, value: i })),
      });

      const length = ChartStateUtils.getDataLength(state);

      expect(length).toBe(100);
    });
  });

  describe("setYAxisExtent", () => {
    it("sets visible extent for axis", () => {
      const state = createState();
      ChartStateUtils.setYAxisExtent(state, "right", {
        min: 0,
        max: 100,
      });

      const axis = state.config.yAxis.axes.find((a) => a.id === "right");
      expect(axis?.visibleExtent).toEqual({ min: 0, max: 100 });
    });
  });

  describe("resetYAxisExtent", () => {
    it("clears visible extent", () => {
      const state = createState();
      ChartStateUtils.setYAxisExtent(state, "right", { min: 0, max: 100 });

      ChartStateUtils.resetYAxisExtent(state, "right");

      const axis = state.config.yAxis.axes.find((a) => a.id === "right");
      expect(axis?.visibleExtent).toBeUndefined();
    });

    it("resets margins to defaults", () => {
      const state = createState();
      ChartStateUtils.resetYAxisExtent(state, "right");

      const axis = state.config.yAxis.axes.find((a) => a.id === "right");
      expect(axis?.margins).toEqual({ top: 0.1, bottom: 0.1 });
    });
  });

  describe("combinePaneAxes", () => {
    it("reassigns pane series to target axis and removes unused axes", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.useOwnAxis(state, compareId);
      const targetAxis = ChartStateUtils.mainSeries(state)!.yAxisId;

      ChartStateUtils.combinePaneAxes(
        state,
        "pane-main",
        targetAxis,
        "percentage",
      );

      expect(ChartStateUtils.getSeries(state, compareId)!.yAxisId).toBe(
        targetAxis,
      );
      expect(
        state.config.yAxis.axes.find((a) => a.id === targetAxis)?.mode,
      ).toBe("percentage");
      expect(
        state.config.yAxis.axes.every(
          (a) => a.id === targetAxis || a.id === "right",
        ),
      ).toBe(true);
    });

    it("combines floating target axes into the pane default right axis", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.useOwnAxis(state, compareId);
      const floatingAxisId = ChartStateUtils.getSeries(
        state,
        compareId,
      )!.yAxisId;
      expect(floatingAxisId).not.toBe("right");

      ChartStateUtils.combinePaneAxes(
        state,
        "pane-main",
        floatingAxisId,
        "normal",
      );

      expect(ChartStateUtils.getSeries(state, "main")!.yAxisId).toBe("right");
      expect(ChartStateUtils.getSeries(state, compareId)!.yAxisId).toBe(
        "right",
      );
      expect(state.config.yAxis.axes.some((a) => a.id === floatingAxisId)).toBe(
        false,
      );
      expect(
        state.config.yAxis.axes.filter((a) => a.visible && a.fixed !== false),
      ).toHaveLength(1);
      expect(state.config.yAxis.axes.find((a) => a.id === "right")?.mode).toBe(
        "normal",
      );
    });

    it("removes the blank default axis when combining into another fixed axis", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.useOwnAxis(state, compareId);
      const compareAxisId = ChartStateUtils.getSeries(
        state,
        compareId,
      )!.yAxisId;
      ChartStateUtils.moveAxisToSide(state, compareAxisId, "left");

      ChartStateUtils.combinePaneAxes(
        state,
        "pane-main",
        compareAxisId,
        "normal",
      );

      expect(ChartStateUtils.getSeries(state, "main")!.yAxisId).toBe(
        compareAxisId,
      );
      expect(ChartStateUtils.getSeries(state, compareId)!.yAxisId).toBe(
        compareAxisId,
      );
      expect(state.config.yAxis.axes.some((axis) => axis.id === "right")).toBe(
        false,
      );
      expect(state.config.yAxis.axes).toHaveLength(1);
      expect(state.config.yAxis.axes[0]?.id).toBe(compareAxisId);
    });
  });

  describe("moveSeriesToOwnAxisSide", () => {
    it("splits a shared compare series onto its own visible side axis", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.applyYAxisOptions(state, "right", {
        mode: "percentage",
        labels: {
          visible: true,
          style: "muted",
          tagColor: "#123456",
          textColor: "#abcdef",
        },
      });

      const nextAxisId = ChartStateUtils.moveSeriesToOwnAxisSide(
        state,
        compareId,
        "left",
      );

      expect(nextAxisId).toBeDefined();
      expect(ChartStateUtils.getSeries(state, compareId)!.yAxisId).toBe(
        nextAxisId,
      );
      expect(nextAxisId).not.toBe("right");
      const nextAxis = state.config.yAxis.axes.find((a) => a.id === nextAxisId);
      expect(nextAxis?.side).toBe("left");
      expect(nextAxis?.fixed).toBe(true);
      expect(nextAxis?.visible).toBe(true);
      expect(nextAxis?.mode).toBe("percentage");
      expect(nextAxis?.labels).toEqual({
        visible: true,
        style: "muted",
        tagColor: "#123456",
        textColor: "#abcdef",
      });
      expect(ChartStateUtils.getSeries(state, "main")!.yAxisId).toBe("right");
    });

    it("reuses an exclusive axis instead of creating a second one", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.useOwnAxis(state, compareId);
      const originalAxisId = ChartStateUtils.getSeries(
        state,
        compareId,
      )!.yAxisId;

      const nextAxisId = ChartStateUtils.moveSeriesToOwnAxisSide(
        state,
        compareId,
        "left",
      );

      expect(nextAxisId).toBe(originalAxisId);
      expect(ChartStateUtils.getSeries(state, compareId)!.yAxisId).toBe(
        originalAxisId,
      );
      expect(
        state.config.yAxis.axes.filter((axis) => axis.id === originalAxisId),
      ).toHaveLength(1);
      expect(
        state.config.yAxis.axes.find((axis) => axis.id === originalAxisId)
          ?.side,
      ).toBe("left");
    });

    it("splits a shared pane-primary compare series onto its own axis", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.reorderSeriesInPane(state, "pane-main", compareId, 0);
      ChartStateUtils.applyYAxisOptions(state, "right", {
        mode: "percentage",
      });

      expect(ChartStateUtils.getPrimarySeriesId(state, "pane-main")).toBe(
        compareId,
      );

      const nextAxisId = ChartStateUtils.moveSeriesToOwnAxisSide(
        state,
        compareId,
        "left",
      );

      expect(nextAxisId).toBeDefined();
      expect(nextAxisId).not.toBe("right");
      expect(ChartStateUtils.getSeries(state, compareId)!.yAxisId).toBe(
        nextAxisId,
      );
      expect(ChartStateUtils.getSeries(state, "main")!.yAxisId).toBe("right");
      expect(state.config.yAxis.axes.some((axis) => axis.id === "right")).toBe(
        true,
      );
      expect(
        state.config.yAxis.axes.find((axis) => axis.id === nextAxisId)?.side,
      ).toBe("left");
      expect(
        state.config.yAxis.axes.find((axis) => axis.id === nextAxisId)?.mode,
      ).toBe("percentage");
    });
  });

  describe("moveSeriesToPane", () => {
    it("moves an overlay group into a new pane and rebinds it to that pane axis", () => {
      const state = createState({
        series: {
          main: { type: "Candlestick" },
        },
      });
      const upperId = ChartStateUtils.addSeries(state, { type: "Line" });
      const middleId = ChartStateUtils.addSeries(state, { type: "Line" });
      const lowerId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.shareYAxis(state, upperId, "main");
      ChartStateUtils.shareYAxis(state, middleId, "main");
      ChartStateUtils.shareYAxis(state, lowerId, "main");

      const paneId = ChartStateUtils.moveSeriesToNewPaneBelow(state, [
        upperId,
        middleId,
        lowerId,
      ]);

      expect(paneId).toBeDefined();
      expect(state.panes.map((pane) => pane.id)).toContain(paneId);
      for (const seriesId of [upperId, middleId, lowerId]) {
        expect(ChartStateModel.paneForSeries(state, seriesId)?.id).toBe(paneId);
        expect(ChartStateUtils.getSeries(state, seriesId)?.yAxisId).toBe(
          `${paneId}:right`,
        );
      }
      expect(ChartStateUtils.getSeries(state, "main")?.yAxisId).toBe("right");
      expect(
        state.config.yAxis.axes.find((axis) => axis.id === `${paneId}:right`)
          ?.paneId,
      ).toBe(paneId);
    });

    it("moves a series to an existing pane from another pane", () => {
      const state = createState({
        series: {
          main: { type: "Candlestick" },
        },
      });
      const paneOneSeries = ChartStateUtils.addSeries(state, {
        type: "Line",
        pane: 1,
      });
      const paneTwoSeries = ChartStateUtils.addSeries(state, {
        type: "Line",
        pane: 2,
      });
      const targetPaneId = ChartStateModel.paneForSeries(
        state,
        paneOneSeries,
      )!.id;

      ChartStateUtils.moveSeriesToPane(state, paneTwoSeries, targetPaneId);

      expect(ChartStateModel.paneForSeries(state, paneTwoSeries)?.id).toBe(
        targetPaneId,
      );
      expect(ChartStateUtils.getSeries(state, paneTwoSeries)?.yAxisId).toBe(
        `${targetPaneId}:right`,
      );
      expect(state.panes).toHaveLength(2);
    });

    it("never synthesizes volume when adding, moving, or repairing OHLC series", () => {
      const state = createState({ series: { main: { type: "Candlestick" } } });
      const priceId = ChartStateUtils.addSeries(state, {
        id: "price",
        type: "Candlestick",
        pane: 1,
      });
      expect(ChartStateUtils.seriesIds(state)).toEqual(["main", priceId]);
      ChartStateUtils.moveSeriesToNewPaneBelow(state, priceId);
      ChartStateUtils.enforceStateInvariants(state);
      expect(ChartStateUtils.seriesIds(state)).toEqual(["main", priceId]);
    });

    it("moves and removes explicitly supplied Histogram children with their price series", () => {
      const state = createState({ series: { main: { type: "Candlestick" } } });
      const priceId = ChartStateUtils.addSeries(state, {
        id: "price",
        type: "Candlestick",
      });
      const volumeId = ChartStateUtils.addSeries(state, {
        id: "price-volume",
        type: "Histogram",
        parentId: priceId,
        options: { title: "Volume" },
      });
      const paneId = ChartStateUtils.moveSeriesToNewPaneBelow(state, priceId);
      expect(ChartStateModel.paneForSeries(state, volumeId)?.id).toBe(paneId);
      ChartStateUtils.removeSeries(state, volumeId);
      expect(ChartStateUtils.getSeries(state, priceId)).toBeDefined();
      expect(ChartStateUtils.getSeries(state, volumeId)).toBeUndefined();
      ChartStateUtils.addSeries(state, {
        id: volumeId,
        type: "Histogram",
        parentId: priceId,
        pane: 1,
      });
      ChartStateUtils.removeSeries(state, priceId);
      expect(ChartStateUtils.getSeries(state, priceId)).toBeUndefined();
      expect(ChartStateUtils.getSeries(state, volumeId)).toBeUndefined();
      expect(ChartStateModel.paneById(state, paneId!)).toBeUndefined();
    });
  });

  describe("removeAxisAndSeries", () => {
    it("deletes all series linked to axis and removes the axis", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.useOwnAxis(state, compareId);
      const axisId = ChartStateUtils.getSeries(state, compareId)!.yAxisId;

      ChartStateUtils.removeAxisAndSeries(state, axisId);

      expect(ChartStateUtils.getSeries(state, compareId)).toBeUndefined();
      expect(state.config.yAxis.axes.some((a) => a.id === axisId)).toBe(false);
    });
  });

  describe("reorderSeriesInPane", () => {
    it("reorders pane series deterministically and updates primary series order", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const firstCompareId = ChartStateUtils.addSeries(state, { type: "Line" });
      const secondCompareId = ChartStateUtils.addSeries(state, {
        type: "Line",
      });

      ChartStateUtils.reorderSeriesInPane(
        state,
        "pane-main",
        secondCompareId,
        0,
      );

      expect(state.panes[0]!.objectIds[0]).toBe(secondCompareId);
      expect(state.panes[0]!.objectIds[1]).toBe("main");
      expect(state.panes[0]!.objectIds[2]).toBe(firstCompareId);
      expect(ChartStateUtils.getPrimarySeriesId(state, "pane-main")).toBe(
        secondCompareId,
      );
    });

    it("swaps axis presentation role when primary series changes", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.useOwnAxis(state, compareId);

      const primaryAxisId = ChartStateUtils.mainSeries(state)!.yAxisId;
      const compareAxisId = ChartStateUtils.getSeries(
        state,
        compareId,
      )!.yAxisId;
      expect(compareAxisId).not.toBe(primaryAxisId);

      ChartStateUtils.moveAxisToSide(state, primaryAxisId, "left");
      ChartStateUtils.setAxisFixed(state, compareAxisId, false, "right");

      const beforePrimaryAxis = state.config.yAxis.axes.find(
        (axis) => axis.id === primaryAxisId,
      )!;
      const beforeCompareAxis = state.config.yAxis.axes.find(
        (axis) => axis.id === compareAxisId,
      )!;
      expect(beforePrimaryAxis.fixed).toBe(true);
      expect(beforePrimaryAxis.visible).toBe(true);
      expect(beforePrimaryAxis.side).toBe("left");
      expect(beforeCompareAxis.fixed).toBe(false);
      expect(beforeCompareAxis.visible).toBe(false);
      expect(beforeCompareAxis.side).toBe("right");

      ChartStateUtils.reorderSeriesInPane(state, "pane-main", compareId, 0);

      expect(ChartStateUtils.getPrimarySeriesId(state, "pane-main")).toBe(
        compareId,
      );

      const afterPrimaryAxis = state.config.yAxis.axes.find(
        (axis) => axis.id === primaryAxisId,
      )!;
      const afterCompareAxis = state.config.yAxis.axes.find(
        (axis) => axis.id === compareAxisId,
      )!;
      expect(afterCompareAxis.fixed).toBe(true);
      expect(afterCompareAxis.visible).toBe(true);
      expect(afterCompareAxis.side).toBe("left");
      expect(afterPrimaryAxis.fixed).toBe(false);
      expect(afterPrimaryAxis.visible).toBe(false);
      expect(afterPrimaryAxis.side).toBe("right");
    });
  });

  describe("setAxisFixed", () => {
    it("does not allow the primary axis to float", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const primaryAxisId = ChartStateUtils.mainSeries(state)!.yAxisId;

      ChartStateUtils.setAxisFixed(state, primaryAxisId, false);

      const primaryAxis = state.config.yAxis.axes.find(
        (axis) => axis.id === primaryAxisId,
      );
      expect(primaryAxis?.fixed).toBe(true);
      expect(primaryAxis?.visible).toBe(true);
    });

    it("normalizes floating axes to the right side", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, { type: "Line" });
      ChartStateUtils.useOwnAxis(state, compareId);

      const compareAxisId = ChartStateUtils.getSeries(
        state,
        compareId,
      )!.yAxisId;
      ChartStateUtils.moveAxisToSide(state, compareAxisId, "left");
      ChartStateUtils.setAxisFixed(state, compareAxisId, false);

      const compareAxis = state.config.yAxis.axes.find(
        (axis) => axis.id === compareAxisId,
      );
      expect(compareAxis?.fixed).toBe(false);
      expect(compareAxis?.visible).toBe(false);
      expect(compareAxis?.side).toBe("right");
    });
  });

  describe("comparison mode", () => {
    it("enables chart-native comparison on the shared percentage axis", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
            ],
          },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [
          { time: 10, close: 200 },
          { time: 20, close: 210 },
        ],
      });

      ChartStateUtils.enableComparisonMode(state, { anchorTime: 20 });

      expect(state.comparison).toMatchObject({
        enabled: true,
        mode: "relative_performance",
        axisId: "right",
        mainSeriesId: "main",
        mainBaselineTime: 20,
        auxiliarySeriesIds: [compareId],
        adjustment: { kind: "none" },
        display: "percentage_from_anchor",
        yScale: undefined,
        previousAxis: {
          mode: "normal",
          autoScale: true,
          visibleExtent: undefined,
          labels: { visible: true, style: "default" },
          margins: { top: 0.1, bottom: 0.1 },
        },
        source: undefined,
      });
      expect(state.comparison?.previousYAxisLayout).toMatchObject({
        seriesAxisIds: { main: "right", [compareId]: "right" },
      });
      expect(ChartStateUtils.getSeries(state, compareId)?.yAxisId).toBe(
        "right",
      );
      expect(ChartStateUtils.getYAxis(state, "right")?.mode).toBe("percentage");
      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 20,
      });
    });

    it("forces comparison last-value labels while restoring prior series visibility on exit", () => {
      const state = createState({
        series: {
          main: {
            type: "Candlestick",
            options: { title: "MAIN", lastValueVisible: false },
            data: [
              { time: 10, open: 90, high: 110, low: 80, close: 100 },
              { time: 20, open: 100, high: 120, low: 95, close: 110 },
            ],
          },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Candlestick",
        options: { title: "COMPARE", lastValueVisible: false },
        data: [
          { time: 10, open: 190, high: 210, low: 180, close: 200 },
          { time: 20, open: 200, high: 220, low: 195, close: 210 },
        ],
      });

      ChartStateUtils.enableComparisonMode(state, {
        anchorTime: 20,
        auxiliarySeriesIds: [compareId],
      });

      expect(
        (
          ChartStateUtils.getSeries(state, "main")?.options as Record<
            string,
            unknown
          >
        ).lastValueVisible,
      ).toBe(true);
      expect(
        (
          ChartStateUtils.getSeries(state, compareId)?.options as Record<
            string,
            unknown
          >
        ).lastValueVisible,
      ).toBe(true);

      ChartStateUtils.disableComparisonMode(state);

      expect(
        (
          ChartStateUtils.getSeries(state, "main")?.options as Record<
            string,
            unknown
          >
        ).lastValueVisible,
      ).toBe(false);
      expect(
        (
          ChartStateUtils.getSeries(state, compareId)?.options as Record<
            string,
            unknown
          >
        ).lastValueVisible,
      ).toBe(false);
    });

    it("compares main-pane provider price series and hides only main-pane non-participants", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
            ],
          },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [
          { time: 10, close: 200 },
          { time: 20, close: 210 },
        ],
      });
      const detachedId = ChartStateUtils.addSeries(state, {
        type: "Line",
        pane: 1,
        yAxisId: "detached-price",
        options: { title: "Detached Price", visible: true },
        data: [
          { time: 10, close: 300 },
          { time: 20, close: 310 },
        ],
      });
      const smaId = ChartStateUtils.addSeries(state, {
        id: "sma",
        type: "Line",
        source: "computed",
        fieldMap: { value: "sma" },
        options: { title: "SMA", visible: true },
        data: [
          { time: 10, sma: 100 },
          { time: 20, sma: 105 },
        ],
      });
      const bbId = ChartStateUtils.addSeries(state, {
        id: "bb",
        type: "Line",
        source: "computed",
        pane: 1,
        fieldMap: { value: "upper" },
        options: { title: "Upper", visible: true },
        data: [
          { time: 10, upper: 120 },
          { time: 20, upper: 125 },
        ],
      });
      state.indicators = {
        sma_indicator: {
          id: "sma_indicator",
          definitionId: "def_sma",
          name: "SMA",
          outputObjectIds: [smaId],
        },
        bb_indicator: {
          id: "bb_indicator",
          definitionId: "def_bb",
          name: "Bollinger Bands",
          outputObjectIds: [bbId],
        },
      };

      ChartStateUtils.enableComparisonMode(state, { anchorTime: 20 });

      expect(state.comparison?.auxiliarySeriesIds).toEqual([compareId]);
      expect(ChartStateUtils.getSeries(state, compareId)?.yAxisId).toBe(
        "right",
      );
      expect(ChartStateUtils.getSeries(state, detachedId)?.yAxisId).toBe(
        "detached-price",
      );
      expect(
        (
          ChartStateUtils.getSeries(state, detachedId)?.options as Record<
            string,
            unknown
          >
        ).visible,
      ).toBe(true);
      expect(
        (
          ChartStateUtils.getSeries(state, smaId)?.options as Record<
            string,
            unknown
          >
        ).visible,
      ).toBe(false);
      expect(
        (
          ChartStateUtils.getSeries(state, bbId)?.options as Record<
            string,
            unknown
          >
        ).visible,
      ).toBe(true);

      ChartStateUtils.disableComparisonMode(state);

      expect(
        (
          ChartStateUtils.getSeries(state, smaId)?.options as Record<
            string,
            unknown
          >
        ).visible,
      ).toBe(true);
      expect(
        (
          ChartStateUtils.getSeries(state, bbId)?.options as Record<
            string,
            unknown
          >
        ).visible,
      ).toBe(true);
    });

    it("repairs detached indicators hidden by a previously-active comparison state", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
            ],
          },
        },
      });
      const bbId = ChartStateUtils.addSeries(state, {
        id: "bb",
        type: "Line",
        source: "computed",
        pane: 1,
        fieldMap: { value: "upper" },
        options: { title: "Upper", visible: true },
        data: [
          { time: 10, upper: 120 },
          { time: 20, upper: 125 },
        ],
      });
      state.indicators = {
        bb_indicator: {
          id: "bb_indicator",
          definitionId: "def_bb",
          name: "Bollinger Bands",
          outputObjectIds: [bbId],
        },
      };

      ChartStateUtils.enableComparisonMode(state, { anchorTime: 20 });
      ChartStateUtils.applySeriesOptions(state, bbId, { visible: false });

      expect(
        (
          ChartStateUtils.getSeries(state, bbId)?.options as Record<
            string,
            unknown
          >
        ).visible,
      ).toBe(false);

      ChartStateUtils.enforceStateInvariants(state);

      expect(
        (
          ChartStateUtils.getSeries(state, bbId)?.options as Record<
            string,
            unknown
          >
        ).visible,
      ).toBe(true);
    });

    it("uses the requested y-scale for indexed-to-main comparison displays", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
            ],
          },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [
          { time: 10, close: 200 },
          { time: 20, close: 210 },
        ],
      });

      ChartStateUtils.enableComparisonMode(state, {
        anchorTime: 20,
        auxiliarySeriesIds: [compareId],
        display: "indexed_to_main_at_anchor",
        yScale: "logarithmic",
        source: { kind: "index_analysis", versionId: "v1" },
      });

      expect(ChartStateUtils.getYAxis(state, "right")?.mode).toBe(
        "logarithmic",
      );
      expect(state.comparison).toMatchObject({
        auxiliarySeriesIds: [compareId],
        display: "indexed_to_main_at_anchor",
        yScale: "logarithmic",
        source: { kind: "index_analysis", versionId: "v1" },
      });
    });

    it("places the initial comparison anchor at the viewport midpoint", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
              { time: 30, close: 120 },
            ],
          },
        },
      });
      state.visibleRanges[state.config.xAxis.activeId] = { from: 0, to: 3 };

      ChartStateUtils.enableComparisonMode(state);

      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 20,
      });
      expect(state.comparison?.mainBaselineTime).toBe(20);
    });

    it("keeps the main comparison baseline stable when the anchor moves", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
              { time: 30, close: 120 },
            ],
          },
        },
      });
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [
          { time: 10, close: 200 },
          { time: 20, close: 210 },
          { time: 30, close: 220 },
        ],
      });

      ChartStateUtils.enableComparisonMode(state, { anchorTime: 20 });
      ChartStateUtils.enableComparisonMode(state, { anchorTime: 30 });

      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 30,
      });
      expect(state.comparison?.mainBaselineTime).toBe(20);
    });

    it("preserves the active comparison anchor when reapplying comparison without an explicit anchor", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
              { time: 30, close: 120 },
            ],
          },
        },
      });

      ChartStateUtils.enableComparisonMode(state, { anchorTime: 20 });
      ChartStateUtils.enableComparisonMode(state);

      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 20,
      });
    });

    it("resets the main comparison baseline for a new comparison source", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
              { time: 30, close: 120 },
            ],
          },
        },
      });

      ChartStateUtils.enableComparisonMode(state, {
        anchorTime: 10,
        source: { kind: "index_analysis", versionId: "v1" },
      });
      ChartStateUtils.enableComparisonMode(state, {
        anchorTime: 30,
        source: { kind: "index_analysis", versionId: "v2" },
      });

      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 30,
      });
      expect(state.comparison?.mainBaselineTime).toBe(30);
    });

    it("can explicitly reset the main comparison baseline for the same source", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
              { time: 30, close: 120 },
            ],
          },
        },
      });

      ChartStateUtils.enableComparisonMode(state, {
        anchorTime: 10,
        source: { kind: "index_analysis", versionId: "v1" },
      });
      ChartStateUtils.enableComparisonMode(state, {
        anchorTime: 30,
        resetMainBaseline: true,
        source: { kind: "index_analysis", versionId: "v1" },
      });

      expect(state.comparison?.mainBaselineTime).toBe(30);
    });

    it("uses the viewport midpoint from comparison participant data when the main series is empty", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [],
          },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [
          { time: 10, close: 200 },
          { time: 20, close: 210 },
          { time: 30, close: 220 },
        ],
      });
      state.visibleRanges[state.config.xAxis.activeId] = { from: 0, to: 3 };

      ChartStateUtils.enableComparisonMode(state);

      expect(state.comparison?.auxiliarySeriesIds).toEqual([compareId]);
      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 20,
      });
      expect(state.comparison?.mainBaselineTime).toBe(20);
    });

    it("updates comparison adjustment without changing the anchor", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
            ],
          },
        },
      });
      ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [
          { time: 10, close: 200 },
          { time: 20, close: 210 },
        ],
      });

      ChartStateUtils.enableComparisonMode(state, { anchorTime: 10 });
      ChartStateUtils.setComparisonAdjustment(state, {
        kind: "beta_to_custom_benchmark",
        benchmarkSymbol: "SPY",
      });

      expect(state.comparison?.adjustment).toEqual({
        kind: "beta_to_custom_benchmark",
        benchmarkSymbol: "SPY",
      });
      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 10,
      });
    });

    it("toggles fixed comparison zero-axis without changing the anchor", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
            ],
          },
        },
      });

      ChartStateUtils.enableComparisonMode(state, { anchorTime: 10 });
      ChartStateUtils.setComparisonFixedZeroAxis(state, true);

      expect(state.comparison?.fixedZeroAxis).toBe(true);
      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 10,
      });

      ChartStateUtils.setComparisonFixedZeroAxis(state, false);

      expect(state.comparison?.fixedZeroAxis).toBeUndefined();
      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 10,
      });
    });

    it("reads the viewport midpoint time from the requested series", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 105 },
              { time: 30, close: 110 },
            ],
          },
        },
      });
      state.visibleRanges.main = { from: 0, to: 3 };

      expect(ChartStateUtils.getViewportMiddleSeriesTime(state)).toBe(20);
    });

    it("disables comparison without removing participating series", () => {
      const state = createState({
        series: {
          main: { type: "Line", data: [{ time: 10, close: 100 }] },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [{ time: 10, close: 200 }],
      });

      ChartStateUtils.enableComparisonMode(state);
      ChartStateUtils.disableComparisonMode(state);

      expect(state.comparison).toBeUndefined();
      expect(ChartStateUtils.getSeries(state, compareId)).toBeDefined();
      expect(ChartStateUtils.getYAxis(state, "right")?.mode).toBe("normal");
      expect(
        ChartStateUtils.getYAxis(state, "right")?.modeAnchor,
      ).toBeUndefined();
    });

    it("restores pre-comparison y-axis topology and series assignments", () => {
      const state = createState({
        series: {
          main: { type: "Line", data: [{ time: 10, close: 100 }] },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Line",
        yAxisId: "compare-axis",
        data: [{ time: 10, close: 200 }],
      });
      const volumeId = ChartStateUtils.addSeries(state, {
        type: "Histogram",
        yAxisId: "volume",
        data: [{ time: 10, value: 500 }],
      });
      ChartStateUtils.applyYAxisOptions(state, "volume", {
        visible: false,
        fixed: false,
        lockZero: true,
      });
      ChartStateUtils.applyYAxisOptions(state, "compare-axis", {
        mode: "logarithmic",
        labels: { visible: true, style: "muted" },
      });
      const beforeAxes = state.config.yAxis.axes.map((axis) => ({ ...axis }));

      ChartStateUtils.enableComparisonMode(state, {
        auxiliarySeriesIds: [compareId],
        anchorTime: 10,
      });

      expect(ChartStateUtils.getSeries(state, compareId)?.yAxisId).toBe(
        "right",
      );
      expect(ChartStateUtils.getSeries(state, volumeId)?.yAxisId).toBe(
        "volume",
      );

      ChartStateUtils.disableComparisonMode(state);

      expect(ChartStateUtils.getSeries(state, compareId)?.yAxisId).toBe(
        "compare-axis",
      );
      expect(ChartStateUtils.getSeries(state, volumeId)?.yAxisId).toBe(
        "volume",
      );
      expect(state.config.yAxis.axes).toEqual(beforeAxes);
      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toBe(
        undefined,
      );
    });

    it("hides runtime volume and restores pre-comparison series presentation", () => {
      const state = createState({
        series: {
          main: {
            type: "Candlestick",
            data: [{ time: 10, open: 90, high: 110, low: 80, close: 100 }],
            options: { title: "NVDA", upColor: "#26a69a" },
          },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Bar",
        data: [{ time: 10, open: 190, high: 210, low: 180, close: 200 }],
        options: { title: "AMD", upColor: "#5b9bd5" },
      });
      ChartStateUtils.moveSeriesToNewPaneBelow(state, compareId);
      const compareVolumeId = ChartStateUtils.addSeries(state, {
        id: `${compareId}:volume`,
        type: "Histogram",
        parentId: compareId,
        pane: 1,
      });
      const volumeId = ChartStateUtils.addSeries(state, {
        id: "volume",
        type: "Histogram",
        yAxisId: "volume",
        parentId: "main",
        fieldMap: { value: "value" },
        options: { title: "Volume", visible: true },
        data: [{ time: 10, value: 500 }],
      });

      ChartStateUtils.enableComparisonMode(state, {
        auxiliarySeriesIds: [compareId],
        anchorTime: 10,
      });

      const main = ChartStateUtils.getSeries(state, "main");
      const compare = ChartStateUtils.getSeries(state, compareId);
      const volume = ChartStateUtils.getSeries(state, volumeId);
      const compareVolume = ChartStateUtils.getSeries(state, compareVolumeId);
      expect(state.comparison?.auxiliarySeriesIds).toEqual([]);
      expect(main?.type).toBe("Line");
      expect(main?.fieldMap).toEqual({ value: "close" });
      expect(compare?.type).toBe("Bar");
      expect(compare?.fieldMap).toBe(undefined);
      expect((volume?.options as Record<string, unknown>).visible).toBe(false);
      expect((compareVolume?.options as Record<string, unknown>).visible).toBe(
        true,
      );

      ChartStateUtils.disableComparisonMode(state);

      expect(ChartStateUtils.getSeries(state, "main")?.type).toBe(
        "Candlestick",
      );
      expect(ChartStateUtils.getSeries(state, "main")?.fieldMap).toBe(
        undefined,
      );
      expect(ChartStateUtils.getSeries(state, compareId)?.type).toBe("Bar");
      expect(ChartStateUtils.getSeries(state, compareId)?.fieldMap).toBe(
        undefined,
      );
      expect(
        (
          ChartStateUtils.getSeries(state, volumeId)?.options as Record<
            string,
            unknown
          >
        ).visible,
      ).toBe(true);
      expect(
        (
          ChartStateUtils.getSeries(state, compareVolumeId)?.options as Record<
            string,
            unknown
          >
        ).visible,
      ).not.toBe(false);
    });

    it("repairs comparison mode invariants from an already-invalid state", () => {
      const state = createState({
        series: {
          main: {
            type: "Candlestick",
            data: [{ time: 10, open: 90, high: 110, low: 80, close: 100 }],
            options: { title: "NVDA", upColor: "#26a69a" },
          },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Bar",
        data: [{ time: 10, open: 190, high: 210, low: 180, close: 200 }],
        options: { title: "AMD", upColor: "#5b9bd5" },
      });
      ChartStateUtils.addSeries(state, {
        id: "volume",
        type: "Histogram",
        yAxisId: "volume",
        parentId: "main",
        fieldMap: { value: "value" },
        options: { title: "Volume", visible: true },
        data: [{ time: 10, value: 500 }],
      });
      state.config.yAxis.axes[0]!.modeAnchor = { time: 10 };
      state.comparison = {
        enabled: true,
        mode: "relative_performance",
        axisId: "right",
        mainSeriesId: "main",
        mainBaselineTime: 10,
        auxiliarySeriesIds: [compareId],
        adjustment: { kind: "none" },
        display: "percentage_from_anchor",
      };

      expect(ChartStateUtils.enforceStateInvariants(state)).toBe(true);

      expect(ChartStateUtils.getSeries(state, "main")?.type).toBe("Line");
      expect(ChartStateUtils.getSeries(state, compareId)?.type).toBe("Line");
      expect(
        (
          ChartStateUtils.getSeries(state, "volume")?.options as Record<
            string,
            unknown
          >
        ).visible,
      ).toBe(false);
      expect(ChartStateUtils.getSeries(state, "volume")?.yAxisId).toBe(
        "volume",
      );
      expect(ChartStateUtils.getYAxis(state, "volume")).toMatchObject({
        visible: false,
        fixed: false,
        lockZero: true,
        mode: "normal",
      });
      expect(
        state.comparison?.previousSeriesPresentation?.series.main?.type,
      ).toBe("Candlestick");

      ChartStateUtils.disableComparisonMode(state);

      expect(state.comparison).toBeUndefined();
      expect(ChartStateUtils.getSeries(state, "main")?.type).toBe(
        "Candlestick",
      );
      expect(ChartStateUtils.getSeries(state, compareId)?.type).toBe("Bar");
      expect(ChartStateUtils.getSeries(state, "volume")?.yAxisId).toBe(
        "volume",
      );
      expect(
        ChartStateUtils.getYAxis(state, "right")?.modeAnchor,
      ).toBeUndefined();
    });

    it("updates the comparison anchor without moving the main baseline", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
              { time: 30, close: 120 },
            ],
          },
        },
      });

      ChartStateUtils.enableComparisonMode(state, { anchorTime: 20 });
      ChartStateUtils.setComparisonAnchor(state, 30);

      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 30,
      });
      expect(state.comparison?.mainBaselineTime).toBe(20);
    });

    it("toggles comparison mode from the generic chart toolbar entry point", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
              { time: 30, close: 120 },
            ],
          },
        },
      });
      const compareId = ChartStateUtils.addSeries(state, {
        type: "Line",
        data: [
          { time: 10, close: 200 },
          { time: 20, close: 210 },
          { time: 30, close: 220 },
        ],
      });
      state.visibleRanges[state.config.xAxis.activeId] = { from: 0, to: 3 };

      ChartStateUtils.toggleComparisonMode(state);

      expect(state.comparison?.enabled).toBe(true);
      expect(state.comparison?.source).toBeUndefined();
      expect(state.comparison?.mainSeriesId).toBe("main");
      expect(state.comparison?.auxiliarySeriesIds).toEqual([compareId]);
      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 20,
      });

      ChartStateUtils.toggleComparisonMode(state);

      expect(state.comparison).toBeUndefined();
      expect(ChartStateUtils.getSeries(state, compareId)).toBeDefined();
      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toBe(
        undefined,
      );
    });

    it("restores the pre-comparison axis mode without leaking the comparison anchor", () => {
      const state = createState({
        series: {
          main: {
            type: "Line",
            data: [
              { time: 10, close: 100 },
              { time: 20, close: 110 },
            ],
          },
        },
      });
      ChartStateUtils.applyYAxisOptions(state, "right", {
        mode: "percentage",
      });

      ChartStateUtils.enableComparisonMode(state, { anchorTime: 20 });
      expect(ChartStateUtils.getYAxis(state, "right")?.modeAnchor).toEqual({
        time: 20,
      });

      ChartStateUtils.disableComparisonMode(state);

      const axis = ChartStateUtils.getYAxis(state, "right");
      expect(axis?.mode).toBe("percentage");
      expect(axis?.modeAnchor).toBeUndefined();
    });

    it("clears stale anchors when ordinary percentage mode is selected", () => {
      const state = createState({
        series: {
          main: { type: "Line", data: [{ time: 10, close: 100 }] },
        },
      });
      ChartStateUtils.applyYAxisOptions(state, "right", {
        mode: "percentage",
        modeAnchor: { time: 10 },
      });

      ChartStateUtils.applyYAxisOptions(state, "right", {
        mode: "percentage",
      });

      expect(
        ChartStateUtils.getYAxis(state, "right")?.modeAnchor,
      ).toBeUndefined();
    });
  });

  describe("invariant enforcement", () => {
    it("throws on non-canonical state at utility entry", () => {
      const state = createState({
        series: {
          main: { type: "Line" },
        },
      });
      delete state.objects[ChartObjectId.parse("main")];

      expect(() => ChartStateUtils.addSeries(state, { type: "Line" })).toThrow(
        /E_PANE_OBJECT_REF_MISSING/,
      );
    });
  });
});
