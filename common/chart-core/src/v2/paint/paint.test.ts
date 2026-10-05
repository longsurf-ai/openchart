// Purpose: Tests for chart repaint mode-transform invariants
// Module:  @openchart/chart-core / v2 / paint

import { Schema } from "effect";
import { ProviderListing } from "@openchart/chart-core/market/provider-listing";
import { describe, expect, it, vi } from "vitest";
import { Invalidate } from "@openchart/chart-core/invalidate";
import { ChartAnnotation } from "@openchart/chart-core/annotation";
import { CoordSys } from "@openchart/chart-core/coord";
import type { RenderContext } from "@openchart/chart-core/drawing";
import { createState } from "@openchart/chart-core/v2/state/defaults";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import { ChartStateUtils } from "@openchart/chart-core/v2/state/utilities";
import { __testing, repaint, type RuntimeState } from "./paint";

it("clears painted drawing labels before an empty-series frame", () => {
  const state = createState({ id: "empty" });
  const runtime = {
    ctx: { fillRect: vi.fn() },
    drawingLabelPlacements: new Map([["old", [{ x: 50, y: 50, angle: 0 }]]]),
  } as unknown as RuntimeState;
  repaint(state, runtime, Invalidate.chart(Invalidate.create(), "full"));
  expect(runtime.drawingLabelPlacements?.size).toBe(0);
});

function linearCoord(extent: [number, number]): CoordSys.State {
  return {
    bounds: { x: 0, y: 0, width: 100, height: 400 },
    defaultYScale: "right",
    scales: {
      x: { extent: [0, 1], range: [0, 100], mode: "linear" },
      y: { right: { extent, range: [400, 0], mode: "linear" } },
    },
  } as unknown as CoordSys.State;
}

function annotation(
  patch: Partial<ChartAnnotation.Record> & { id: string; start: number },
): ChartAnnotation.Record {
  return {
    userId: "user_1",
    dashboardId: "dashboard_1",
    market: ProviderListing.parse({
      provider: "test",
      listing: { symbol: "AAPL", currency: "USD" },
    }),
    spanId: null,
    materializedByAgentRunId: null,
    materializationKey: null,
    eventId: `event_${patch.id}`,
    label: "Target collision",
    sentiment: 0,
    priorityScore: 0,
    anchor: { start: patch.start },
    style: Schema.decodeUnknownSync(ChartAnnotation.Style)({}),
    visibility: "visible",
    revision: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    deletedAt: null,
    ...patch,
    feedback: patch.feedback ?? null,
  };
}

function annotationRenderContext(yExtent: [number, number]): RenderContext {
  const data = [
    {
      time: Date.parse("2026-05-01T13:30:00.000Z") / 1000,
      open: 49,
      high: 61,
      low: 43,
      close: 56,
    },
    {
      time: Date.parse("2026-05-02T13:30:00.000Z") / 1000,
      open: 48,
      high: 62,
      low: 42,
      close: 55,
    },
    {
      time: Date.parse("2026-05-03T13:30:00.000Z") / 1000,
      open: 47,
      high: 63,
      low: 41,
      close: 54,
    },
  ];
  return {
    coord: {
      type: "cartesian2d",
      bounds: { x: 0, y: 0, width: 280, height: 200 },
      defaultYScale: "right",
      scales: {
        x: { extent: [0, 2], range: [20, 260], mode: "linear" },
        y: {
          right: { extent: yExtent, range: [200, 0], mode: "linear" },
        },
      },
    },
    xPositions: data.map((_, index) => 20 + index * 40),
    xFn: (index) => 20 + index * 40,
    data,
    visibleRange: { from: 0, to: data.length - 1 },
    area: { x: 0, y: 0, width: 280, height: 200 },
  };
}

