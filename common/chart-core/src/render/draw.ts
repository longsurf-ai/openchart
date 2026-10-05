// Purpose: Canvas 2D drawing routines for every series type, axes, grid, crosshair, and overlay tags
// Module:  @openchart/chart-core / render

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { Color } from "@openchart/chart-core/util";
import { Render } from "./items";
import {
  type SelectionGlowInput,
  bucketColor,
  bucketForIndex,
  isSelected,
  normalizeSelectionGlow,
  selectedSegmentWindowByIndex,
  selectedWindowByIndex,
} from "./selection-glow";

export type FadeGradient = { enabled: boolean; minAlpha: number };
export type StrokeLineStyle = "solid" | "dashed" | "dotted";

// Runs refer to item-array indices, keeping gaps out of paths, fills and glow.
function* finiteRanges(points: Render.Point[], range: Render.Range) {
  let from = range.from;
  for (let index = range.from; index < range.to; index++) {
    const point = points[index];
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) continue;
    if (from < index) yield { from, to: index };
    from = index + 1;
  }
  if (from < range.to) yield { from, to: range.to };
}

export namespace Draw {
  // Helper to draw rounded rectangle (with fallback for test environments)
  function roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    if (typeof ctx.arcTo === "function") {
      const r = Math.min(radius, width / 2, height / 2);
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + width - r, y);
      ctx.arcTo(x + width, y, x + width, y + r, r);
      ctx.lineTo(x + width, y + height - r);
      ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
      ctx.lineTo(x + r, y + height);
      ctx.arcTo(x, y + height, x, y + height - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      return;
    }
    ctx.rect(x, y, width, height);
  }

  // Draw a line through points
  export function line(
    ctx: CanvasRenderingContext2D,
    points: Render.Point[],
    range: Render.Range,
    lineWidth: number,
    selectionGlow?: SelectionGlowInput,
    fade?: FadeGradient,
    lineStyle: StrokeLineStyle = "solid",
  ): void {
    for (const segment of finiteRanges(points, range))
      lineSegment(
        ctx,
        points,
        segment,
        lineWidth,
        selectionGlow,
        fade,
        lineStyle,
      );
  }

  function lineSegment(
    ctx: CanvasRenderingContext2D,
    points: Render.Point[],
    range: Render.Range,
    lineWidth: number,
    selectionGlow?: SelectionGlowInput,
    fade?: FadeGradient,
    lineStyle: StrokeLineStyle = "solid",
  ): void {
    if (range.to <= range.from) return;

    const first = points[range.from];
    if (!first) return;

    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (lineStyle === "dashed") {
      ctx.setLineDash([Math.max(4, lineWidth * 4), Math.max(3, lineWidth * 3)]);
    } else if (lineStyle === "dotted") {
      ctx.setLineDash([Math.max(1, lineWidth), Math.max(3, lineWidth * 3)]);
    } else {
      ctx.setLineDash([]);
    }

    const useFade = fade?.enabled && range.to - range.from > 1;
    if (useFade) {
      const last = points[range.to - 1];
      if (first && last && last.x !== first.x) {
        const gradient = ctx.createLinearGradient(first.x, 0, last.x, 0);
        gradient.addColorStop(0, Color.withAlpha(first.color, fade.minAlpha));
        gradient.addColorStop(1, first.color);
        ctx.strokeStyle = gradient;
      } else {
        ctx.strokeStyle = first.color;
      }
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = range.from + 1; i < range.to; i++) {
        const p = points[i];
        if (!p) continue;
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    } else {
      let currentColor = first.color;
      ctx.strokeStyle = currentColor;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);

      for (let i = range.from + 1; i < range.to; i++) {
        const p = points[i];
        if (!p) continue;

        const prev = points[i - 1];
        if (p.color !== currentColor && prev) {
          ctx.stroke();
          currentColor = p.color;
          ctx.strokeStyle = currentColor;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
        }

        ctx.lineTo(p.x, p.y);
      }

      ctx.stroke();
    }
    ctx.restore();

    const glow = normalizeSelectionGlow(selectionGlow);
    if (!glow) return;

    const segmentRange = selectedSegmentWindowByIndex(points, range, glow);
    if (!segmentRange) return;

    const bucketSegments: number[][] = Array.from(
      { length: glow.bucketCount },
      () => [],
    );
    for (let i = segmentRange.from; i < segmentRange.to; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      if (!p0 || !p1) continue;
      if (!isSelected(glow, p0.index) && !isSelected(glow, p1.index)) continue;
      bucketSegments[bucketForIndex(glow, p0.index)]!.push(i);
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(lineWidth + 0.55, 1.2);
    ctx.shadowBlur = 8;

    for (let bucket = 0; bucket < bucketSegments.length; bucket++) {
      const segments = bucketSegments[bucket];
      if (!segments || segments.length === 0) continue;
      const color = bucketColor(glow, bucket);
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.beginPath();
      for (let s = 0; s < segments.length; s++) {
        const p0 = points[segments[s]!];
        const p1 = points[segments[s]! + 1];
        if (!p0 || !p1) continue;
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw candlesticks
  export function candlesticks(
    ctx: CanvasRenderingContext2D,
    items: Render.Candlestick[],
    range: Render.Range,
    selectionGlow?: SelectionGlowInput,
  ): void {
    if (range.to <= range.from) return;

    // Draw wicks first
    for (let i = range.from; i < range.to; i++) {
      const c = items[i];
      if (!c || ![c.openY, c.highY, c.lowY, c.closeY].every(Number.isFinite))
        continue;

      const wickX = Math.round(c.x);
      const top = Math.min(c.openY, c.closeY);
      const bottom = Math.max(c.openY, c.closeY);

      ctx.fillStyle = c.wickColor;
      ctx.fillRect(wickX, c.highY, 1, top - c.highY);
      ctx.fillRect(wickX, bottom, 1, c.lowY - bottom);
    }

    // Draw bodies
    for (let i = range.from; i < range.to; i++) {
      const c = items[i];
      if (!c || ![c.openY, c.highY, c.lowY, c.closeY].every(Number.isFinite))
        continue;

      const left = Math.round(c.x - c.width / 2);
      const top = Math.min(c.openY, c.closeY);
      const bottom = Math.max(c.openY, c.closeY);
      const height = Math.max(1, bottom - top);

      ctx.fillStyle = c.color;
      ctx.fillRect(left, top, c.width, height);

      if (c.borderColor !== c.color) {
        ctx.strokeStyle = c.borderColor;
        ctx.strokeRect(left, top, c.width, height);
      }
    }

    const glow = normalizeSelectionGlow(selectionGlow);
    if (!glow) return;

    const selectedRange = selectedWindowByIndex(items, range, glow);
    if (!selectedRange) return;

    const bucketItems: number[][] = Array.from(
      { length: glow.bucketCount },
      () => [],
    );
    for (let i = selectedRange.from; i < selectedRange.to; i++) {
      const c = items[i];
      if (!c || !isSelected(glow, c.index)) continue;
      bucketItems[bucketForIndex(glow, c.index)]!.push(i);
    }

    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.lineWidth = 1;
    ctx.shadowBlur = 8;

    for (let bucket = 0; bucket < bucketItems.length; bucket++) {
      const candles = bucketItems[bucket];
      if (!candles || candles.length === 0) continue;

      const color = bucketColor(glow, bucket);
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.beginPath();

      for (let j = 0; j < candles.length; j++) {
        const c = items[candles[j]!];
        if (!c || ![c.openY, c.highY, c.lowY, c.closeY].every(Number.isFinite))
          continue;

        const wickX = Math.round(c.x) + 0.5;
        const left = Math.round(c.x - c.width / 2);
        const top = Math.min(c.openY, c.closeY);
        const bottom = Math.max(c.openY, c.closeY);
        const width = Math.max(1, c.width);
        const height = Math.max(1, bottom - top);
        const wickTop = Math.min(c.openY, c.closeY);
        const wickBottom = Math.max(c.openY, c.closeY);

        if (c.highY < wickTop) {
          ctx.moveTo(wickX, c.highY);
          ctx.lineTo(wickX, wickTop);
        }
        if (c.lowY > wickBottom) {
          ctx.moveTo(wickX, wickBottom);
          ctx.lineTo(wickX, c.lowY);
        }

        ctx.rect(
          left + 0.5,
          top + 0.5,
          Math.max(0, width - 1),
          Math.max(0, height - 1),
        );
      }

      ctx.stroke();
    }

    ctx.restore();
  }

  // Draw OHLC bars
  export function bars(
    ctx: CanvasRenderingContext2D,
    items: Render.Bar[],
    range: Render.Range,
    selectionGlow?: SelectionGlowInput,
  ): void {
    if (range.to <= range.from) return;

    ctx.lineWidth = 1;

    for (let i = range.from; i < range.to; i++) {
      const b = items[i];
      if (!b || ![b.openY, b.highY, b.lowY, b.closeY].every(Number.isFinite))
        continue;

      const x = Math.round(b.x);
      const halfWidth = Math.floor(b.width / 2);

      ctx.strokeStyle = b.color;
      ctx.beginPath();

      // Vertical line (high to low)
      ctx.moveTo(x, b.highY);
      ctx.lineTo(x, b.lowY);

      // Open tick (left)
      ctx.moveTo(x - halfWidth, b.openY);
      ctx.lineTo(x, b.openY);

      // Close tick (right)
      ctx.moveTo(x, b.closeY);
      ctx.lineTo(x + halfWidth, b.closeY);

      ctx.stroke();
    }

    const glow = normalizeSelectionGlow(selectionGlow);
    if (!glow) return;

    const selectedRange = selectedWindowByIndex(items, range, glow);
    if (!selectedRange) return;

    const bucketItems: number[][] = Array.from(
      { length: glow.bucketCount },
      () => [],
    );
    for (let i = selectedRange.from; i < selectedRange.to; i++) {
      const b = items[i];
      if (!b || !isSelected(glow, b.index)) continue;
      bucketItems[bucketForIndex(glow, b.index)]!.push(i);
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.25;
    ctx.shadowBlur = 8;

    for (let bucket = 0; bucket < bucketItems.length; bucket++) {
      const barsInBucket = bucketItems[bucket];
      if (!barsInBucket || barsInBucket.length === 0) continue;
      const color = bucketColor(glow, bucket);
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.beginPath();

      for (let j = 0; j < barsInBucket.length; j++) {
        const b = items[barsInBucket[j]!];
        if (!b || ![b.openY, b.highY, b.lowY, b.closeY].every(Number.isFinite))
          continue;
        const x = Math.round(b.x) + 0.5;
        const halfWidth = Math.floor(b.width / 2);
        ctx.moveTo(x, b.highY);
        ctx.lineTo(x, b.lowY);
        ctx.moveTo(x - halfWidth, b.openY);
        ctx.lineTo(x, b.openY);
        ctx.moveTo(x, b.closeY);
        ctx.lineTo(x + halfWidth, b.closeY);
      }

      ctx.stroke();
    }

    ctx.restore();
  }

  // Draw histogram bars
  export function histogram(
    ctx: CanvasRenderingContext2D,
    items: Render.Histogram[],
    range: Render.Range,
    selectionGlow?: SelectionGlowInput,
  ): void {
    if (range.to <= range.from) return;

    for (let i = range.from; i < range.to; i++) {
      const h = items[i];
      if (!h || !Number.isFinite(h.y)) continue;

      const left = Math.round(h.x - h.width / 2);
      const width = Math.round(h.width);
      const top = Math.round(Math.min(h.y, h.baseY));
      const bottom = Math.round(Math.max(h.y, h.baseY));
      const height = Math.max(1, bottom - top);

      ctx.fillStyle = h.color;
      ctx.fillRect(left, top, width, height);
    }

    const glow = normalizeSelectionGlow(selectionGlow);
    if (!glow) return;

    const selectedRange = selectedWindowByIndex(items, range, glow);
    if (!selectedRange) return;

    const bucketItems: number[][] = Array.from(
      { length: glow.bucketCount },
      () => [],
    );
    for (let i = selectedRange.from; i < selectedRange.to; i++) {
      const h = items[i];
      if (!h || !isSelected(glow, h.index)) continue;
      bucketItems[bucketForIndex(glow, h.index)]!.push(i);
    }

    ctx.save();
    ctx.lineWidth = 1;
    ctx.shadowBlur = 8;

    for (let bucket = 0; bucket < bucketItems.length; bucket++) {
      const barsInBucket = bucketItems[bucket];
      if (!barsInBucket || barsInBucket.length === 0) continue;
      const color = bucketColor(glow, bucket);
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.beginPath();

      for (let j = 0; j < barsInBucket.length; j++) {
        const h = items[barsInBucket[j]!];
        if (!h || !Number.isFinite(h.y)) continue;
        const left = Math.round(h.x - h.width / 2) - 0.5;
        const width = Math.max(1, Math.round(h.width) + 1);
        const top = Math.round(Math.min(h.y, h.baseY)) - 0.5;
        const bottom = Math.round(Math.max(h.y, h.baseY)) + 0.5;
        const height = Math.max(1, bottom - top);
        ctx.rect(left, top, width, height);
      }

      ctx.stroke();
    }

    ctx.restore();
  }

  // Draw area chart
  export function area(
    ctx: CanvasRenderingContext2D,
    points: Render.Point[],
    range: Render.Range,
    baseY: number,
    topColor: string,
    bottomColor: string,
    lineColor: string,
    lineWidth: number,
    selectionGlow?: SelectionGlowInput,
  ): void {
    for (const segment of finiteRanges(points, range))
      areaSegment(
        ctx,
        points,
        segment,
        baseY,
        topColor,
        bottomColor,
        lineColor,
        lineWidth,
        selectionGlow,
      );
  }

  function areaSegment(
    ctx: CanvasRenderingContext2D,
    points: Render.Point[],
    range: Render.Range,
    baseY: number,
    topColor: string,
    bottomColor: string,
    lineColor: string,
    lineWidth: number,
    selectionGlow?: SelectionGlowInput,
  ): void {
    if (range.to <= range.from) return;

    const first = points[range.from];
    const last = points[range.to - 1];
    if (!first || !last) return;

    // Fill area
    const gradient = ctx.createLinearGradient(0, 0, 0, baseY);
    gradient.addColorStop(0, topColor);
    gradient.addColorStop(1, bottomColor);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(first.x, baseY);

    for (let i = range.from; i < range.to; i++) {
      const p = points[i];
      if (!p) continue;
      ctx.lineTo(p.x, p.y);
    }

    ctx.lineTo(last.x, baseY);
    ctx.closePath();
    ctx.fill();

    // Draw line on top
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);

    for (let i = range.from + 1; i < range.to; i++) {
      const p = points[i];
      if (!p) continue;
      ctx.lineTo(p.x, p.y);
    }

    ctx.stroke();

    const glow = normalizeSelectionGlow(selectionGlow);
    if (!glow) return;

    const segmentRange = selectedSegmentWindowByIndex(points, range, glow);
    if (!segmentRange) return;

    const bucketSegments: number[][] = Array.from(
      { length: glow.bucketCount },
      () => [],
    );
    for (let i = segmentRange.from; i < segmentRange.to; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      if (!p0 || !p1) continue;
      if (!isSelected(glow, p0.index) && !isSelected(glow, p1.index)) continue;
      bucketSegments[bucketForIndex(glow, p0.index)]!.push(i);
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(lineWidth + 0.55, 1.2);
    ctx.shadowBlur = 8;

    for (let bucket = 0; bucket < bucketSegments.length; bucket++) {
      const segments = bucketSegments[bucket];
      if (!segments || segments.length === 0) continue;
      const color = bucketColor(glow, bucket);
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.beginPath();
      for (let s = 0; s < segments.length; s++) {
        const p0 = points[segments[s]!];
        const p1 = points[segments[s]! + 1];
        if (!p0 || !p1) continue;
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // Clear canvas
  export function clear(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    background: string,
  ): void {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  // Draw grid
  export function grid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    xLines: number[],
    yLines: number[],
    color: string,
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);

    ctx.beginPath();

    for (const x of xLines) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
    }

    for (const y of yLines) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw crosshair constrained to plot area
  export function crosshair(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number | undefined,
    plot: { x: number; y: number; width: number; height: number },
    color: string,
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    // Vertical line within plot bounds
    ctx.moveTo(Math.round(x) + 0.5, plot.y);
    ctx.lineTo(Math.round(x) + 0.5, plot.y + plot.height);
    // Horizontal line within plot bounds
    if (y !== undefined) {
      ctx.moveTo(plot.x, Math.round(y) + 0.5);
      ctx.lineTo(plot.x + plot.width, Math.round(y) + 0.5);
    }
    ctx.stroke();

    ctx.setLineDash([]);
  }

  // Draw time axis with labels
  export function timeAxis(
    ctx: CanvasRenderingContext2D,
    marks: { x: number; label: string }[],
    y: number,
    color: string,
    font: string,
  ): void {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (const mark of marks) {
      ctx.fillText(mark.label, mark.x, y + 4);
    }

    // Draw axis line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(ctx.canvas.width, y + 0.5);
    ctx.stroke();
  }

  // Draw price axis with labels
  export function priceAxis(
    ctx: CanvasRenderingContext2D,
    marks: { y: number; label: string }[],
    width: number,
    color: string,
    font: string,
    side: "left" | "right",
  ): void {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = side === "left" ? "left" : "right";
    ctx.textBaseline = "middle";

    const textX = side === "left" ? 4 : width - 4;

    for (const mark of marks) {
      ctx.fillText(mark.label, textX, mark.y);
    }

    // Draw axis line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const lineX = side === "left" ? width - 0.5 : 0.5;
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, ctx.canvas.height);
    ctx.stroke();
  }

  // Draw baseline series (area chart with baseline dividing positive/negative)
  export function baseline(
    ctx: CanvasRenderingContext2D,
    points: Render.Point[],
    range: Render.Range,
    baselineY: number,
    topFillColor1: string,
    topFillColor2: string,
    topLineColor: string,
    bottomFillColor1: string,
    bottomFillColor2: string,
    bottomLineColor: string,
    lineWidth: number,
  ): void {
    for (const segment of finiteRanges(points, range))
      baselineSegment(
        ctx,
        points,
        segment,
        baselineY,
        topFillColor1,
        topFillColor2,
        topLineColor,
        bottomFillColor1,
        bottomFillColor2,
        bottomLineColor,
        lineWidth,
      );
  }

  function baselineSegment(
    ctx: CanvasRenderingContext2D,
    points: Render.Point[],
    range: Render.Range,
    baselineY: number,
    topFillColor1: string,
    topFillColor2: string,
    topLineColor: string,
    bottomFillColor1: string,
    bottomFillColor2: string,
    bottomLineColor: string,
    lineWidth: number,
  ): void {
    if (range.to <= range.from) return;

    const first = points[range.from];
    const last = points[range.to - 1];
    if (!first || !last) return;

    // Draw top fill (above baseline)
    const topGradient = ctx.createLinearGradient(0, 0, 0, baselineY);
    topGradient.addColorStop(0, topFillColor1);
    topGradient.addColorStop(1, topFillColor2);

    ctx.fillStyle = topGradient;
    ctx.beginPath();
    ctx.moveTo(first.x, baselineY);

    for (let i = range.from; i < range.to; i++) {
      const p = points[i];
      if (!p) continue;
      ctx.lineTo(p.x, Math.min(p.y, baselineY));
    }

    ctx.lineTo(last.x, baselineY);
    ctx.closePath();
    ctx.fill();

    // Draw bottom fill (below baseline)
    const bottomGradient = ctx.createLinearGradient(
      0,
      baselineY,
      0,
      ctx.canvas.height,
    );
    bottomGradient.addColorStop(0, bottomFillColor1);
    bottomGradient.addColorStop(1, bottomFillColor2);

    ctx.fillStyle = bottomGradient;
    ctx.beginPath();
    ctx.moveTo(first.x, baselineY);

    for (let i = range.from; i < range.to; i++) {
      const p = points[i];
      if (!p) continue;
      ctx.lineTo(p.x, Math.max(p.y, baselineY));
    }

    ctx.lineTo(last.x, baselineY);
    ctx.closePath();
    ctx.fill();

    // Draw line with color change at baseline
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let currentAbove = points[range.from]
      ? points[range.from]!.y < baselineY
      : true;

    ctx.strokeStyle = currentAbove ? topLineColor : bottomLineColor;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);

    for (let i = range.from + 1; i < range.to; i++) {
      const p = points[i];
      const prev = points[i - 1];
      if (!p || !prev) continue;

      const wasAbove = currentAbove;
      currentAbove = p.y < baselineY;

      if (wasAbove !== currentAbove) {
        // Find intersection with baseline
        const t = (baselineY - prev.y) / (p.y - prev.y);
        const crossX = prev.x + t * (p.x - prev.x);

        ctx.lineTo(crossX, baselineY);
        ctx.stroke();

        ctx.strokeStyle = currentAbove ? topLineColor : bottomLineColor;
        ctx.beginPath();
        ctx.moveTo(crossX, baselineY);
      }

      ctx.lineTo(p.x, p.y);
    }

    ctx.stroke();
  }

  // Draw crosshair axis labels (price/time at crosshair position)
  export function crosshairLabels(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    timeLabel: string,
    priceLabel: string,
    width: number,
    height: number,
    bgColor: string,
    textColor: string,
    font: string,
  ): void {
    ctx.font = font;

    // Time label at bottom
    const timeWidth = ctx.measureText(timeLabel).width + 8;
    const timeX = Math.max(0, Math.min(width - timeWidth, x - timeWidth / 2));
    ctx.fillStyle = bgColor;
    ctx.fillRect(timeX, height - 20, timeWidth, 18);
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(timeLabel, timeX + timeWidth / 2, height - 11);

    // Price label at right
    const priceWidth = ctx.measureText(priceLabel).width + 8;
    ctx.fillStyle = bgColor;
    ctx.fillRect(width - priceWidth, y - 9, priceWidth, 18);
    ctx.fillStyle = textColor;
    ctx.textAlign = "right";
    ctx.fillText(priceLabel, width - 4, y);
  }

  // Draw crosshair Y-axis tag (value tag on price axis)
  export function crosshairYTag(
    ctx: CanvasRenderingContext2D,
    y: number,
    label: string,
    axisBounds: { x: number; width: number },
    side: "left" | "right",
    bgColor: string,
    textColor: string,
    font: string,
  ): void {
    ctx.save();
    ctx.font = font;
    const height = 18;
    const radius = 3;

    const tagX = axisBounds.x;
    const tagY = Math.round(y) - height / 2;

    // Draw rounded rectangle background
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    roundedRect(ctx, tagX, tagY, axisBounds.width, height, radius);
    ctx.fill();

    // Draw text
    ctx.fillStyle = textColor;
    ctx.textAlign = side === "left" ? "right" : "left";
    ctx.textBaseline = "middle";
    const textX =
      side === "left" ? axisBounds.x + axisBounds.width - 8 : axisBounds.x + 8;
    ctx.fillText(label, textX, Math.round(y));

    ctx.restore();
  }

  // Draw crosshair X-axis tag (time tag on time axis)
  export function crosshairXTag(
    ctx: CanvasRenderingContext2D,
    x: number,
    label: string,
    axisBounds: { x: number; y: number; width: number; height: number },
    bgColor: string,
    textColor: string,
    font: string,
  ): void {
    ctx.save();
    ctx.font = font;
    const padding = 6;
    const height = 18;
    const width = ctx.measureText(label).width + padding * 2;
    const radius = 3;

    // Center the tag on x, clamp to axis bounds
    const tagX = Math.max(
      axisBounds.x,
      Math.min(axisBounds.x + axisBounds.width - width, x - width / 2),
    );
    const tagY = axisBounds.y + (axisBounds.height - height) / 2;

    // Draw rounded rectangle background
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    roundedRect(ctx, tagX, tagY, width, height, radius);
    ctx.fill();

    // Draw text
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, tagX + width / 2, tagY + height / 2);

    ctx.restore();
  }

  /** Height of a single-line value tag pill. */
  export const VALUE_TAG_HEIGHT = 18;
  /** Height of a two-line value tag pill (label + subLabel). */
  export const VALUE_TAG_HEIGHT_TALL = 30;
  /** Horizontal inset for value tag labels. */
  export const VALUE_TAG_HORIZONTAL_PADDING = 8;
  /** Subtle selection outline width for emphasized value tags. */
  export const VALUE_TAG_BORDER_WIDTH = 1.5;

  export function measureValueTagWidth(
    ctx: CanvasRenderingContext2D,
    label: string,
    axisWidth: number,
    subLabel?: string,
    minWidth = axisWidth,
  ): number {
    const labelWidth = ctx.measureText(label).width;
    const subLabelWidth = subLabel ? ctx.measureText(subLabel).width : 0;
    return Math.max(
      axisWidth,
      minWidth,
      Math.ceil(
        Math.max(labelWidth, subLabelWidth) + VALUE_TAG_HORIZONTAL_PADDING * 2,
      ),
    );
  }

  // Draw value tag on Y-axis (for last value, etc.). When `subLabel` is
  // present, the pill grows to two lines — primary label on top, smaller
  // monospaced sub-label (e.g. session countdown) below.
  export function valueTag(
    ctx: CanvasRenderingContext2D,
    y: number,
    label: string,
    axisX: number,
    axisWidth: number,
    side: "left" | "right",
    bgColor: string,
    textColor: string,
    font: string,
    subLabel?: string,
    minWidth?: number,
    borderColor?: string,
  ): void {
    ctx.save();
    ctx.font = font;
    const height = subLabel ? VALUE_TAG_HEIGHT_TALL : VALUE_TAG_HEIGHT;
    const radius = 3;
    const width = measureValueTagWidth(
      ctx,
      label,
      axisWidth,
      subLabel,
      minWidth,
    );
    const tagX = side === "left" ? axisX : axisX + axisWidth - width;

    const tagY = Math.round(y) - height / 2;

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    roundedRect(ctx, tagX, tagY, width, height, radius);
    ctx.fill();
    if (borderColor) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = VALUE_TAG_BORDER_WIDTH;
      ctx.beginPath();
      roundedRect(ctx, tagX, tagY, width, height, radius);
      ctx.stroke();
    }

    ctx.fillStyle = textColor;
    ctx.textAlign = side === "left" ? "right" : "left";
    const textX =
      side === "left"
        ? tagX + width - VALUE_TAG_HORIZONTAL_PADDING
        : tagX + VALUE_TAG_HORIZONTAL_PADDING;
    if (subLabel) {
      // Two-line layout: primary label on top, sub-label below — same font
      // family and size as the rest of the chart so the countdown reads as
      // part of the value pill, not a footnote.
      ctx.textBaseline = "middle";
      ctx.fillText(label, textX, tagY + 9);
      ctx.fillText(subLabel, textX, tagY + 21);
    } else {
      ctx.textBaseline = "middle";
      ctx.fillText(label, textX, Math.round(y));
    }

    ctx.restore();
  }

  /** Padding inside the ticker badge pill. */
  export const TICKER_BADGE_PADDING = 4;
  /** Visual gap between the ticker badge and the value tag. */
  export const TICKER_BADGE_GAP = 1;

  // Draw ticker badge inside the plot area at the last-value y-position.
  // The badge stays single-line (18px); callers wanting it to top-align with
  // a two-line value tag should shift the `y` argument up by
  // (VALUE_TAG_HEIGHT_TALL - VALUE_TAG_HEIGHT) / 2 so the badge centers on the
  // value tag's label row rather than the pill's vertical midpoint.
  export function tickerBadge(
    ctx: CanvasRenderingContext2D,
    y: number,
    ticker: string,
    badgeX: number,
    badgeWidth: number,
    bgColor: string,
    textColor: string,
    font: string,
    borderColor?: string,
  ): void {
    if (!ticker) return;
    ctx.save();
    ctx.font = font;
    const height = VALUE_TAG_HEIGHT;
    const radius = 3;
    const badgeY = Math.round(y) - height / 2;

    // Background pill
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    roundedRect(ctx, badgeX, badgeY, badgeWidth, height, radius);
    ctx.fill();
    if (borderColor) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = VALUE_TAG_BORDER_WIDTH;
      ctx.beginPath();
      roundedRect(ctx, badgeX, badgeY, badgeWidth, height, radius);
      ctx.stroke();
    }

    // Text
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ticker, badgeX + badgeWidth / 2, Math.round(y));

    ctx.restore();
  }

  // Draw dashed horizontal line across chart
  export function dashedLine(
    ctx: CanvasRenderingContext2D,
    y: number,
    fromX: number,
    toX: number,
    color: string,
    pattern: number[] = [4, 4],
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(pattern);
    ctx.beginPath();
    ctx.moveTo(fromX, Math.round(y) + 0.5);
    ctx.lineTo(toX, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Draw crosshair badge (dot + pill label) at series intersection
  export function crosshairBadge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    title: string,
    value: string,
    color: string,
    textColor: string,
    font: string,
  ): void {
    const dotRadius = 4;
    const pillPadding = 6;
    const pillHeight = 20;
    const pillRadius = pillHeight / 2;
    const gap = 8;

    ctx.save();

    // Filled circle at intersection
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    // Measure and position pill
    ctx.font = font;
    const label = `${title}  ${value}`;
    const textWidth = ctx.measureText(label).width;
    const pillWidth = textWidth + pillPadding * 2;
    const drawLeft = x + gap + pillWidth > ctx.canvas.width - 10;
    const pillX = drawLeft ? x - gap - pillWidth : x + gap;
    const pillY = y - pillHeight / 2;

    // Pill background
    ctx.fillStyle = color;
    ctx.beginPath();
    roundedRect(ctx, pillX, pillY, pillWidth, pillHeight, pillRadius);
    ctx.fill();

    // Text
    ctx.fillStyle = textColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, pillX + pillPadding, y);

    ctx.restore();
  }
}
