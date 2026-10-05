// Purpose: Tests for shared dashboard workspace digest invariants
// Module:  @openchart/chart-core / workspace

import { describe, expect, it } from "vitest";
import { digestDashboardWorkspace } from "./index";

type TestWorkspace = {
  dashboard: Record<string, unknown>;
  layout: { cells: unknown[] };
  charts: {
    chart_a: {
      schemaVersion: number;
      id: string;
      config: {
        xAxis: { axes: Array<Record<string, unknown>> };
        yAxis: { axes: unknown[] };
      };
      panes: Array<Record<string, unknown>>;
      objects: Record<string, Record<string, unknown>>;
      indicators?: Record<string, Record<string, unknown>>;
    };
  };
  seriesInputs: Record<string, unknown>;
};

function workspaceWithYAxisAxes(axes: unknown[]): TestWorkspace {
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
        {
          kind: "chart",
          resourceId: "chart_a",
          position: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
    },
    charts: {
      chart_a: {
        schemaVersion: 4,
        id: "chart_a",
        config: {
          xAxis: {
            axes: [
              {
                id: "main",
                mode: "ordinal",
                spacing: { barSpacing: 6, rightOffset: 0 },
              },
            ],
          },
          yAxis: {
            axes,
          },
        },
        panes: [{ id: "pane-main", index: 0, height: 1, objectIds: ["main"] }],
        objects: {
          main: {
            id: "main",
            kind: "series",
            paneId: "pane-main",
            series: { id: "main", type: "Line", data: [] },
          },
        },
      },
    },
    seriesInputs: {},
  };
}