describe("foldModeTransformIntoScale", () => {
  it("paints focused value tags after unfocused value tags", () => {
    const tags = [
      { id: "main", focused: false, stableOrder: 0 },
      { id: "qqq", focused: true, stableOrder: 1 },
      { id: "aapl", focused: false, stableOrder: 2 },
      { id: "qqq-ext", focused: true, stableOrder: 3 },
    ];

    expect(
      [...tags].sort(__testing.compareValueTagPaintOrder).map((tag) => tag.id),
    ).toEqual(["main", "aapl", "qqq", "qqq-ext"]);
  });

  it("is pixel-equivalent to applying an affine transform then the scale", () => {
    const coord = linearCoord([-30, 80]);
    // percentage-from-12: value(raw) = (raw/12 - 1) * 100 — affine in raw.
    const transform = { value: (raw: number) => (raw / 12 - 1) * 100 } as never;
    const folded = __testing.foldModeTransformIntoScale(coord, transform);
    expect(folded).not.toBeNull();
    const scale = coord.scales.y.right!;
    const foldedScale = folded!.scales.y.right!;
    for (const raw of [-5, 0, 1, 12, 17.3, 100, 1000]) {
      expect(CoordSys.toPixel(raw, foldedScale)).toBeCloseTo(
        CoordSys.toPixel((raw / 12 - 1) * 100, scale),
        6,
      );
    }
  });

  it("declines to fold a log scale or a non-affine transform", () => {
    const logCoord = {
      bounds: { x: 0, y: 0, width: 100, height: 400 },
      defaultYScale: "right",
      scales: {
        x: { extent: [0, 1], range: [0, 100], mode: "linear" },
        y: { right: { extent: [1, 100], range: [400, 0], mode: "log" } },
      },
    } as unknown as CoordSys.State;
    const affine = { value: (raw: number) => raw * 2 + 1 } as never;
    expect(__testing.foldModeTransformIntoScale(logCoord, affine)).toBeNull();

    const nonAffine = { value: (raw: number) => raw * raw } as never;
    expect(
      __testing.foldModeTransformIntoScale(linearCoord([0, 100]), nonAffine),
    ).toBeNull();
  });
});

describe("series render cache signatures", () => {
  it("invalidates cached geometry when a pane reflow moves the y-scale range", () => {
    const state = createState({
      series: {
        main: {
          type: "Candlestick",
        },
      },
    });
    const series = ChartStateUtils.getSeries(state, "main")!;
    const lowerPaneScale: CoordSys.Scale = {
      extent: [0, 100],
      range: [400, 200],
      mode: "linear",
    };
    const upperPaneScale: CoordSys.Scale = {
      extent: [0, 100],
      range: [200, 0],
      mode: "linear",
    };

    expect(
      __testing.seriesRenderSignature(
        series,
        "right",
        upperPaneScale,
        undefined,
      ),
    ).not.toBe(
      __testing.seriesRenderSignature(
        series,
        "right",
        lowerPaneScale,
        undefined,
      ),
    );
  });
});

describe("annotation layout cache signatures", () => {
  it("keeps y autoscale drift out of the solve key", () => {
    const state = createState();
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-02T13:30:00.000Z") / 1000,
      }),
    ];
    const runtime = {};
    const first = annotationRenderContext([0, 100]);
    const autoscaled = annotationRenderContext([10, 90]);

    const firstSolve = __testing.annotationRenderSolveSignature(
      runtime as never,
      state,
      first,
      annotations,
    );
    const secondSolve = __testing.annotationRenderSolveSignature(
      runtime as never,
      state,
      autoscaled,
      annotations,
    );

    expect(secondSolve).toBe(firstSolve);
    expect(__testing.annotationRenderPositionSignature(autoscaled)).not.toBe(
      __testing.annotationRenderPositionSignature(first),
    );
  });
});

function seriesRanges(state: ReturnType<typeof createState>) {
  const ranges = new Map<string, { from: number; to: number }>();
  for (const [id, series] of Object.entries(state.objects)) {
    if (!series || typeof series !== "object") continue;
    const object = series as { kind?: string; series?: { data?: unknown[] } };
    if (object.kind !== "series") continue;
    ranges.set(id, { from: 2, to: object.series?.data?.length ?? 0 });
  }
  return ranges;
}

