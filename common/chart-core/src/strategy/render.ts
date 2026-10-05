// Purpose: Paint automatic strategy entry, exit, and derived performance presentation on the chart canvas
// Module:  @openchart/chart-core / strategy

import {
  DrawingRenderUtils,
  type RenderContext,
} from "@openchart/chart-core/drawing";
import { Color } from "@openchart/chart-core/util";
import { Strategy } from "./types";

type Point = { x: number; y: number };

export type StrategyRenderInput = {
  ctx: CanvasRenderingContext2D;
  render: RenderContext;
  strategy?: Strategy.State;
};

const FONT_FAMILY = "Inter, system-ui, sans-serif";

function pointForFill(
  render: RenderContext,
  fill: Strategy.Fill,
): Point | null {
  return DrawingRenderUtils.anchorToPoint(
    { time: fill.time, price: fill.price },
    render,
  );
}

function paintTriangle(
  ctx: CanvasRenderingContext2D,
  point: Point,
  direction: "up" | "down",
  color: string,
): void {
  const size = 8;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  if (direction === "up") {
    ctx.moveTo(point.x, point.y - size);
    ctx.lineTo(point.x - size, point.y + size * 0.65);
    ctx.lineTo(point.x + size, point.y + size * 0.65);
  } else {
    ctx.moveTo(point.x, point.y + size);
    ctx.lineTo(point.x - size, point.y - size * 0.65);
    ctx.lineTo(point.x + size, point.y - size * 0.65);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function candleBottomPoint(
  render: RenderContext,
  fill: Strategy.Fill,
  index: number,
): Point | null {
  const row = render.data[index] as { low?: unknown } | undefined;
  const low = typeof row?.low === "number" ? row.low : fill.price;
  return pointForFill(render, { ...fill, price: low });
}

function paintExecutionCard(
  ctx: CanvasRenderingContext2D,
  render: RenderContext,
  marker: Point,
  action: string,
  price: number,
  actionColor: string,
  colors: { background: string; foreground: string; muted: string },
  secondLine?: string,
): void {
  ctx.save();
  ctx.font = `600 12px ${FONT_FAMILY}`;
  const priceText = price.toFixed(2);
  const titleWidth =
    ctx.measureText(action).width + 5 + ctx.measureText(priceText).width;
  const detailWidth = secondLine ? ctx.measureText(secondLine).width : 0;
  const width = Math.ceil(Math.max(titleWidth, detailWidth)) + 22;
  const height = secondLine ? 45 : 28;
  const x = Math.max(
    render.area.x + 8,
    Math.min(
      marker.x - width / 2,
      render.area.x + render.area.width - width - 8,
    ),
  );
  const y = Math.min(
    marker.y + 15,
    render.area.y + render.area.height - height - 8,
  );
  const centerX = x + width / 2;
  const titleStartX = centerX - titleWidth / 2;

  ctx.fillStyle = Color.withAlpha(colors.background, 0.96);
  ctx.strokeStyle = Color.withAlpha(colors.foreground, 0.72);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 6);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = actionColor;
  ctx.fillText(action, titleStartX, y + (secondLine ? 15 : height / 2) + 0.5);
  ctx.fillStyle = colors.foreground;
  ctx.fillText(
    priceText,
    titleStartX + ctx.measureText(action).width + 5,
    y + (secondLine ? 15 : height / 2) + 0.5,
  );
  if (secondLine) {
    ctx.fillStyle = colors.muted;
    ctx.font = `500 11px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText(secondLine, centerX, y + 32.5);
  }
  ctx.restore();
}

export function closedTradeExitSummary(
  trade: Strategy.ClosedTrade,
  initialCapital: number,
  sessionCount: number,
): string {
  const metrics = Strategy.closedTradeMetrics(trade, initialCapital);
  const percentage = `${metrics.returnFraction >= 0 ? "+" : ""}${(
    metrics.returnFraction * 100
  ).toFixed(1)}%`;
  return `${percentage} · ${sessionCount} sessions`;
}

export function renderStrategyExecutions({
  ctx,
  render,
  strategy,
}: StrategyRenderInput): void {
  if (!strategy || strategy.trades.length === 0) return;

  const colors = {
    positive: Color.resolve("var(--up, #4ec9b0)"),
    negative: Color.resolve("var(--down, #d05574)"),
    background: Color.resolve("var(--card, #111418)"),
    foreground: Color.resolve("var(--foreground, #f5f7f8)"),
    muted: Color.resolve("var(--muted-foreground, #9ca3af)"),
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(render.area.x, render.area.y, render.area.width, render.area.height);
  ctx.clip();

  for (const trade of strategy.trades) {
    const entry = pointForFill(render, trade.entry);
    if (!entry) continue;
    const entryIndex = DrawingRenderUtils.indexFromTime(
      render.data,
      trade.entry.time,
    );
    if (entryIndex === null) continue;
    const entryBottom = candleBottomPoint(render, trade.entry, entryIndex);
    if (!entryBottom) continue;
    const entryMarker = { x: entry.x, y: entryBottom.y + 12 };
    const entryColor =
      trade.direction === "long" ? colors.positive : colors.negative;

    if (trade.status === "open") {
      paintTriangle(
        ctx,
        entryMarker,
        trade.direction === "long" ? "up" : "down",
        colors.foreground,
      );
      paintExecutionCard(
        ctx,
        render,
        entryMarker,
        trade.direction === "long" ? "LONG" : "SHORT",
        trade.entry.price,
        entryColor,
        colors,
      );
      continue;
    }

    const exit = pointForFill(render, trade.exit);
    if (!exit) continue;
    const exitIndex = DrawingRenderUtils.indexFromTime(
      render.data,
      trade.exit.time,
    );
    if (exitIndex === null) continue;
    const exitBottom = candleBottomPoint(render, trade.exit, exitIndex);
    if (!exitBottom) continue;
    const exitMarker = { x: exit.x, y: exitBottom.y + 12 };
    const exitColor =
      trade.direction === "long" ? colors.negative : colors.positive;

    paintTriangle(
      ctx,
      entryMarker,
      trade.direction === "long" ? "up" : "down",
      colors.foreground,
    );
    paintTriangle(
      ctx,
      exitMarker,
      trade.direction === "long" ? "down" : "up",
      colors.foreground,
    );
    paintExecutionCard(
      ctx,
      render,
      entryMarker,
      trade.direction === "long" ? "LONG" : "SHORT",
      trade.entry.price,
      entryColor,
      colors,
    );
    paintExecutionCard(
      ctx,
      render,
      exitMarker,
      "EXIT",
      trade.exit.price,
      exitColor,
      colors,
      closedTradeExitSummary(
        trade,
        strategy.initialCapital,
        Math.abs(exitIndex - entryIndex),
      ),
    );
  }

  ctx.restore();
}
