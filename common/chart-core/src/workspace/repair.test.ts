// Purpose: Tests for persisted dashboard workspace repair invariants
// Module:  @openchart/chart-core / workspace

import { describe, expect, it } from "vitest";
import { repairDashboardWorkspace } from "./repair";

function malformedWorkspace() {
  return {
    dashboard: {
      name: "Demo",
      favorite: false,
      autosave: true,
      sharingEnabled: false,
      revision: 1,
    },
    layout: {
      cells: [
        { kind: "chart", resourceId: "chart_a" },
        { kind: "chart", resourceId: "missing_chart" },
      ],
      links: [{ from: "chart_a", to: "missing_chart" }],
    },
    charts: {
      chart_a: {
        schemaVersion: 4,
        id: "wrong_id",
        config: {
          xAxis: { axes: [{ id: "main", mode: "ordinal" }] },
          yAxis: {
            axes: [
              { id: "right", fixed: true, paneId: "runtime-pane" },
              { id: "volume", fixed: true },
              { id: "macd-axis", fixed: true, paneId: "runtime-pane" },
            ],
          },
        },
        panes: [
          {
            id: "runtime-main",
            index: 0,
            height: 1,
            objectIds: ["dangling", "main"],
          },
          { id: "runtime-pane", index: 1, height: 1, objectIds: ["macd"] },
          { id: "empty-pane", index: 2, height: 1, objectIds: [] },
        ],
        objects: {
          main: {
            id: "not-main",
            kind: "series",
            paneId: "runtime-main",
            seriesId: "not-main",
            axisId: "right",
            source: "provider",
            comparable: true,
            series: { id: "not-main", type: "Candlestick", data: [1] },
          },
          macd: {
            id: "macd",
            kind: "series",
            paneId: "runtime-pane",
            seriesId: "macd",
            axisId: "macd-axis",
            source: "computed",
            comparable: true,
            series: {
              id: "macd",
              type: "Line",
              data: [2],
              axisId: "macd-axis",
            },
          },
        },
        indicators: {
          macd_ind: {
            id: "macd_ind",
            outputObjectIds: ["macd", "missing_output"],
          },
          stale_ind: {
            id: "stale_ind",
            outputObjectIds: ["missing_output"],
          },
        },
        comparison: {
          enabled: true,
          mainSeriesId: "main",
          axisId: "missing-axis",
          auxiliarySeriesIds: ["macd"],
        },
      },
      orphan_chart: {},
    },
    seriesInputs: {
      chart_a: {
        main: { title: "Main" },
        macd: { title: "MACD" },
        dangling: { title: "dangling" },
      },
      orphan_chart: { main: { title: "Orphan" } },
    },
  };
}

describe("repairDashboardWorkspace", () => {
  it("repairs structural workspace references without inventing data", () => {
    const result = repairDashboardWorkspace(malformedWorkspace());
    expect(result.changed).toBe(true);
    expect(result.changes.map((change) => change.code)).toEqual(
      expect.arrayContaining([
        "repair-chart-id",
        "repair-pane-identity",
        "drop-runtime-volume-axis",
        "drop-empty-indicator",
        "drop-stale-comparison",
        "scope-workspace-charts",
      ]),
    );

    const workspace = result.workspace as ReturnType<typeof malformedWorkspace>;
    expect(Object.keys(workspace.charts)).toEqual(["chart_a"]);
    expect(workspace.layout.cells).toEqual([
      { kind: "chart", resourceId: "chart_a" },
    ]);
    expect(workspace.layout.links).toEqual([]);

    const chart = workspace.charts.chart_a;
    expect(chart.id).toBe("chart_a");
    expect(chart.panes.map((pane) => pane.id)).toEqual(["pane-main", "pane-2"]);
    expect(chart.panes[0]?.objectIds).toEqual(["main"]);
    expect(chart.panes[1]?.objectIds).toEqual(["macd"]);
    expect(chart.objects.main.series.data).toEqual([]);
    expect(chart.objects.macd.paneId).toBe("pane-2");
    expect(chart.config.yAxis.axes.map((axis) => axis.id)).toEqual([
      "right",
      "macd-axis",
    ]);
    expect(chart.indicators.macd_ind.outputObjectIds).toEqual(["macd"]);
    expect(chart.indicators.stale_ind).toBeUndefined();
    expect(chart.comparison).toBeUndefined();
    expect(workspace.seriesInputs).toEqual({
      chart_a: {
        main: { title: "Main" },
        macd: { title: "MACD" },
      },
    });
  });

  it("does not report changes for a repaired workspace on a second pass", () => {
    const once = repairDashboardWorkspace(malformedWorkspace());
    const twice = repairDashboardWorkspace(once.workspace);
    expect(twice.changed).toBe(false);
    expect(twice.changes).toEqual([]);
  });
});