describe("paint mode transforms", () => {
  it("uses the visible-left baseline for ordinary percentage mode even when an old anchor exists", () => {
    const state = createState({
      series: {
        main: {
          type: "Line",
          data: [
            { time: 10, close: 10 },
            { time: 20, close: 20 },
            { time: 30, close: 30 },
          ],
        },
      },
    });
    state.config.yAxis.axes[0]!.mode = "percentage";
    state.config.yAxis.axes[0]!.modeAnchor = { time: 20 };

    const all = [ChartStateUtils.getSeries(state, "main")!];
    const transforms = __testing.buildModeTransforms(
      state,
      all,
      seriesRanges(state),
      state.config.yAxis.axes,
    );

    expect(transforms.get("main")?.value(30)).toBe(0);
  });

  it("builds transforms from shared dataRef series data", () => {
    const state = createState({
      series: {
        main: {
          type: "Line",
          data: [],
        },
      },
    });
    ChartStateModel.createDataSeries(state, "main-shared", ["time", "close"]);
    ChartStateModel.setDataSeriesData(state, "main-shared", [
      { time: 10, close: 100 },
      { time: 20, close: 110 },
    ]);
    ChartStateModel.upsertSeriesObject(
      state,
      "main",
      ChartStateModel.MAIN_PANE_ID,
      ChartStateModel.getSeries(state, "main"),
      "provider",
      "main-shared",
    );
    state.config.yAxis.axes[0]!.mode = "percentage";

    const all = ChartStateModel.resolvedSeriesValues(state);
    const transforms = __testing.buildModeTransforms(
      state,
      all,
      new Map([["main", { from: 0, to: 2 }]]),
      state.config.yAxis.axes,
    );

    expect(transforms.get("main")?.value(110)).toBe(10);
  });

  it("still anchors auxiliary comparison series while the main listing is empty", () => {
    const state = createState({
      series: {
        main: {
          type: "Line",
          data: [],
        },
      },
    });
    const auxId = ChartStateUtils.addSeries(state, {
      type: "Line",
      data: [
        { time: 10, close: 200 },
        { time: 20, close: 220 },
      ],
    });
    state.config.yAxis.axes[0]!.mode = "percentage";
    state.config.yAxis.axes[0]!.modeAnchor = { time: 20 };
    state.comparison = {
      enabled: true,
      mode: "relative_performance",
      axisId: "right",
      mainSeriesId: "main",
      mainBaselineTime: 20,
      auxiliarySeriesIds: [auxId],
      adjustment: { kind: "none" },
      display: "percentage_from_anchor",
    };

    const all = [
      ChartStateUtils.getSeries(state, "main")!,
      ChartStateUtils.getSeries(state, auxId)!,
    ];
    const transforms = __testing.buildModeTransforms(
      state,
      all,
      new Map([
        ["main", { from: 0, to: 0 }],
        [auxId, { from: 0, to: 2 }],
      ]),
      state.config.yAxis.axes,
    );

    expect(transforms.get("main")).toBeUndefined();
    expect(transforms.get(auxId)?.value(220)).toBe(0);
  });

  it("centers zero in comparison extents when fixed zero-axis is enabled", () => {
    const state = createState({
      series: {
        main: {
          type: "Line",
          data: [
            { time: 10, close: 100 },
            { time: 20, close: 120 },
          ],
        },
      },
    });
    const auxId = ChartStateUtils.addSeries(state, {
      type: "Line",
      data: [
        { time: 10, close: 200 },
        { time: 20, close: 400 },
      ],
    });
    state.config.yAxis.axes[0]!.mode = "percentage";
    state.config.yAxis.axes[0]!.modeAnchor = { time: 10 };
    state.comparison = {
      enabled: true,
      mode: "relative_performance",
      axisId: "right",
      mainSeriesId: "main",
      mainBaselineTime: 10,
      auxiliarySeriesIds: [auxId],
      adjustment: { kind: "none" },
      display: "percentage_from_anchor",
      fixedZeroAxis: true,
    };
    const all = [
      ChartStateUtils.getSeries(state, "main")!,
      ChartStateUtils.getSeries(state, auxId)!,
    ];
    const ranges = new Map([
      ["main", { from: 0, to: 2 }],
      [auxId, { from: 0, to: 2 }],
    ]);
    const transforms = __testing.buildModeTransforms(
      state,
      all,
      ranges,
      state.config.yAxis.axes,
    );

    const extents = __testing.computeExtents(
      state,
      all,
      ranges,
      state.config.yAxis.axes,
      transforms,
    );

    expect(extents.y.right).toEqual({ min: -100, max: 100 });
  });

  it("snaps crosshair labels to the fixed comparison zero-axis near the anchor", () => {
    const state = createState({
      series: {
        main: {
          type: "Line",
          data: [
            { time: 10, close: 100 },
            { time: 20, close: 120 },
          ],
        },
      },
    });
    state.config.yAxis.axes[0]!.mode = "percentage";
    state.config.yAxis.axes[0]!.modeAnchor = { time: 10 };
    state.comparison = {
      enabled: true,
      mode: "relative_performance",
      axisId: "right",
      mainSeriesId: "main",
      mainBaselineTime: 10,
      auxiliarySeriesIds: [],
      adjustment: { kind: "none" },
      display: "percentage_from_anchor",
      fixedZeroAxis: true,
    };
    const scale = linearCoord([-40, 40]).scales.y.right!;
    const zeroY = CoordSys.toPixel(0, scale);

    expect(
      __testing.fixedComparisonAnchorCrosshairSnap(
        state,
        state.config.yAxis.axes[0],
        scale,
        zeroY + 3,
      ),
    ).toEqual({ y: zeroY, label: "0.00%" });
    expect(
      __testing.fixedComparisonAnchorCrosshairSnap(
        state,
        state.config.yAxis.axes[0],
        scale,
        zeroY + 16,
      ),
    ).toBeUndefined();
  });

  it("transforms raw extended-session prices before placing comparison value tags", () => {
    const scale = linearCoord([-50, 50]).scales.y.right!;
    const transform = {
      value: (raw: number) => (raw / 100 - 1) * 100,
    } as never;

    const rawSessionCloseY = CoordSys.toPixel(120, scale);
    const axisValue = __testing.sessionAxisValue(120, transform);

    expect(rawSessionCloseY).toBeLessThan(0);
    expect(axisValue).toBeCloseTo(20);
    expect(CoordSys.toPixel(axisValue!, scale)).toBeGreaterThan(0);
    expect(CoordSys.toPixel(axisValue!, scale)).toBeLessThan(400);
  });

  it("keeps the emphasized comparison series stable while rebasing auxiliaries to it", () => {
    const state = createState({
      series: {
        main: {
          type: "Line",
          data: [
            { time: 10, close: 100 },
            { time: 20, close: 120 },
            { time: 30, close: 150 },
          ],
        },
      },
    });
    const auxId = ChartStateUtils.addSeries(state, {
      type: "Line",
      data: [
        { time: 10, close: 200 },
        { time: 20, close: 210 },
        { time: 30, close: 240 },
      ],
    });
    state.config.yAxis.axes[0]!.mode = "percentage";
    state.config.yAxis.axes[0]!.modeAnchor = { time: 20 };
    state.comparison = {
      enabled: true,
      mode: "relative_performance",
      axisId: "right",
      mainSeriesId: "main",
      mainBaselineTime: 10,
      auxiliarySeriesIds: [auxId],
      adjustment: { kind: "none" },
      display: "percentage_from_anchor",
    };

    const all = [
      ChartStateUtils.getSeries(state, "main")!,
      ChartStateUtils.getSeries(state, auxId)!,
    ];
    const ranges = new Map([
      ["main", { from: 0, to: 3 }],
      [auxId, { from: 0, to: 3 }],
    ]);
    const firstTransforms = __testing.buildModeTransforms(
      state,
      all,
      ranges,
      state.config.yAxis.axes,
    );
    state.config.yAxis.axes[0]!.modeAnchor = { time: 30 };
    const secondTransforms = __testing.buildModeTransforms(
      state,
      all,
      ranges,
      state.config.yAxis.axes,
    );

    expect(firstTransforms.get("main")?.value(120)).toBe(0);
    expect(secondTransforms.get("main")?.value(150)).toBe(0);
    expect(firstTransforms.get("main")?.value(150)).toBe(30);
    expect(secondTransforms.get("main")?.value(120)).toBe(-30);
    expect(firstTransforms.get(auxId)?.value(210)).toBe(
      firstTransforms.get("main")?.value(120),
    );
    expect(secondTransforms.get(auxId)?.value(240)).toBe(
      secondTransforms.get("main")?.value(150),
    );
  });

  it("scales auxiliary comparison returns by overlapping volatility", () => {
    const state = createState({
      series: {
        main: {
          type: "Line",
          data: [
            { time: 10, close: 100 },
            { time: 20, close: 110 },
            { time: 30, close: 100 },
            { time: 40, close: 110 },
          ],
        },
      },
    });
    const auxId = ChartStateUtils.addSeries(state, {
      type: "Line",
      data: [
        { time: 10, close: 100 },
        { time: 20, close: 200 },
        { time: 30, close: 100 },
        { time: 40, close: 200 },
      ],
    });
    state.config.yAxis.axes[0]!.mode = "percentage";
    state.config.yAxis.axes[0]!.modeAnchor = { time: 10 };
    state.comparison = {
      enabled: true,
      mode: "relative_performance",
      axisId: "right",
      mainSeriesId: "main",
      mainBaselineTime: 10,
      auxiliarySeriesIds: [auxId],
      adjustment: { kind: "none" },
      display: "percentage_from_anchor",
    };

    const all = [
      ChartStateUtils.getSeries(state, "main")!,
      ChartStateUtils.getSeries(state, auxId)!,
    ];
    const ranges = new Map([
      ["main", { from: 0, to: 4 }],
      [auxId, { from: 0, to: 4 }],
    ]);
    const unadjusted = __testing.buildModeTransforms(
      state,
      all,
      ranges,
      state.config.yAxis.axes,
    );

    state.comparison.adjustment = { kind: "volatility" };
    const adjusted = __testing.buildModeTransforms(
      state,
      all,
      ranges,
      state.config.yAxis.axes,
    );

    expect(unadjusted.get(auxId)?.value(100)).toBe(0);
    expect(unadjusted.get(auxId)?.value(200)).toBe(100);
    expect(adjusted.get(auxId)?.value(100)).toBe(0);
    expect(adjusted.get(auxId)?.value(200)).toBeGreaterThan(10);
    expect(adjusted.get(auxId)?.value(200)).toBeLessThan(20);
  });

  it("projects index-analysis auxiliaries onto the main index level at the anchor", () => {
    const state = createState({
      series: {
        main: {
          type: "Line",
          data: [
            { time: 10, close: 100 },
            { time: 20, close: 200 },
            { time: 30, close: 300 },
          ],
        },
      },
    });
    const auxId = ChartStateUtils.addSeries(state, {
      type: "Line",
      data: [
        { time: 10, close: 50 },
        { time: 20, close: 80 },
        { time: 30, close: 120 },
      ],
    });
    state.config.yAxis.axes[0]!.mode = "logarithmic";
    state.config.yAxis.axes[0]!.modeAnchor = { time: 20 };
    state.comparison = {
      enabled: true,
      mode: "relative_performance",
      axisId: "right",
      mainSeriesId: "main",
      mainBaselineTime: 20,
      auxiliarySeriesIds: [auxId],
      adjustment: { kind: "none" },
      display: "indexed_to_main_at_anchor",
      yScale: "logarithmic",
      source: { kind: "index_analysis", versionId: "v1" },
    };

    const all = [
      ChartStateUtils.getSeries(state, "main")!,
      ChartStateUtils.getSeries(state, auxId)!,
    ];
    const transforms = __testing.buildModeTransforms(
      state,
      all,
      new Map([
        ["main", { from: 0, to: 3 }],
        [auxId, { from: 0, to: 3 }],
      ]),
      state.config.yAxis.axes,
    );

    expect(transforms.get("main")?.value(300)).toBe(300);
    expect(transforms.get(auxId)?.value(80)).toBe(200);
    expect(transforms.get(auxId)?.value(120)).toBe(300);
  });
});

