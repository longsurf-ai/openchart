// Purpose: Tests for selected-series glow rendering behavior
// Module:  @openchart/chart-core / tests

import { describe, expect, it, vi } from "vitest";
import { Draw } from "@openchart/chart-core/render/draw";

function createMockContext() {
  let strokeStyleValue = "";
  let strokeStyleSetCount = 0;
  let fillStyleValue = "";
  let shadowColorValue = "";
  let shadowBlurValue = 0;
  let shadowBlurSetCount = 0;

  const api = {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    rect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    createLinearGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    get strokeStyleSetCount() {
      return strokeStyleSetCount;
    },
    get shadowBlurSetCount() {
      return shadowBlurSetCount;
    },
  };

  const ctx = {
    ...api,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      strokeStyleValue = String(value);
      strokeStyleSetCount++;
    },
    get strokeStyle(): string {
      return strokeStyleValue;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyleValue = String(value);
    },
    get fillStyle(): string {
      return fillStyleValue;
    },
    set shadowColor(value: string) {
      shadowColorValue = value;
    },
    get shadowColor(): string {
      return shadowColorValue;
    },
    set shadowBlur(value: number) {
      shadowBlurValue = value;
      shadowBlurSetCount++;
    },
    get shadowBlur(): number {
      return shadowBlurValue;
    },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, api };
}

describe("Draw selection glow", () => {
  it("does not run glow pass when disabled", () => {
    const { ctx, api } = createMockContext();
    const items = Array.from({ length: 24 }, (_, i) => ({
      x: i * 4 + 8,
      index: i,
      width: 3,
      color: "#26a69a",
      borderColor: "#26a69a",
      wickColor: "#26a69a",
      openY: 100,
      closeY: 112,
      highY: 96,
      lowY: 116,
    }));

    Draw.candlesticks(ctx, items, { from: 0, to: items.length });
    expect(api.save).not.toHaveBeenCalled();
    expect(api.shadowBlurSetCount).toBe(0);
  });

  it("runs glow pass for selected candlestick range", () => {
    const { ctx, api } = createMockContext();
    const items = Array.from({ length: 40 }, (_, i) => ({
      x: i * 4 + 8,
      index: i,
      width: 3,
      color: "#ef5350",
      borderColor: "#ef5350",
      wickColor: "#ef5350",
      openY: 120,
      closeY: 104,
      highY: 98,
      lowY: 124,
    }));

    Draw.candlesticks(
      ctx,
      items,
      { from: 0, to: items.length },
      { enabled: true, fromIndex: 8, toIndex: 21, speed: 1.2 },
    );

    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.restore).toHaveBeenCalledTimes(1);
    expect(api.stroke).toHaveBeenCalled();
    expect(api.shadowBlurSetCount).toBeGreaterThan(0);
  });

  it("bounds glow style switches for large line selections", () => {
    const { ctx, api } = createMockContext();
    const points = Array.from({ length: 1400 }, (_, i) => ({
      x: i,
      y: 120 + Math.sin(i * 0.03) * 20,
      index: i,
      color: "#4a92ff",
    }));

    Draw.line(ctx, points, { from: 0, to: points.length }, 2, {
      enabled: true,
      fromIndex: 0,
      toIndex: points.length - 1,
      speed: 1.2,
    });

    // Base path sets style once, glow path is bucket-capped at <= 96 updates.
    expect(api.strokeStyleSetCount).toBeGreaterThan(1);
    expect(api.strokeStyleSetCount).toBeLessThanOrEqual(100);
  });
});
