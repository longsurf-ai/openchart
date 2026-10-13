// Purpose: Paint the transient ruler and its price/time-axis range highlights.
import type { Chart } from "@openchart/chart-core/chart/state";
import { Chart as ChartState } from "@openchart/chart-core/chart/state";
import type { Series } from "@openchart/chart-core/series";
import type { CoordSys } from "@openchart/chart-core/coord";
import { Draw } from "@openchart/chart-core/render";
import { Locale } from "@openchart/chart-core/format";
import { TimeAxis } from "@openchart/chart-core/scale";
import { Color } from "@openchart/chart-core/util";
import { measurementStats, measurementDuration } from "../measurement";
import { resolveField } from "../series/fields";
import { yAtRawValue } from "../series/coordinates";

type Bounds = { x: number; y: number; width: number; height: number };

/** Paint a ruler from resolved series geometry without mutating state or retaining canvas resources.
 * Returns the painted range/card hit regions; missing/invalid geometry paints nothing.
 * Caller supplies the owning pane
 * and visible axis bounds; highlights never spill into a different series' axis.
 * @example paintMeasurement({ ctx, state, series, scale, xAt, pane, xAxis, yAxis, font });
 */
export function paintMeasurement(input: {
  ctx: CanvasRenderingContext2D;
  state: Chart.State;
  series: Series.State;
  scale: CoordSys.Scale;
  transform?: { value: (raw: number) => number };
  xAt: (index: number) => number;
  pane: Bounds;
  xAxis?: Bounds;
  yAxis?: Bounds & {
    side: "left" | "right";
    format: (value: number) => string;
  };
  font: string;
}) {
  const { ctx, state, series, scale, transform, pane, xAxis, yAxis, font } =
    input;
  const measurement = state.measurement;
  if (!measurement || measurement.seriesId !== series.id) return;
  const stats = measurementStats(measurement, series);
  if (!stats) return;
  const cagr = measurement.kind === "cagr";
  const x1 = input.xAt(stats.from);
  const x2 = input.xAt(stats.to);
  const y1 = cagr
    ? pane.y
    : yAtRawValue(scale, transform, measurement.start.price);
  const y2 = cagr
    ? pane.y + pane.height
    : yAtRawValue(scale, transform, measurement.end.price);
  if (
    y1 === undefined ||
    y2 === undefined ||
    !Number.isFinite(x1) ||
    !Number.isFinite(x2)
  )
    return;
  const left = Math.max(pane.x, Math.min(x1, x2));
  const right = Math.min(pane.x + pane.width, Math.max(x1, x2));
  const top = Math.max(pane.y, Math.min(y1, y2));
  const bottom = Math.min(pane.y + pane.height, Math.max(y1, y2));
  if (left > right || top > bottom) return;
  const positive =
    (cagr ? (stats.performance?.returnPercent ?? 0) : stats.delta) >= 0;
  const color = Color.resolve(
    positive ? "var(--indicator-blue, #2962ff)" : "var(--down, #f64b60)",
  );
  const textColor = Color.contrast(color);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const arrow = (sx: number, sy: number, ex: number, ey: number) => {
    const angle = Math.atan2(ey - sy, ex - sx);
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    for (const offset of [-Math.PI / 4, Math.PI / 4]) {
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex - 7 * Math.cos(angle + offset),
        ey - 7 * Math.sin(angle + offset),
      );
    }
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(pane.x, pane.y, pane.width, pane.height);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (x1 !== x2) arrow(x1, cy, x2, cy);
  if (!cagr && y1 !== y2) arrow(cx, y1, cx, y2);
  if (cagr) {
    for (const x of [x1, x2]) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
  }
  ctx.stroke();
  if (cagr) {
    for (const x of [x1, x2]) {
      ctx.beginPath();
      ctx.arc(x, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const delta = Locale.price(stats.delta, stats.precision);
  const percent =
    stats.percent === undefined ? "—" : Locale.percent(stats.percent);
  const ticks =
    stats.ticks === undefined
      ? ""
      : ` ${stats.ticks.toLocaleString(Locale.get().locale)}`;
  const performance = stats.performance;
  const rangeSummary = `${stats.bars.toLocaleString(Locale.get().locale)} ${stats.bars === 1 ? "bar" : "bars"}, ${measurementDuration(stats.seconds)}`;
  const lines = cagr
    ? [
        `CAGR ${performance?.cagrPercent === undefined ? "—" : Locale.percent(performance.cagrPercent)}`,
        `Volatility ${performance?.volatilityPercent === undefined ? "—" : Locale.percent(performance.volatilityPercent).replace(/^\+/, "")}`,
        `Return ${performance?.returnPercent === undefined ? "—" : Locale.percent(performance.returnPercent)}`,
        `Sharpe (rf 0%) ${performance?.sharpe === undefined ? "—" : performance.sharpe.toLocaleString(Locale.get().locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        rangeSummary,
      ]
    : [
        `${delta} (${percent})${ticks}`,
        rangeSummary,
        `Vol ${stats.volume === undefined ? "—" : Locale.compact(stats.volume) + (stats.partialVolume ? " (partial)" : "")}`,
      ];
  ctx.font = font;
  const lineHeight = state.config.chart.layout.fontSize + 6;
  const height = lines.length * lineHeight + 14;
  const width = Math.min(
    pane.width - 8,
    Math.max(...lines.map((line) => ctx.measureText(line).width)) + 24,
  );
  const labelX = Math.max(
    pane.x + 4,
    Math.min(
      pane.x + pane.width - width - 4,
      cagr ? right + 10 : (left + right - width) / 2,
    ),
  );
  const preferredY = cagr
    ? cy - height / 2
    : positive
      ? top - height - 10
      : bottom + 10;
  const labelY = Math.max(
    pane.y + 4,
    Math.min(pane.y + pane.height - height - 4, preferredY),
  );
  const hasLabel = width > 0 && pane.height >= height + 8;
  if (hasLabel) {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(labelX, labelY, width, height, 5);
    else ctx.rect(labelX, labelY, width, height);
    ctx.fill();
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((line, index) =>
      ctx.fillText(
        line,
        labelX + width / 2,
        labelY + 7 + lineHeight * (index + 0.5),
        width - 12,
      ),
    );
  }
  ctx.restore();

  // Axis fills and labels paint last so ordinary ticks cannot cover the ruler.
  if (yAxis && !cagr) {
    ctx.save();
    ctx.beginPath();
    const clipX = Math.min(pane.x, yAxis.x);
    ctx.rect(
      clipX,
      yAxis.y,
      Math.max(pane.x + pane.width, yAxis.x + yAxis.width) - clipX,
      yAxis.height,
    );
    ctx.clip();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.2;
    ctx.fillRect(yAxis.x, top, yAxis.width, bottom - top);
    ctx.globalAlpha = 1;
    for (const [y, price] of [
      [y1, measurement.start.price],
      [y2, measurement.end.price],
    ] as const) {
      if (y < pane.y || y > pane.y + pane.height) continue;
      const label = yAxis.format(transform?.value(price) ?? price);
      ctx.font = font;
      const tagWidth = Math.max(yAxis.width, ctx.measureText(label).width + 16);
      const tagBounds = {
        x: yAxis.side === "right" ? yAxis.x + yAxis.width - tagWidth : yAxis.x,
        width: tagWidth,
      };
      Draw.crosshairYTag(
        ctx,
        Math.max(pane.y + 9, Math.min(pane.y + pane.height - 9, y)),
        label,
        tagBounds,
        yAxis.side,
        color,
        textColor,
        font,
      );
    }
    ctx.restore();
  }
  if (xAxis) {
    ctx.save();
    ctx.font = font;
    ctx.beginPath();
    ctx.rect(xAxis.x, xAxis.y, xAxis.width, xAxis.height);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.2;
    ctx.fillRect(left, xAxis.y, right - left, xAxis.height);
    ctx.globalAlpha = 1;
    const timezone = ChartState.resolveTimeDisplayTimezone(state, series.id);
    const timeField = resolveField(series, "x", "time");
    const sample = series.data
      .slice(0, 50)
      .map((row) => (row as Record<string, unknown>)[timeField]);
    const interval = TimeAxis.inferBarInterval(sample, {
      from: 0,
      to: sample.length,
    });
    const unit = TimeAxis.barIntervalToUnit(interval ?? 86400);
    const startLabel = TimeAxis.formatCrosshair(
      measurement.start.time,
      unit,
      timezone,
    );
    const endLabel = TimeAxis.formatCrosshair(
      measurement.end.time,
      unit,
      timezone,
    );
    if (
      Math.abs(x2 - x1) <
      (ctx.measureText(startLabel).width + ctx.measureText(endLabel).width) /
        2 +
        16
    ) {
      Draw.crosshairXTag(
        ctx,
        (left + right) / 2,
        startLabel === endLabel ? startLabel : `${startLabel} — ${endLabel}`,
        xAxis,
        color,
        textColor,
        font,
      );
    } else {
      if (x1 >= pane.x && x1 <= pane.x + pane.width)
        Draw.crosshairXTag(ctx, x1, startLabel, xAxis, color, textColor, font);
      if (x2 >= pane.x && x2 <= pane.x + pane.width)
        Draw.crosshairXTag(ctx, x2, endLabel, xAxis, color, textColor, font);
    }
    ctx.restore();
  }
  return [
    {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    },
    ...(hasLabel ? [{ x: labelX, y: labelY, width, height }] : []),
    ...(cagr
      ? (["start", "end"] as const).flatMap((endpoint, index) => {
          const x = index === 0 ? x1 : x2;
          return x >= pane.x && x <= pane.x + pane.width
            ? [{ x: x - 4, y: top, width: 8, height: bottom - top, endpoint }]
            : [];
        })
      : []),
  ];
}