it("projects plot offsets into future ordinal space without changing market rows", () => {
  const data = Array.from({ length: 10 }, (_, index) => ({
    time: index + 1,
    value: 100 + index,
  }));
  const state = createState({ series: { main: { type: "Line", data } } });
  const shiftedId = ChartStateUtils.addSeries(state, {
    type: "Line",
    data: [...data],
  });
  ChartStateUtils.applySeriesOptions(state, shiftedId, { xOffset: 3 });
  ChartStateUtils.setVisibleRange(state, 5, 13);
  const all = ChartStateModel.seriesValues(state);
  const runtime = __testing.buildSeriesXRuntimes(state, all, 0, 400);
  const original = runtime.seriesMap.get("main")!;
  const shifted = runtime.seriesMap.get(shiftedId)!;
  expect(shifted.xFn(9)).toBe(original.xFn(12));
  expect(shifted.xFn(9)).toBeGreaterThan(original.xFn(9));
  expect(shifted.range.to).toBe(10);
  expect(ChartStateModel.getSeries(state, shiftedId)!.data).toEqual(data);
  expect(ChartStateModel.getSeries(state, "main")!.data).toHaveLength(10);
  const signature = __testing.computeXRuntimeSignature(state, all, 0, 400);
  ChartStateUtils.applySeriesOptions(state, shiftedId, { xOffset: 0 });
  expect(
    __testing.computeXRuntimeSignature(
      state,
      ChartStateModel.seriesValues(state),
      0,
      400,
    ),
  ).not.toBe(signature);
});
