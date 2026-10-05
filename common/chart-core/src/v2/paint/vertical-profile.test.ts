// Purpose: Prove vertical profiles paint where their box says, and only where their axis allows.
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { TextCache, LabelCache } from "@openchart/chart-core/cache";
import { Invalidate } from "@openchart/chart-core/invalidate";
import { PrimitiveWrapper } from "@openchart/chart-core/primitive";
import { RenderCache } from "@openchart/chart-core/render";
import type { VerticalProfile } from "@openchart/chart-core/vertical-profile";
import { createState } from "@openchart/chart-core/v2/state/defaults";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import { ChartStateUtils } from "@openchart/chart-core/v2/state/utilities";
import { __testing, repaint, type RuntimeState } from "./paint";

const magenta = "#ff00ff";
const rows = Array.from({ length: 50 }, (_, index) => ({
  time: 1_756_684_800 + index * 86400,
  open: 200 + index,
  high: 207 + index,
  low: 196 + index,
  close: 204 + index,
}));

// One row covering every price, so any sampled y inside the pane is profile-covered.
function profile(box: VerticalProfile.Box): VerticalProfile.State {
  return {
    box,
    rows: [{ low: 0, high: 10_000, segments: [{ value: 1, color: magenta }] }],
    levels: [],
    visible: true,
  };
}

function fixture(state: VerticalProfile.State) {
  const chart = createState();
  chart.config.chart.dimensions.width = 1000;
  chart.config.chart.dimensions.height = 600;
  ChartStateUtils.addSeries(chart, {
    id: "price",
    type: "Candlestick",
    pane: 0,
    yAxisId: "right",
    fieldMap: { x: "time", value: "close" },
    data: [...rows],
  });
  ChartStateModel.getSeriesObject(chart, "price")!.role = "main";
  ChartStateUtils.setVisibleRange(chart, 0, rows.length - 1);
  ChartStateModel.upsertVerticalProfileObject(chart, {
    id: "vp",
    paneId: ChartStateModel.MAIN_PANE_ID,
    axisId: "right",
    profile: state,
  });
  const canvas = createCanvas(1000, 600);
  const ctx = canvas.getContext("2d");
  const runtime: RuntimeState = {
    canvas,
    ctx: ctx as unknown as CanvasRenderingContext2D,
    ratio: 1,
    textCache: TextCache.create(),
    labelCache: LabelCache.create(),
    renderCache: RenderCache.create(),
    xCache: { positions: [], version: 0, offset: 0 },
    panePrimitives: PrimitiveWrapper.createPane(),
    seriesPrimitives: new Map(),
    disposed: false,
  } as unknown as RuntimeState;
  const paint = () =>
    repaint(chart, runtime, Invalidate.chart(Invalidate.create(), "full"));
  // Above every candle (the axis keeps a top margin), so only the profile can be magenta here.
  const isMagenta = (x: number) => {
    const [r, g, b] = ctx.getImageData(x, 20, 1, 1).data;
    return r === 255 && g === 0 && b === 255;
  };
  return { chart, paint, isMagenta };
}

describe("vertical profile paint", () => {
  it("fills the right edge box and nothing left of it", () => {
    const { paint, isMagenta } = fixture(
      profile({ kind: "edge", side: "right", width: 0.25 }),
    );
    paint();
    expect(isMagenta(800)).toBe(true);
    expect(isMagenta(300)).toBe(false);
  });

  it("spans a time box between its two times", () => {
    const { paint, isMagenta } = fixture(
      profile({ kind: "time", from: rows[15]!.time, to: rows[30]!.time }),
    );
    paint();
    expect(isMagenta(100)).toBe(false);
    expect(isMagenta(430)).toBe(true);
    expect(isMagenta(800)).toBe(false);
  });

  it("paints nothing when hidden", () => {
    const { paint, isMagenta } = fixture({
      ...profile({ kind: "edge", side: "right", width: 0.25 }),
      visible: false,
    });
    paint();
    expect(isMagenta(800)).toBe(false);
  });

  it("paints nothing on a percentage axis, which has no baseline for raw rows", () => {
    const { chart, paint, isMagenta } = fixture(
      profile({ kind: "edge", side: "right", width: 0.25 }),
    );
    ChartStateUtils.applyYAxisOptions(chart, "right", { mode: "percentage" });
    paint();
    expect(isMagenta(800)).toBe(false);
  });
});

describe("projectedXForTime", () => {
  // Bars at 100, 200, 400 seconds sit at x = 10, 20, 30.
  const series = {
    data: [100, 200, 400].map((time) => ({ time })),
  } as unknown as Parameters<typeof __testing.projectedXForTime>[0];
  const runtime = {
    xFn: (index: number) => 10 + index * 10,
  } as unknown as Parameters<typeof __testing.projectedXForTime>[1];
  const x = (time: number) =>
    __testing.projectedXForTime(series, runtime, time, "time");

  it("interpolates between the bars around a time", () => {
    expect([x(100), x(150), x(200), x(300), x(400)]).toEqual([
      10, 15, 20, 25, 30,
    ]);
  });

  it("extrapolates beyond either end from the two nearest bars", () => {
    expect(x(50)).toBe(5);
    expect(x(600)).toBe(40);
  });
});
