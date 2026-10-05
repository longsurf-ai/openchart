// Purpose: Keep annotation price anchors stable across display-series replacement and ordering.
import { createCanvas } from "@napi-rs/canvas";
import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { TextCache, LabelCache } from "@openchart/chart-core/cache";
import { CoordSys } from "@openchart/chart-core/coord";
import { Drawing } from "@openchart/chart-core/drawing";
import { Invalidate } from "@openchart/chart-core/invalidate";
import { Primitive, PrimitiveWrapper } from "@openchart/chart-core/primitive";
import { RenderCache } from "@openchart/chart-core/render";
import { createState } from "@openchart/chart-core/v2/state/defaults";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import { ChartStateUtils } from "@openchart/chart-core/v2/state/utilities";
import { repaint, type RuntimeState } from "./paint";

const priceTypes = [
  "Candlestick",
  "Bar",
  "Line",
  "Area",
  "Baseline",
  "Liveline",
] as const;
const rows = Array.from({ length: 50 }, (_, index) => ({
  time: 1_756_684_800 + index * 86400,
  open: 200 + index,
  high: 207 + index,
  low: 196 + index,
  close: 204 + index,
  volume: 20_000_000 + index * 100_000,
}));

function createFixture(type: string) {
  const state = createState();
  state.config.chart.dimensions.width = 1000;
  state.config.chart.dimensions.height = 600;
  const addPrice = (nextType: string) => {
    ChartStateUtils.addSeries(state, {
      id: "price",
      type: nextType,
      pane: 0,
      yAxisId: "right",
      fieldMap: { x: "time", value: "close" },
      data: [...rows],
    });
    ChartStateModel.getSeriesObject(state, "price")!.role = "main";
  };
  addPrice(type);
  ChartStateUtils.addSeries(state, {
    id: "volume",
    type: "Histogram",
    pane: 0,
    yAxisId: "volume:axis",
    fieldMap: { x: "time", value: "volume" },
    data: [...rows],
  });
  ChartStateUtils.applyYAxisOptions(state, "volume:axis", {
    visible: false,
    fixed: false,
    lockZero: true,
    margins: { top: 0.75, bottom: 0 },
  });
  ChartStateUtils.setVisibleRange(state, 0, rows.length - 1);
  for (const manual of [false, true]) {
    ChartStateModel.upsertDrawingObject(
      state,
      Drawing.create("annotation", [], {
        id: manual ? "manual" : "automatic",
        time: rows[20]!.time,
        title: manual ? "Dragged annotation" : "Automatic annotation",
        body: "Price-series anchor regression",
        sources: [],
        sentiment: 0,
        ...(manual
          ? {
              labelAnchor: {
                time: rows[25]!.time,
                price: 240,
                axisId: "right",
              },
            }
          : {}),
      }),
    );
  }
  const canvas = createCanvas(1000, 600);
  const runtime: RuntimeState = {
    canvas,
    ctx: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
    ratio: 1,
    textCache: TextCache.create(),
    labelCache: LabelCache.create(),
    renderCache: RenderCache.create(),
    xCache: { positions: [], version: 0, offset: 0 },
    panePrimitives: PrimitiveWrapper.createPane(),
    seriesPrimitives: new Map(),
    disposed: false,
  };
  const paint = (level: "full" | "light" | "cursor" = "full") =>
    repaint(state, runtime, Invalidate.chart(Invalidate.create(), level));
  const switchType = (nextType: string) => {
    // React's ChartSeries unregisters and appends the same Resource ID when type changes.
    ChartStateModel.removeSeriesObject(state, "price");
    addPrice(nextType);
    paint();
  };
  return { state, runtime, paint, switchType };
}

function expectPriceAnchors(fixture: ReturnType<typeof createFixture>) {
  const { runtime } = fixture;
  const scale = runtime.coord!.scales.y.right!;
  const high = CoordSys.toPixel(rows[20]!.high, scale);
  const low = CoordSys.toPixel(rows[20]!.low, scale);
  expect(runtime.annotationPlacements).toHaveLength(2);
  for (const placement of runtime.annotationPlacements!) {
    // Both permitted wick-side targets must remain near the actual price bar.
    expect(placement.anchor.y).toBeGreaterThan(Math.min(high, low) - 20);
    expect(placement.anchor.y).toBeLessThan(Math.max(high, low) + 20);
    expect(placement.anchor.x).toBeCloseTo(
      runtime.xRuntimeCache!.seriesMap.get("price")!.xPositions[20]!,
    );
  }
}

