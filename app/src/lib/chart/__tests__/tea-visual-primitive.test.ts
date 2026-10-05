// Purpose: Verify real coordinates, event timing, fill gaps and complete replacement.
import { expect, it, vi } from "vitest";
import { createCartesian2D } from "@openchart/chart-core/coord";
import { createIndicatorPrimitive } from "@openchart/app/lib/chart/tea-visual-primitive";
import { decodeIndicatorVisual } from "@openchart/app/lib/chart/tea-visual-value";
import type { Primitive } from "@openchart/chart-core/primitive";
import { Color } from "@openchart/chart-core/util";
const red = { r: 255, g: 0, b: 0, a: 128 };
const context: Primitive.DrawContext = {
  chartId: "chart",
  seriesId: "series",
  paneIndex: 0,
  width: 200,
  height: 100,
  barWidth: 20,
  xPositions: [10, 30, 50, 70],
  coord: createCartesian2D(
    { x: 0, y: 0, width: 200, height: 100 },
    { x: { min: 0, max: 4 }, y: { right: { min: 0, max: 100 } } },
    "right",
  ),
};
const data = {
  data: [1, 2, 3, 4].map((time) => ({
    time,
    high: 60,
    low: 40,
    close: 50,
    open: 45,
    value: 50,
  })),
  visibleRange: { from: 0, to: 4 },
};
const canvas = () =>
  ({
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    arc: vi.fn(),
  }) as unknown as CanvasRenderingContext2D;
function paint(primitive: Primitive.SeriesPrimitive, ctx = canvas()) {
  primitive.updateAllViews?.(context, data);
  for (const view of primitive.paneViews()) view.renderer()?.draw(ctx);
  return ctx;
}
const marker = (overrides = {}) =>
  decodeIndicatorVisual(
    {
      series: true,
      title: "Signal",
      style: "triangleup",
      location: "belowbar",
      color: red,
      text: "Potential reversal",
      offset: -1,
      force_overlay: true,
      ...overrides,
    },
    "shape",
  )!;

it("markers preserve confirmation time independently of an earlier displayed anchor", () => {
  const primitive = createIndicatorPrimitive({
    id: "confirmed-pivot",
    kind: "shape",
    rows: [{ time: 3, value: marker() }],
  });
  paint(primitive);
  const hit = primitive.hitTest?.(30, 71, context);
  expect(hit?.data).toEqual({
    kind: "shape",
    text: "Potential reversal",
    time: 3,
    targetTime: 2,
  });
  primitive.updateAllViews?.(context, { ...data, data: [] });
  expect(primitive.paneViews()).toEqual([]);
  expect(primitive.hitTest?.(30, 71, context)).toBeNull();
});

it("na/false marker contributions disappear and no fallback price is invented", () => {
  const primitive = createIndicatorPrimitive({
    id: "empty",
    kind: "shape",
    rows: [
      { time: 1, value: marker({ series: false }) },
      { time: 2, value: null },
    ],
  });
  expect(paint(primitive).fillText).not.toHaveBeenCalled();
  expect(primitive.paneViews()).toEqual([]);
  expect(() => marker({ location: "absolute" })).toThrow("numeric anchor");
});

it("dynamic fill follows both referenced outputs and never bridges a missing row", () => {
  const fill = (color = red) =>
    decodeIndicatorVisual({ first: "upper", second: "lower", color }, "fill")!;
  const primitive = createIndicatorPrimitive({
    id: "cloud",
    kind: "fill",
    rows: [
      { time: 1, value: fill() },
      { time: 2, value: fill({ r: 0, g: 255, b: 0, a: 128 }) },
      { time: 3, value: fill() },
      { time: 4, value: null },
    ],
    outputs: {
      upper: [
        { time: 1, value: 70 },
        { time: 2, value: 80 },
        { time: 3, value: null },
        { time: 4, value: 90 },
      ],
      lower: [1, 2, 3, 4].map((time) => ({ time, value: 30 })),
    },
  });
  const ctx = paint(primitive);
  expect(ctx.fill).toHaveBeenCalledTimes(1);
  expect(ctx.moveTo).toHaveBeenCalledWith(10, 30);
  expect(ctx.lineTo).toHaveBeenCalledWith(30, 20);
});