describe("digestDashboardWorkspace", () => {
  it("ignores runtime volume axes", () => {
    const withoutVolumeAxis = workspaceWithYAxisAxes([
      { id: "right", fixed: true },
    ]);
    const withVolumeAxis = workspaceWithYAxisAxes([
      { id: "right", fixed: true },
      {
        id: "volume",
        fixed: true,
        lockZero: true,
        margins: { top: 0.75, bottom: 0 },
      },
      {
        id: "compare:volume",
        fixed: true,
        paneId: "pane-2",
        lockZero: true,
        margins: { top: 0.75, bottom: 0 },
      },
    ]);

    expect(digestDashboardWorkspace(withVolumeAxis)).toBe(
      digestDashboardWorkspace(withoutVolumeAxis),
    );
  });

  it("treats omitted and false pane collapse state as the same default", () => {
    const omitted = workspaceWithYAxisAxes([{ id: "right", fixed: true }]);
    const explicitFalse = structuredClone(omitted);
    explicitFalse.charts.chart_a.panes[0] = {
      ...explicitFalse.charts.chart_a.panes[0]!,
      collapsed: false,
    };
    const explicitTrue = structuredClone(omitted);
    explicitTrue.charts.chart_a.panes[0] = {
      ...explicitTrue.charts.chart_a.panes[0]!,
      collapsed: true,
    };

    expect(digestDashboardWorkspace(explicitFalse)).toBe(
      digestDashboardWorkspace(omitted),
    );
    expect(digestDashboardWorkspace(explicitTrue)).not.toBe(
      digestDashboardWorkspace(omitted),
    );
  });

  it("normalizes main to the front of pane object membership", () => {
    const mainFirst = workspaceWithYAxisAxes([{ id: "right", fixed: true }]);
    mainFirst.charts.chart_a.panes[0]!.objectIds = ["main", "compare"];
    mainFirst.charts.chart_a.objects.compare = {
      id: "compare",
      kind: "series",
      paneId: "pane-main",
      series: { id: "compare", type: "Line", data: [] },
    };

    const mainLast = structuredClone(mainFirst);
    mainLast.charts.chart_a.panes[0]!.objectIds = ["compare", "main"];

    expect(digestDashboardWorkspace(mainLast)).toBe(
      digestDashboardWorkspace(mainFirst),
    );
  });

  it("canonicalizes pane identity by pane position", () => {
    const runtime = workspaceWithYAxisAxes([
      { id: "right", fixed: true },
      { id: "indicator-axis", fixed: true, paneId: "pane_runtime_1" },
    ]);
    runtime.charts.chart_a.panes.push({
      id: "pane_runtime_1",
      index: 1,
      height: 1,
      objectIds: ["macd"],
    });
    runtime.charts.chart_a.objects.macd = {
      id: "macd",
      kind: "series",
      paneId: "pane_runtime_1",
      series: { id: "macd", type: "Line", data: [], yAxisId: "indicator-axis" },
    };

    const persisted = structuredClone(runtime);
    persisted.charts.chart_a.panes[1]!.id = "pane-2";
    persisted.charts.chart_a.objects.macd!.paneId = "pane-2";
    const persistedAxis = persisted.charts.chart_a.config.yAxis
      .axes[1] as Record<string, unknown>;
    persistedAxis.paneId = "pane_runtime_1";

    expect(digestDashboardWorkspace(runtime)).toBe(
      digestDashboardWorkspace(persisted),
    );
  });

  it("ignores transient x-axis viewport changes", () => {
    const baseline = workspaceWithYAxisAxes([{ id: "right", fixed: true }]);
    const movedViewport = structuredClone(baseline);
    movedViewport.charts.chart_a.config.xAxis.axes[0] = {
      ...movedViewport.charts.chart_a.config.xAxis.axes[0]!,
      spacing: { barSpacing: 18, rightOffset: 42, minBarSpacing: 0.5 },
      domain: { min: 10, max: 40, minSpan: 1 },
    };

    expect(digestDashboardWorkspace(movedViewport)).toBe(
      digestDashboardWorkspace(baseline),
    );
  });

  it("does not treat manual y-axis extent state as durable workspace state", () => {
    const manualExtent = workspaceWithYAxisAxes([
      {
        id: "right",
        fixed: true,
        autoScale: false,
        visibleExtent: { min: 0, max: 100 },
      },
    ]);
    const autoscale = workspaceWithYAxisAxes([
      { id: "right", fixed: true, autoScale: true },
    ]);

    expect(digestDashboardWorkspace(manualExtent)).toBe(
      digestDashboardWorkspace(autoscale),
    );
  });

  it("ignores default-false crosshair badge config", () => {
    const explicitFalse = workspaceWithYAxisAxes([
      { id: "right", fixed: true },
    ]);
    (
      explicitFalse.charts.chart_a.config as Record<string, unknown>
    ).interaction = {
      crosshair: { crosshairBadges: false },
    };
    const omitted = workspaceWithYAxisAxes([{ id: "right", fixed: true }]);
    (omitted.charts.chart_a.config as Record<string, unknown>).interaction = {
      crosshair: {},
    };

    expect(digestDashboardWorkspace(explicitFalse)).toBe(
      digestDashboardWorkspace(omitted),
    );
  });

  it("ignores chart-local indicator grouping projections", () => {
    const canonical = workspaceWithYAxisAxes([{ id: "right", fixed: true }]);
    canonical.charts.chart_a.objects.macd = {
      id: "macd",
      kind: "series",
      paneId: "pane-main",
      series: { id: "macd", type: "Line", data: [] },
    };
    canonical.charts.chart_a.panes[0]!.objectIds = ["main", "macd"];
    canonical.charts.chart_a.indicators = {
      ind_macd: {
        id: "ind_macd",
        definitionId: "indlib_macd",
        name: "MACD",
        outputObjectIds: ["macd"],
      },
    };

    const withMetadata = structuredClone(canonical);
    const indicators = withMetadata.charts.chart_a.indicators;
    expect(indicators).toBeDefined();
    if (!indicators) throw new Error("Expected test indicator fixture");
    indicators.ind_macd = {
      ...indicators.ind_macd,
      createdAt: 1779393022168,
      updatedAt: 1779393022168,
      dataSeriesId: "ind_ind_macd_data",
      outputObjectIds: ["histogram", "signal", "macd"],
      inputBindings: { main: "data_series_market_spy" },
      config: { overlay: false, color: "blue" },
    };

    expect(digestDashboardWorkspace(withMetadata)).toBe(
      digestDashboardWorkspace(canonical),
    );
  });
});