it("repaints overlapping scanners as independent streams when the bridge completes", () => {
  const { state, runtime, paint } = createFixture("Candlestick");
  for (const [id, from, to] of [
    ["a", 5, 15],
    ["b", 10, 30],
    ["c", 25, 40],
  ] as const) {
    ChartStateModel.upsertDrawingObject(
      state,
      Schema.decodeUnknownSync(Drawing.AgentSessionItem)({
        type: "agent_session",
        anchors: [],
        id,
        range: { from: rows[from]!.time * 1000, to: rows[to]!.time * 1000 },
      }),
    );
  }
  state.drawings.sessionProgress = Object.fromEntries(
    ["a", "b", "c"].map((id) => [
      id,
      {
        startedAtMs: 0,
        progressLog: [{ text: `Progress ${id}`, atMs: 0 }],
      },
    ]),
  );
  const text = vi.spyOn(runtime.ctx!, "fillText");
  try {
    paint();
    expect(text.mock.calls.map(([value]) => value)).toContain(
      "3 agents running",
    );
    expect(text.mock.calls.map(([value]) => value)).not.toContain("Progress a");
    delete state.drawings.sessionProgress.b;
    text.mockClear();
    paint("light");
    expect(text.mock.calls.map(([value]) => value)).toEqual(
      expect.arrayContaining(["Progress a", "Progress c"]),
    );
    expect(text.mock.calls.map(([value]) => value)).not.toContain(
      "3 agents running",
    );
    state.drawings.sessionProgress = {};
    text.mockClear();
    paint("light");
    expect(text.mock.calls.map(([value]) => value)).not.toContain("Progress a");
    expect(text.mock.calls.map(([value]) => value)).not.toContain("Progress c");
  } finally {
    text.mockRestore();
  }
});

describe("annotation anchors across chart types", () => {
  it.each(priceTypes)(
    "%s uses the main price series on a cold paint with volume first",
    (type) => {
      const fixture = createFixture(type);
      fixture.switchType(type);
      expectPriceAnchors(fixture);
    },
  );

  it.each(
    priceTypes.flatMap((from) => priceTypes.map((to) => [from, to] as const)),
  )(
    "%s → %s → original keeps the main price anchors after series reordering",
    (from, to) => {
      const fixture = createFixture(from);
      const savedDrawings = JSON.stringify(
        ChartStateModel.drawingItems(fixture.state),
      );
      fixture.paint();
      expectPriceAnchors(fixture);
      for (const type of [to, from]) {
        fixture.switchType(type);
        expect(ChartStateModel.seriesIds(fixture.state)).toEqual([
          "volume",
          "price",
        ]);
        expectPriceAnchors(fixture);
        fixture.paint("light");
        expectPriceAnchors(fixture);
        fixture.paint("cursor");
        expectPriceAnchors(fixture);
      }
      expect(JSON.stringify(ChartStateModel.drawingItems(fixture.state))).toBe(
        savedDrawings,
      );
    },
  );
});

it("updates transient geometry before its first background paint and after a pane resize", () => {
  const fixture = createFixture("Candlestick");
  const trace: string[] = [];
  const bounds: number[] = [];
  const primitive: Primitive.SeriesPrimitive = {
    id: "cloud",
    zOrder: "background",
    updateAllViews(context) {
      trace.push("update");
      bounds.push(context.coord.bounds.height);
    },
    paneViews: () => [
      Primitive.view("background", {
        draw() {
          trace.push("background");
        },
      }),
    ],
  };
  const state = PrimitiveWrapper.create();
  PrimitiveWrapper.replaceOwned(state, "indicator", [primitive]);
  fixture.runtime.seriesPrimitives.set("price", state);
  fixture.paint();
  expect(trace).toEqual(["update", "background"]);
  fixture.state.config.chart.dimensions.height = 400;
  fixture.paint();
  expect(trace).toEqual(["update", "background", "update", "background"]);
  expect(bounds[1]).toBeLessThan(bounds[0]!);
});

it("primitive labels see every series' current ink and reuse it only on cursor paints", () => {
  const fixture = createFixture("Candlestick");
  ChartStateUtils.applyYAxisOptions(fixture.state, "right", {
    autoScale: false,
    visibleExtent: { min: 150, max: 350 },
  });
  ChartStateUtils.addSeries(fixture.state, {
    id: "other-study",
    type: "Line",
    pane: 0,
    yAxisId: "right",
    data: rows.map((row) => ({ time: row.time, value: row.close + 100 })),
  });
  let context: Primitive.DrawContext | undefined;
  const hits: boolean[] = [];
  const primitive: Primitive.SeriesPrimitive = {
    id: "ink-check",
    zOrder: "top",
    updateAllViews(next) {
      context = next;
    },
    paneViews: () => [
      Primitive.view("top", {
        draw() {
          const x = context!.xPositionAt!(20),
            y = CoordSys.toPixel(
              rows[20]!.close + 100,
              context!.coord.scales.y.right!,
            );
          hits.push(
            context!.labelIntersectsSeries!({ x, y, width: 1, height: 1 }),
          );
        },
      }),
    ],
  };
  const state = PrimitiveWrapper.create();
  PrimitiveWrapper.replaceOwned(state, "indicator", [primitive]);
  fixture.runtime.seriesPrimitives.set("price", state);
  fixture.paint();
  const firstQuery = context!.labelIntersectsSeries;
  expect(hits.at(-1)).toBe(true);
  fixture.paint("cursor");
  expect(context!.labelIntersectsSeries).toBe(firstQuery);
  expect(hits.at(-1)).toBe(true);
  ChartStateUtils.applySeriesOptions(fixture.state, "other-study", {
    visible: false,
  });
  fixture.paint();
  expect(context!.labelIntersectsSeries).not.toBe(firstQuery);
  expect(hits.at(-1)).toBe(false);
});