it("segment anchors are milliseconds but row/hit times remain core seconds", () => {
  const value = decodeIndicatorVisual(
    {
      id: "divergence",
      start_time: 1000,
      start_value: 60,
      end_time: 3000,
      end_value: 70,
      color: red,
      linewidth: 2,
      text: "Confirmed divergence",
      force_overlay: true,
    },
    "segment",
  )!;
  const primitive = createIndicatorPrimitive({
    id: "segment",
    kind: "segment",
    rows: [{ time: 4, value }],
  });
  const ctx = paint(primitive);
  expect(ctx.moveTo).toHaveBeenCalledWith(10, 40);
  expect(ctx.lineTo).toHaveBeenCalledWith(50, 30);
  expect(primitive.hitTest?.(30, 35, context)?.data).toEqual({
    kind: "segment",
    text: "Confirmed divergence",
    time: 4,
    targetTime: 3,
    range: { from: 1, to: 3 },
    values: { from: 60, to: 70 },
  });
});

it("zone revisions replace matching start identities without accumulating opacity", () => {
  const zone = (end: number) =>
    decodeIndicatorVisual(
      {
        id: "zone",
        start_time: 1000,
        end_time: end,
        top: 70,
        bottom: 40,
        color: red,
        text: "Support",
        force_overlay: true,
      },
      "zone",
    )!;
  const primitive = createIndicatorPrimitive({
    id: "zone",
    kind: "zone",
    rows: [
      { time: 2, value: zone(2000) },
      { time: 3, value: zone(3000) },
    ],
    labelLimit: 0,
  });
  const ctx = paint(primitive);
  expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  expect(ctx.fillRect).toHaveBeenCalledWith(10, 30, 40, 30);
  expect(ctx.fillText).not.toHaveBeenCalled();
  primitive.detached?.();
  expect(primitive.paneViews()).toEqual([]);
});

it.each([
  "shape",
  "character",
  "fill",
  "background",
  "bar-color",
  "segment",
  "zone",
  "candles",
] as const)("nominal %s decoder rejects malformed descriptions", (kind) => {
  expect(() => decodeIndicatorVisual({ lookalike: 1 }, kind)).toThrow();
  expect(decodeIndicatorVisual(null, kind)).toBeNull();
});

it("cloud fills project beyond the last candle using bar offsets without adding rows", () => {
  const value = decodeIndicatorVisual(
    { first: "a", second: "b", color: red },
    "fill",
  )!;
  const primitive = createIndicatorPrimitive({
    id: "future-cloud",
    kind: "fill",
    rows: [
      { time: 3, value },
      { time: 4, value },
    ],
    outputs: {
      a: [
        { time: 3, value: 70, offset: 2 },
        { time: 4, value: 80, offset: 2 },
      ],
      b: [
        { time: 3, value: 30, offset: 2 },
        { time: 4, value: 40, offset: 2 },
      ],
    },
  });
  const ctx = paint(primitive);
  expect(ctx.moveTo).toHaveBeenCalledWith(90, 30);
  expect(ctx.lineTo).toHaveBeenCalledWith(110, 20);
  expect(data.data).toHaveLength(4);
});

it("repeated segment descriptions keep the earliest observed confirmation time", () => {
  const value = decodeIndicatorVisual(
    {
      id: "divergence",
      start_time: 1000,
      start_value: 60,
      end_time: 2000,
      end_value: 70,
      color: red,
      linewidth: 2,
      text: "Divergence",
      force_overlay: true,
    },
    "segment",
  )!;
  const primitive = createIndicatorPrimitive({
    id: "repeated",
    kind: "segment",
    rows: [
      { time: 3, value },
      { time: 4, value },
    ],
  });
  const ctx = paint(primitive);
  expect(ctx.stroke).toHaveBeenCalledTimes(1);
  expect(primitive.hitTest?.(20, 35, context)?.data).toMatchObject({
    time: 3,
    targetTime: 2,
  });
});

