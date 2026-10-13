// Purpose: Keep pane autoscale tied to visible series and the current time viewport.
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { TextCache, LabelCache } from "@openchart/chart-core/cache";
import { Invalidate } from "@openchart/chart-core/invalidate";
import { PrimitiveWrapper } from "@openchart/chart-core/primitive";
import { RenderCache } from "@openchart/chart-core/render";
import { createState } from "../state/defaults";
import { ChartStateUtils } from "../state/utilities";
import { repaint, type RuntimeState } from "./paint";

function fixture() {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    time: 1_756_684_800 + index * 86400,
    price: 1000 + index,
    selected: 100 + index,
    other: 10_000 + index,
    histogram: 100_000 + index,
  }));
  const state = createState();
  for (const [id, pane, axisId, type] of [
    ["price", 0, "right", "Line"],
    ["selected", 1, "study", "Line"],
    ["other", 1, "study", "Line"],
    ["histogram", 1, "study", "Histogram"],
  ] as const) {
    ChartStateUtils.addSeries(state, {
      id,
      type,
      pane,
      yAxisId: axisId,
      fieldMap: { x: "time", value: id },
      data: rows,
    });
  }
  ChartStateUtils.setVisibleRange(state, 10, 40);
  const { width, height } = state.config.chart.dimensions;
  const canvas = createCanvas(width, height);
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
  const show = (id: string, visible: boolean) =>
    ChartStateUtils.applySeriesOptions(state, id, { visible });
  return { state, runtime, paint, show };
}

describe("pane autoscale", () => {
  it("recomputes cached extents when outputs are hidden and shown", () => {
    const { runtime, paint, show } = fixture();
    paint();
    expect(runtime.modeCache!.extents.y.study).toEqual({
      min: 0,
      max: 100_039,
    });
    show("other", false);
    show("histogram", false);
    paint();
    expect(runtime.modeCache!.extents.y.study).toEqual({ min: 110, max: 139 });

    show("other", true);
    paint("light");
    expect(runtime.modeCache!.extents.y.study).toEqual({
      min: 110,
      max: 10_039,
    });
  });

  it("preserves manual axis bounds when output visibility changes", () => {
    const { state, runtime, paint, show } = fixture();
    show("histogram", false);
    ChartStateUtils.applyYAxisOptions(state, "study", {
      autoScale: false,
      visibleExtent: { min: 80, max: 200 },
    });
    paint();
    show("other", false);
    paint();
    expect(runtime.modeCache!.extents.y.study).toEqual({ min: 80, max: 200 });
  });

  it("keeps axes finite when every output is hidden", () => {
    const { runtime, paint, show } = fixture();
    for (const id of ["price", "selected", "other", "histogram"])
      show(id, false);
    paint();
    expect(runtime.coord!.scales.y.study!.extent.every(Number.isFinite)).toBe(
      true,
    );
    expect(runtime.coord!.scales.y.right!.extent.every(Number.isFinite)).toBe(
      true,
    );
  });
});
