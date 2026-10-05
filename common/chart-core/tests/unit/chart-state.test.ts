// Purpose: Tests for Chart state creation, axis config, and series ordering
// Module:  @openchart/chart-core / tests / unit

import { describe, it, expect } from "vitest";
import { Chart } from "@openchart/chart-core/chart/state";
import { YAxisConfig } from "@openchart/chart-core/scale/config";
import { InteractionConfig } from "@openchart/chart-core/interaction/config";

describe("Chart State", () => {
  describe("resolveTimeDisplayTimezone", () => {
    it("uses the grid calendar timezone for calendar-period series", () => {
      const state = Chart.create("test-id");
      state.display = "America/Los_Angeles";
      state.timeDisplayContexts = {
        main: {
          kind: "calendar-period",
          timezone: "America/New_York",
        },
      };

      expect(Chart.resolveTimeDisplayTimezone(state, "main")).toBe(
        "America/New_York",
      );
    });

    it("uses the chart display timezone for intraday instants", () => {
      const state = Chart.create("test-id");
      state.display = "Asia/Tokyo";
      state.timeDisplayContexts = { main: { kind: "instant" } };

      expect(Chart.resolveTimeDisplayTimezone(state, "main")).toBe(
        "Asia/Tokyo",
      );
    });

    it("preserves local display as the fallback for unowned series", () => {
      const state = Chart.create("test-id");

      expect(Chart.resolveTimeDisplayTimezone(state, "main")).toBe("local");
    });
  });

  describe("YAxisConfig.Side", () => {
    it("parses left", () => {
      expect(YAxisConfig.Side.parse("left")).toBe("left");
    });

    it("parses right", () => {
      expect(YAxisConfig.Side.parse("right")).toBe("right");
    });

    it("rejects invalid values", () => {
      expect(() => YAxisConfig.Side.parse("top")).toThrow();
      expect(() => YAxisConfig.Side.parse("bottom")).toThrow();
    });
  });

  describe("YAxisConfig.Axis", () => {
    it("parses minimal axis", () => {
      const axis = YAxisConfig.Axis.parse({ id: "test" });
      expect(axis.id).toBe("test");
      expect(axis.side).toBe("right");
      expect(axis.visible).toBe(true);
    });

    it("parses full axis options", () => {
      const axis = YAxisConfig.Axis.parse({
        id: "volume",
        side: "left",
        visible: true,
        autoScale: false,
        invertScale: true,
        mode: "logarithmic",
        margins: { top: 0.2, bottom: 0.3 },
        style: {
          borderVisible: false,
          borderColor: "#ff0000",
          ticksVisible: false,
        },
      });

      expect(axis.id).toBe("volume");
      expect(axis.side).toBe("left");
      expect(axis.autoScale).toBe(false);
      expect(axis.invertScale).toBe(true);
      expect(axis.mode).toBe("logarithmic");
      expect(axis.margins.top).toBe(0.2);
      expect(axis.margins.bottom).toBe(0.3);
      expect(axis.style.borderVisible).toBe(false);
      expect(axis.style.borderColor).toBe("#ff0000");
      expect(axis.style.ticksVisible).toBe(false);
    });

    it("applies default margins", () => {
      const axis = YAxisConfig.Axis.parse({ id: "test" });
      expect(axis.margins.top).toBe(0.1);
      expect(axis.margins.bottom).toBe(0.1);
    });
  });

  describe("InteractionConfig.Toggles", () => {
    it("parses with defaults", () => {
      const toggles = InteractionConfig.Toggles.parse({});
      expect(toggles.wheel).toBe(true);
      expect(toggles.pinch).toBe(true);
      expect(toggles.drag).toBe(true);
    });

    it("parses custom values", () => {
      const toggles = InteractionConfig.Toggles.parse({
        wheel: false,
        drag: false,
      });
      expect(toggles.wheel).toBe(false);
      expect(toggles.drag).toBe(false);
      expect(toggles.pinch).toBe(true);
    });
  });

  describe("YAxisConfig.Schema", () => {
    it("has default axes array with right axis", () => {
      const config = YAxisConfig.Schema.parse({});
      expect(config.axes).toHaveLength(1);
      expect(config.axes[0]?.id).toBe("right");
      expect(config.axes[0]?.side).toBe("right");
      expect(config.axes[0]?.visible).toBe(true);
    });

    it("accepts custom axes array", () => {
      const config = YAxisConfig.Schema.parse({
        axes: [
          { id: "price", side: "right" },
          { id: "volume", side: "right", margins: { top: 0.8, bottom: 0 } },
          { id: "rsi", side: "left" },
        ],
      });

      expect(config.axes).toHaveLength(3);
      expect(config.axes[0]?.id).toBe("price");
      expect(config.axes[1]?.id).toBe("volume");
      expect(config.axes[1]?.margins.top).toBe(0.8);
      expect(config.axes[2]?.id).toBe("rsi");
      expect(config.axes[2]?.side).toBe("left");
    });
  });

  describe("create", () => {
    it("creates state with default config", () => {
      const state = Chart.create("test-id");
      expect(state.id).toBe("test-id");
      expect(state.config.yAxis.axes).toHaveLength(1);
      expect(state.objects).toEqual({});
      expect(state.panes).toHaveLength(1);
    });

    it("creates state with custom axes", () => {
      const state = Chart.create("test-id", {
        yAxis: {
          axes: [
            { id: "main", side: "right" },
            { id: "indicator", side: "left" },
          ],
        },
      });
      expect(state.config.yAxis.axes).toHaveLength(2);
    });

    it("uses default textColor from schema", () => {
      const state = Chart.create("test-id", {
        chart: { layout: { background: "#1c2128" } },
      });
      expect(state.config.chart.layout.textColor).toBe("var(--chart-text)");
    });

    it("preserves explicit textColor", () => {
      const state = Chart.create("test-id", {
        chart: { layout: { background: "#1c2128", textColor: "#ff0000" } },
      });
      expect(state.config.chart.layout.textColor).toBe("#ff0000");
    });
  });

  describe("getAxis", () => {
    it("finds axis by ID", () => {
      const state = Chart.create("test-id", {
        yAxis: {
          axes: [
            { id: "price", side: "right" },
            { id: "volume", side: "right" },
          ],
        },
      });

      const axis = Chart.getAxis(state, "volume");
      expect(axis?.id).toBe("volume");
    });

    it("returns undefined for non-existent axis", () => {
      const state = Chart.create("test-id");
      const axis = Chart.getAxis(state, "nonexistent");
      expect(axis).toBeUndefined();
    });
  });

  describe("getAxesBySide", () => {
    it("filters axes by side", () => {
      const state = Chart.create("test-id", {
        yAxis: {
          axes: [
            { id: "price", side: "right" },
            { id: "volume", side: "right" },
            { id: "rsi", side: "left" },
          ],
        },
      });

      const rightAxes = Chart.getAxesBySide(state, "right");
      expect(rightAxes).toHaveLength(2);
      expect(rightAxes.map((a) => a.id)).toEqual(["price", "volume"]);

      const leftAxes = Chart.getAxesBySide(state, "left");
      expect(leftAxes).toHaveLength(1);
      expect(leftAxes[0]?.id).toBe("rsi");
    });

    it("returns empty array when no axes on side", () => {
      const state = Chart.create("test-id", {
        yAxis: { axes: [{ id: "price", side: "right" }] },
      });

      const leftAxes = Chart.getAxesBySide(state, "left");
      expect(leftAxes).toHaveLength(0);
    });
  });

  describe("YAxisConfig.Margins", () => {
    it("clamps top to valid range", () => {
      expect(() => YAxisConfig.Margins.parse({ top: -0.1 })).toThrow();
      expect(() => YAxisConfig.Margins.parse({ top: 1.1 })).toThrow();
    });

    it("clamps bottom to valid range", () => {
      expect(() => YAxisConfig.Margins.parse({ bottom: -0.1 })).toThrow();
      expect(() => YAxisConfig.Margins.parse({ bottom: 1.1 })).toThrow();
    });

    it("accepts valid margins", () => {
      const margins = YAxisConfig.Margins.parse({ top: 0.5, bottom: 0.3 });
      expect(margins.top).toBe(0.5);
      expect(margins.bottom).toBe(0.3);
    });
  });

  describe("seriesInOrder", () => {
    it("returns series in insertion order based on pane order", () => {
      const state = Chart.create("test-id");

      state.objects.a = {
        id: "a",
        kind: "series",
        paneId: "pane-main",
        seriesId: "a",
        axisId: "right",
        source: "provider",
        comparable: true,
        series: {
          id: "a",
          type: "Candlestick",
          axisId: "right",
          yAxisId: "right",
          data: [],
          options: {},
        },
      };
      state.objects.b = {
        id: "b",
        kind: "series",
        paneId: "pane-main",
        seriesId: "b",
        axisId: "left",
        source: "provider",
        comparable: false,
        series: {
          id: "b",
          type: "Histogram",
          axisId: "left",
          yAxisId: "left",
          data: [],
          options: {},
        },
      };
      state.objects.c = {
        id: "c",
        kind: "series",
        paneId: "pane-main",
        seriesId: "c",
        axisId: "right",
        source: "provider",
        comparable: true,
        series: {
          id: "c",
          type: "Line",
          axisId: "right",
          yAxisId: "right",
          data: [],
          options: {},
        },
      };

      state.panes[0]!.objectIds = ["a", "b", "c"];

      const ordered = Chart.seriesInOrder(state);
      expect(ordered.map((s) => s.id)).toEqual(["a", "b", "c"]);
    });

    it("returns empty array when no series", () => {
      const state = Chart.create("test-id");
      const ordered = Chart.seriesInOrder(state);
      expect(ordered).toEqual([]);
    });

    it("handles multiple panes in order", () => {
      const state = Chart.create("test-id");
      state.panes.push({ id: "pane-2", index: 1, height: 100, objectIds: [] });

      state.objects.s1 = {
        id: "s1",
        kind: "series",
        paneId: "pane-main",
        seriesId: "s1",
        axisId: "right",
        source: "provider",
        comparable: true,
        series: {
          id: "s1",
          type: "Candlestick",
          axisId: "right",
          yAxisId: "right",
          data: [],
          options: {},
        },
      };
      state.objects.s2 = {
        id: "s2",
        kind: "series",
        paneId: "pane-2",
        seriesId: "s2",
        axisId: "left",
        source: "provider",
        comparable: false,
        series: {
          id: "s2",
          type: "Histogram",
          axisId: "left",
          yAxisId: "left",
          data: [],
          options: {},
        },
      };
      state.objects.s3 = {
        id: "s3",
        kind: "series",
        paneId: "pane-main",
        seriesId: "s3",
        axisId: "right",
        source: "provider",
        comparable: true,
        series: {
          id: "s3",
          type: "Line",
          axisId: "right",
          yAxisId: "right",
          data: [],
          options: {},
        },
      };

      state.panes[0]!.objectIds = ["s1", "s3"];
      state.panes[1]!.objectIds = ["s2"];

      const ordered = Chart.seriesInOrder(state);
      expect(ordered.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
    });

    it("skips series IDs not found in state", () => {
      const state = Chart.create("test-id");

      state.objects.a = {
        id: "a",
        kind: "series",
        paneId: "pane-main",
        seriesId: "a",
        axisId: "right",
        source: "provider",
        comparable: true,
        series: {
          id: "a",
          type: "Line",
          axisId: "right",
          yAxisId: "right",
          data: [],
          options: {},
        },
      };
      state.panes[0]!.objectIds = ["a", "deleted", "b"];

      const ordered = Chart.seriesInOrder(state);
      expect(ordered.map((s) => s.id)).toEqual(["a"]);
    });
  });
});