it("rejects fractional and unsafe geometry timestamps rather than rounding them", () => {
  const segment = {
    id: "segment",
    start_time: 1000,
    start_value: 10,
    end_time: 2000,
    end_value: 20,
    color: red,
    linewidth: 1,
    text: "Signal",
    force_overlay: true,
  };
  expect(() =>
    decodeIndicatorVisual({ ...segment, start_time: 1000.5 }, "segment"),
  ).toThrow();
  expect(() =>
    decodeIndicatorVisual(
      { ...segment, start_time: Number.MAX_SAFE_INTEGER + 1 },
      "segment",
    ),
  ).toThrow();
  expect(
    decodeIndicatorVisual({ ...segment, start_time: NaN }, "segment")
      ?.start_time,
  ).toBeNaN();
});

it("keeps readable label colors without painting an opaque plate over the chart", () => {
  const pastel = { r: 170, g: 230, b: 190, a: 255 };
  const primitive = createIndicatorPrimitive({
    id: "light-label",
    kind: "shape",
    rows: [{ time: 2, value: marker({ offset: 0, textcolor: pastel }) }],
    background: "#ffffff",
  });
  const ctx = canvas();
  const textColors: string[] = [];
  const plates: string[] = [];
  ctx.fillText = vi.fn(() => {
    textColors.push(String(ctx.fillStyle));
  });
  ctx.fillRect = vi.fn(() => {
    plates.push(String(ctx.fillStyle));
  });
  paint(primitive, ctx);
  expect(textColors).toHaveLength(1);
  expect(textColors[0]).not.toBe("rgba(170, 230, 190, 1)");
  expect(
    1.05 / (Color.luminance(textColors[0]!) + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
  expect(plates).toEqual([]);
  const dark = createIndicatorPrimitive({
    id: "dark-label",
    kind: "shape",
    rows: [{ time: 2, value: marker({ offset: 0, textcolor: pastel }) }],
    background: "#111111",
  });
  paint(dark, ctx);
  expect(textColors.at(-1)).toBe("rgba(170, 230, 190, 1)");
});

it("moves labels away from series ink across their whole text width", () => {
  const ctx = canvas();
  const primitive = createIndicatorPrimitive({
    id: "avoid-neighboring-curve",
    kind: "shape",
    rows: [{ time: 2, value: marker({ offset: 0 }) }],
    background: "#ffffff",
  });
  const collides = vi.fn(
    (rect: { x: number; y: number; width: number; height: number }) =>
      // A neighboring curve crosses the preferred label, away from the marker.
      rect.x <= 100 &&
      rect.x + rect.width >= 100 &&
      rect.y <= 85 &&
      rect.y + rect.height >= 85,
  );
  primitive.updateAllViews?.(
    { ...context, labelIntersectsSeries: collides },
    data,
  );
  for (const view of primitive.paneViews()) view.renderer()?.draw(ctx);
  expect(collides).toHaveBeenCalled();
  expect(ctx.fillText).toHaveBeenCalledOnce();
  // Moving to the opposite side must also clear the marker's own body.
  const accepted = collides.mock.calls.find(
    (_, index) => collides.mock.results[index]?.value === false,
  )?.[0];
  expect(accepted).toBeDefined();
  expect(accepted!.y + accepted!.height).toBeLessThan(71 - 6);
  const [, x, y] = vi.mocked(ctx.fillText).mock.calls[0]!;
  expect(
    collides({ x: x as number, y: y as number, width: 110, height: 10 }),
  ).toBe(false);
  expect(ctx.fillRect).not.toHaveBeenCalled();
  expect(primitive.hitTest?.(30, 71, context)?.data).toMatchObject({
    text: "Potential reversal",
  });
});

it("retains the signal and hover when a dense pane has no clear label space", () => {
  const primitive = createIndicatorPrimitive({
    id: "dense-study",
    kind: "shape",
    rows: [{ time: 2, value: marker({ offset: 0 }) }],
    background: "#ffffff",
  });
  const shared = { ...context, labelIntersectsSeries: () => true };
  primitive.updateAllViews?.(shared, data);
  const ctx = canvas();
  for (const view of primitive.paneViews()) view.renderer()?.draw(ctx);
  expect(ctx.fill).toHaveBeenCalledOnce();
  expect(ctx.fillText).not.toHaveBeenCalled();
  expect(ctx.fillRect).not.toHaveBeenCalled();
  expect(primitive.hitTest?.(30, 71, shared)?.data).toMatchObject({
    text: "Potential reversal",
  });
});

it("shares a chart-wide label budget across output primitives and skips collisions", () => {
  const placements: NonNullable<Primitive.DrawContext["labelPlacements"]> = [];
  const shared = { ...context, labelPlacements: placements };
  const ctx = canvas();
  const first = createIndicatorPrimitive({
    id: "first-labels",
    kind: "shape",
    rows: [
      { time: 1, value: marker({ offset: 0, text: "A" }) },
      { time: 4, value: marker({ offset: 0, text: "B" }) },
    ],
    labelLimit: 2,
    background: "#111111",
  });
  const second = createIndicatorPrimitive({
    id: "second-labels",
    kind: "shape",
    rows: [{ time: 2, value: marker({ offset: 0, text: "C" }) }],
    labelLimit: 2,
    background: "#111111",
  });
  for (const primitive of [first, second]) {
    primitive.updateAllViews?.(shared, data);
    for (const view of primitive.paneViews()) view.renderer()?.draw(ctx);
  }
  expect(ctx.fillText).toHaveBeenCalledTimes(2);
  expect(placements).toHaveLength(2);
  expect(placements[0]!.x + placements[0]!.width).toBeLessThan(
    placements[1]!.x,
  );
  placements.length = 0;
  vi.mocked(ctx.fillText).mockClear();
  for (const text of ["A", "B", "C"]) {
    const primitive = createIndicatorPrimitive({
      id: text,
      kind: "shape",
      rows: [{ time: 2, value: marker({ offset: 0, text }) }],
      labelLimit: 8,
      background: "#111111",
    });
    primitive.updateAllViews?.(shared, data);
    for (const view of primitive.paneViews()) view.renderer()?.draw(ctx);
  }
  // Two labels fit on opposite sides of the same marker; the third is omitted.
  expect(ctx.fillText).toHaveBeenCalledTimes(2);
});

it("uses host contrast for uncolored markers but preserves explicitly transparent signals", () => {
  const defaults = createIndicatorPrimitive({
    id: "default-marker",
    kind: "shape",
    rows: [{ time: 2, value: marker({ offset: 0, color: null }) }],
    background: "#ffffff",
  });
  const ctx = paint(defaults);
  expect(ctx.fill).toHaveBeenCalledOnce();
  const hidden = createIndicatorPrimitive({
    id: "hidden-marker",
    kind: "shape",
    rows: [{ time: 2, value: marker({ offset: 0, color: { ...red, a: 0 } }) }],
    background: "#ffffff",
  });
  expect(paint(hidden).fill).not.toHaveBeenCalled();
  const textless = createIndicatorPrimitive({
    id: "textless",
    kind: "shape",
    rows: [
      { time: 2, value: marker({ offset: 0, textcolor: { ...red, a: 0 } }) },
    ],
    background: "#ffffff",
  });
  expect(paint(textless).fillText).not.toHaveBeenCalled();
});
