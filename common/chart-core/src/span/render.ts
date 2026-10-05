// Purpose: Canvas rendering and time projection for transient Chart Explain Span bands.
// Module:  @openchart/chart-core / span

import { Color } from "@openchart/chart-core/util";
import { Data } from "@openchart/chart-core/data/schema";
import { ChartAnnotation } from "@openchart/chart-core/annotation/types";
import type { RenderContext } from "@openchart/chart-core/drawing";

export type Rect = { x: number; y: number; width: number; height: number };

export type SpanBandRenderInput = {
  ctx: CanvasRenderingContext2D;
  render: RenderContext;
  draftBand?: {
    xStart: number;
    xEnd: number;
    tStart?: number;
    tEnd?: number;
    color: string;
    translucent: true;
    mode?: "dragging" | "annotating";
    startedAtMs?: number;
    progressLog?: ProgressLogLine[];
  };
  progressBands?: Array<{
    xStart: number;
    xEnd: number;
    tStart: number;
    tEnd: number;
    color: string;
    translucent: true;
    mode: "annotating";
    startedAtMs: number;
    progressLog?: ProgressLogLine[];
  }>;
};

export type ProgressLogLine = { text: string; atMs: number };

type Point = { x: number; y: number };

const ICON_SIZE = 18;
const LANE_BOTTOM_INSET = 8;
const DRAFT_BAND_COLOR = "var(--glow-reveal, 198 94% 66%)";
const CHART_BG_COLOR = "var(--chart-bg, #ffffff)";

// Terminal-style progress log inside annotating bands.
const PROGRESS_LOG_INSET = 10;
const PROGRESS_LOG_LINE_HEIGHT_FACTOR = 1.5;
const PROGRESS_LOG_MAX_LINES = 6;
const PROGRESS_LOG_FADE_IN_MS = 240;
const PROGRESS_LOG_FONT_SIZE = ChartAnnotation.DEFAULT_FONT_SIZE;
const PROGRESS_LOG_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, monospace";
const PROGRESS_LOG_OLDEST_ALPHA = 0.35;
const PROGRESS_LOG_LATEST_FLASH_PERIOD_MS = 1_900;
const PROGRESS_LOG_LATEST_FLASH_SPREAD_PX = 30;
const PROGRESS_LOG_LATEST_FLASH_BASE_ALPHA = 0.58;
const PROGRESS_LOG_LATEST_FLASH_HIGHLIGHT_ALPHA = 0.96;
const PROGRESS_LOG_LATEST_FLASH_START_RATIO = -0.22;
const PROGRESS_LOG_LATEST_FLASH_END_RATIO = 1.22;
const SCAN_TEXT_SATURATION_BOOST = 24;
const SCAN_TEXT_MIN_LIGHTNESS_ON_DARK_BG = 68;
const SCAN_TEXT_MAX_LIGHTNESS_ON_LIGHT_BG = 42;
const DARK_BG_LUMINANCE_THRESHOLD = 0.5;

function pointAt(render: RenderContext, index: number): Point | null {
  const row = render.data[index] as { time?: unknown } | undefined;
  const currentTime = Data.readTime(row?.time);
  if (currentTime === undefined) return null;
  return {
    x: render.xPositions[index] ?? render.xFn(index),
    y: currentTime,
  };
}

function projectTimeToXLinear(
  render: RenderContext,
  target: number,
): number | null {
  let previous: Point | null = null;
  let first: Point | null = null;
  for (let i = 0; i < render.data.length; i++) {
    const current = pointAt(render, i);
    if (!current) continue;
    first ??= current;
    if (current.y === target) return current.x;
    if (!previous && target < current.y) return null;
    if (previous && previous.y <= target && target <= current.y) {
      const span = current.y - previous.y;
      if (span <= 0) return current.x;
      const t = (target - previous.y) / span;
      return previous.x + (current.x - previous.x) * t;
    }
    previous = current;
  }

  if (!first || !previous) return null;
  return target <= previous.y ? previous.x : null;
}

export function projectTimeToX(
  render: RenderContext,
  time: number,
): number | null {
  const target = Data.readTime(time);
  if (target === undefined) return null;

  const lastIndex = render.data.length - 1;
  if (lastIndex < 0) return null;

  const first = pointAt(render, 0);
  const last = pointAt(render, lastIndex);
  if (!first || !last || first.y > last.y) {
    return projectTimeToXLinear(render, target);
  }
  if (target < first.y || target > last.y) return null;

  let low = 0;
  let high = lastIndex;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midPoint = pointAt(render, mid);
    if (!midPoint) return projectTimeToXLinear(render, target);
    if (midPoint.y < target) low = mid + 1;
    else high = mid;
  }

  const current = pointAt(render, low);
  if (!current) return projectTimeToXLinear(render, target);
  if (current.y === target) return current.x;
  if (low === 0) return null;

  const previous = pointAt(render, low - 1);
  if (!previous || previous.y > current.y) {
    return projectTimeToXLinear(render, target);
  }
  if (previous.y <= target && target <= current.y) {
    const span = current.y - previous.y;
    if (span <= 0) return current.x;
    const t = (target - previous.y) / span;
    return previous.x + (current.x - previous.x) * t;
  }

  return null;
}

function timeDomain(
  render: RenderContext,
): { first: Point; last: Point } | null {
  let first: Point | null = null;
  let last: Point | null = null;
  for (let i = 0; i < render.data.length; i++) {
    const row = render.data[i] as { time?: unknown } | undefined;
    const currentTime = Data.readTime(row?.time);
    if (currentTime === undefined) continue;
    const point = { x: render.xPositions[i] ?? render.xFn(i), y: currentTime };
    first ??= point;
    last = point;
  }
  return first && last ? { first, last } : null;
}

function projectTimeToClampedX(
  render: RenderContext,
  time: number,
): number | null {
  const target = Data.readTime(time);
  const domain = timeDomain(render);
  if (target === undefined || !domain) return null;
  if (target <= domain.first.y) return domain.first.x;
  if (target >= domain.last.y) return domain.last.x;
  return projectTimeToX(render, time);
}

type RenderBand = NonNullable<SpanBandRenderInput["draftBand"]>;

function draftBandRect(
  input: Pick<SpanBandRenderInput, "render">,
  draft: RenderBand | undefined,
): Rect | null {
  if (!draft) return null;

  // Time-anchored bands resolve through the data timeline regardless of mode;
  // the pixel path below only serves pointer-driven drags that never learned
  // their timestamps.
  if (draft.tStart !== undefined && draft.tEnd !== undefined) {
    const start = Data.readTime(draft.tStart);
    const end = Data.readTime(draft.tEnd);
    const domain = timeDomain(input.render);
    if (start === undefined || end === undefined || !domain) return null;
    if (
      Math.max(start, end) < domain.first.y ||
      Math.min(start, end) > domain.last.y
    ) {
      return null;
    }
    const xStart = projectTimeToClampedX(input.render, draft.tStart);
    const xEnd = projectTimeToClampedX(input.render, draft.tEnd);
    if (xStart === null || xEnd === null) return null;
    const left = Math.max(input.render.area.x, Math.min(xStart, xEnd));
    const right = Math.min(
      input.render.area.x + input.render.area.width,
      Math.max(xStart, xEnd),
    );
    return right > left
      ? {
          x: left,
          y: input.render.area.y,
          width: right - left,
          height: input.render.area.height,
        }
      : null;
  }

  const left = Math.max(
    input.render.area.x,
    Math.min(draft.xStart, draft.xEnd),
  );
  const right = Math.min(
    input.render.area.x + input.render.area.width,
    Math.max(draft.xStart, draft.xEnd),
  );
  return right > left
    ? {
        x: left,
        y: input.render.area.y,
        width: right - left,
        height: input.render.area.height,
      }
    : null;
}

function resolveDraftBandColor(draft: RenderBand): string {
  if (draft.color !== "accent") return Color.resolve(draft.color);
  return Color.resolve(DRAFT_BAND_COLOR);
}

function easeInOut(t: number): number {
  return 0.5 - Math.cos(Math.PI * t) / 2;
}

function renderAnnotatingBand(
  input: SpanBandRenderInput,
  rect: Rect,
  draft: RenderBand,
): void {
  const ctx = input.ctx;
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = Math.max(0, now - (draft.startedAtMs ?? now));
  const sweepMs = 2400;
  const restMs = 980;
  const cycle = elapsed % (sweepMs + restMs);
  const isSweeping = cycle < sweepMs;
  const sweepT = Math.min(1, cycle / sweepMs);
  const eased = easeInOut(sweepT);
  const restT = isSweeping ? 0 : (cycle - sweepMs) / restMs;
  const breathe = isSweeping ? 0 : 0.5 - Math.cos(restT * Math.PI * 2) / 2;
  const lineAlpha = isSweeping ? Math.sin(Math.PI * sweepT) : 0;
  const scanX = rect.x + rect.width * eased;
  const trailWidth = Math.min(76, Math.max(34, rect.width * 0.16));
  const color = resolveDraftBandColor(draft);

  ctx.save();

  if (!isSweeping) {
    ctx.fillStyle = Color.withAlpha(color, 0.018 + breathe * 0.036);
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  if (lineAlpha > 0) {
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    const trail = ctx.createLinearGradient(scanX - trailWidth, 0, scanX, 0);
    trail.addColorStop(0, Color.withAlpha(color, 0));
    trail.addColorStop(0.72, Color.withAlpha(color, 0.06 * lineAlpha));
    trail.addColorStop(1, Color.withAlpha(color, 0.16 * lineAlpha));
    ctx.fillStyle = trail;
    ctx.fillRect(scanX - trailWidth, rect.y, trailWidth, rect.height);

    ctx.shadowColor = Color.withAlpha(color, 0.38 * lineAlpha);
    ctx.shadowBlur = 9;
    ctx.strokeStyle = Color.withAlpha(color, 0.9 * lineAlpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(scanX, rect.y);
    ctx.lineTo(scanX, rect.y + rect.height);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Strengthen a scanning-band color into a solid, higher-contrast text color of
 * the same hue: saturation is boosted (clamped to 100) and lightness is pushed
 * toward contrast against the chart background — floored on dark backgrounds,
 * capped on light ones. Accepts raw HSL triples ('174 86% 62%'), css colors,
 * and var() expressions.
 */
export function strengthenScanColor(
  color: string,
  chartBg: string = CHART_BG_COLOR,
): string {
  const { r, g, b } = Color.toRGB(color);
  const { h, s, l } = Color.rgbToHsl(r, g, b);
  const saturation = Math.min(100, s + SCAN_TEXT_SATURATION_BOOST);
  const bgIsDark = Color.luminance(chartBg) < DARK_BG_LUMINANCE_THRESHOLD;
  const lightness = bgIsDark
    ? Math.max(l, SCAN_TEXT_MIN_LIGHTNESS_ON_DARK_BG)
    : Math.min(l, SCAN_TEXT_MAX_LIGHTNESS_ON_LIGHT_BG);
  return `hsl(${Math.round(h)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

/**
 * Cap a progress log to the newest lines and assign per-line alpha: oldest
 * visible line at the base alpha ramping linearly to 1 for the newest, which
 * additionally fades in over the fade-in window from its `atMs` timestamp.
 */
export function layoutProgressLogLines(
  log: ProgressLogLine[],
  nowMs: number,
): Array<ProgressLogLine & { alpha: number }> {
  const visible = log.slice(-PROGRESS_LOG_MAX_LINES);
  const lastIndex = visible.length - 1;
  return visible.map((line, index) => {
    const ramp =
      lastIndex <= 0
        ? 1
        : PROGRESS_LOG_OLDEST_ALPHA +
          ((1 - PROGRESS_LOG_OLDEST_ALPHA) * index) / lastIndex;
    const fadeIn =
      index === lastIndex
        ? Math.min(
            1,
            Math.max(0, (nowMs - line.atMs) / PROGRESS_LOG_FADE_IN_MS),
          )
        : 1;
    return { ...line, alpha: ramp * fadeIn };
  });
}

/** Turn streamed Markdown progress into plain, width-bounded canvas lines. */
export function progressLogDisplayLines(
  log: ProgressLogLine[],
  maxWidth: number,
  measure: (text: string) => number,
): ProgressLogLine[] {
  const lines: ProgressLogLine[] = [];
  if (maxWidth <= 0) return lines;
  for (const entry of log) {
    // Adjacent bold spans can arrive without whitespace during streaming.
    const plain = entry.text.replaceAll("****", "\n").replaceAll("**", "");
    for (const segment of plain.split(/\r?\n/)) {
      let remaining = segment.trim();
      while (remaining) {
        if (measure(remaining) <= maxWidth) {
          lines.push({ text: remaining, atMs: entry.atMs });
          break;
        }
        let low = 1;
        let high = remaining.length;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          if (measure(remaining.slice(0, mid)) <= maxWidth) low = mid;
          else high = mid - 1;
        }
        const space = remaining.lastIndexOf(" ", low);
        const end = space > 0 ? space : low;
        lines.push({ text: remaining.slice(0, end), atMs: entry.atMs });
        remaining = remaining.slice(end).trimStart();
      }
    }
  }
  return lines;
}

export function latestProgressLogFlash(nowMs: number): {
  centerRatio: number;
  spreadPx: number;
  baseAlpha: number;
  highlightAlpha: number;
} {
  const cycle =
    ((nowMs % PROGRESS_LOG_LATEST_FLASH_PERIOD_MS) +
      PROGRESS_LOG_LATEST_FLASH_PERIOD_MS) %
    PROGRESS_LOG_LATEST_FLASH_PERIOD_MS;
  const progress = cycle / PROGRESS_LOG_LATEST_FLASH_PERIOD_MS;
  return {
    centerRatio:
      PROGRESS_LOG_LATEST_FLASH_START_RATIO +
      (PROGRESS_LOG_LATEST_FLASH_END_RATIO -
        PROGRESS_LOG_LATEST_FLASH_START_RATIO) *
        progress,
    spreadPx: PROGRESS_LOG_LATEST_FLASH_SPREAD_PX,
    baseAlpha: PROGRESS_LOG_LATEST_FLASH_BASE_ALPHA,
    highlightAlpha: PROGRESS_LOG_LATEST_FLASH_HIGHLIGHT_ALPHA,
  };
}

function renderLatestProgressLogLine(input: {
  ctx: CanvasRenderingContext2D;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  color: string;
  alpha: number;
  nowMs: number;
}): void {
  const { ctx, text, x, y, color, alpha } = input;
  const width = ctx.measureText(text).width;

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.fillStyle = Color.withAlpha(
    color,
    alpha * PROGRESS_LOG_LATEST_FLASH_BASE_ALPHA,
  );
  ctx.fillText(text, x, y, input.maxWidth);

  if (width <= 0) return;

  const flash = latestProgressLogFlash(input.nowMs);
  const centerX = x + width * flash.centerRatio;
  const gradient = ctx.createLinearGradient(
    centerX - flash.spreadPx,
    0,
    centerX + flash.spreadPx,
    0,
  );
  gradient.addColorStop(0, Color.withAlpha(color, 0));
  gradient.addColorStop(
    0.5,
    Color.withAlpha(color, alpha * flash.highlightAlpha),
  );
  gradient.addColorStop(1, Color.withAlpha(color, 0));

  ctx.fillStyle = gradient;
  ctx.fillText(text, x, y, input.maxWidth);
}

function renderProgressLog(
  input: SpanBandRenderInput,
  rect: Rect,
  band: RenderBand,
): void {
  const log = band.progressLog;
  if (!log || log.length === 0) return;
  const maxWidth = rect.width - PROGRESS_LOG_INSET * 2;
  if (maxWidth <= 0) return;

  const ctx = input.ctx;
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  ctx.save();
  ctx.font = `${PROGRESS_LOG_FONT_SIZE}px ${PROGRESS_LOG_FONT_FAMILY}`;
  const lines = layoutProgressLogLines(
    progressLogDisplayLines(
      log,
      maxWidth,
      (value) => ctx.measureText(value).width,
    ),
    now,
  );
  const color = strengthenScanColor(
    resolveDraftBandColor(band),
    input.render.backgroundColor,
  );
  const lineHeight = PROGRESS_LOG_FONT_SIZE * PROGRESS_LOG_LINE_HEIGHT_FACTOR;

  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  // Leave the chart's primary legend visible above the streamed progress.
  let y = rect.y + PROGRESS_LOG_INSET + 24;
  const lastIndex = lines.length - 1;
  for (const [index, line] of lines.entries()) {
    const latest = index === lastIndex;
    const text = line.text;
    const x = rect.x + PROGRESS_LOG_INSET;
    if (latest) {
      renderLatestProgressLogLine({
        ctx,
        text,
        x,
        y,
        maxWidth,
        color,
        alpha: line.alpha,
        nowMs: now,
      });
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.fillStyle = Color.withAlpha(color, line.alpha);
      ctx.fillText(text, x, y, maxWidth);
    }
    y += lineHeight;
  }
  ctx.restore();
}

function eventLaneArea(render: RenderContext): Rect {
  const height = ICON_SIZE;
  const y = Math.max(
    render.area.y + 4,
    render.area.y + render.area.height - LANE_BOTTOM_INSET - height,
  );
  return {
    x: render.area.x,
    y,
    width: render.area.width,
    height: Math.min(height, Math.max(ICON_SIZE, render.area.height - 8)),
  };
}

function renderOutsideBands(input: SpanBandRenderInput, rects: Rect[]): void {
  if (rects.length === 0) return;
  const {
    ctx,
    render: { area },
  } = input;
  ctx.save();
  ctx.fillStyle = Color.withAlpha(
    input.render.backgroundColor ?? CHART_BG_COLOR,
    0.62,
  );
  let left = area.x;
  for (const rect of rects.sort((a, b) => a.x - b.x)) {
    if (rect.x > left) ctx.fillRect(left, area.y, rect.x - left, area.height);
    left = Math.max(left, rect.x + rect.width);
  }
  const right = area.x + area.width;
  if (left < right) ctx.fillRect(left, area.y, right - left, area.height);
  ctx.restore();
}

/** Paint scanner bands with one shared outside wash, then their progress logs.
 * Geometry is derived from the current timeline; no render state is retained.
 * @example renderSpanBands({ ctx, render, progressBands });
 */
export function renderSpanBands(input: SpanBandRenderInput): void {
  const bands = (input.progressBands ?? []).flatMap((band) => {
    const rect = draftBandRect(input, band);
    return rect ? [{ band, rect }] : [];
  });
  const draftRect = draftBandRect(input, input.draftBand);
  if (bands.length || input.draftBand?.mode === "annotating") {
    renderOutsideBands(input, [
      ...bands.map(({ rect }) => rect),
      ...(draftRect ? [draftRect] : []),
    ]);
  }
  for (const { band, rect } of bands) renderAnnotatingBand(input, rect, band);

  if (input.draftBand) {
    const rect = draftRect;
    if (rect) {
      if (input.draftBand.mode === "annotating") {
        renderAnnotatingBand(input, rect, input.draftBand);
      } else {
        const color = resolveDraftBandColor(input.draftBand);
        input.ctx.save();
        input.ctx.fillStyle = Color.withAlpha(
          color,
          input.draftBand.translucent ? 0.18 : 0.28,
        );
        input.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        // Dashed edge guides so the selection bounds read while dragging.
        input.ctx.setLineDash([4, 4]);
        input.ctx.strokeStyle = Color.withAlpha(color, 0.85);
        input.ctx.lineWidth = 1;
        input.ctx.beginPath();
        input.ctx.moveTo(rect.x + 0.5, rect.y);
        input.ctx.lineTo(rect.x + 0.5, rect.y + rect.height);
        input.ctx.moveTo(rect.x + rect.width - 0.5, rect.y);
        input.ctx.lineTo(rect.x + rect.width - 0.5, rect.y + rect.height);
        input.ctx.stroke();
        input.ctx.restore();
      }
    }
  }

  for (const { band, rect } of bands) renderProgressLog(input, rect, band);
}

export const SpanRenderUtils = {
  projectTimeToX,
  projectTimeToClampedX,
  eventLaneArea,
  strengthenScanColor,
  layoutProgressLogLines,
  progressLogDisplayLines,
  progressLogMaxLines: PROGRESS_LOG_MAX_LINES,
  progressLogOldestAlpha: PROGRESS_LOG_OLDEST_ALPHA,
  progressLogFadeInMs: PROGRESS_LOG_FADE_IN_MS,
  progressLogLatestFlashPeriodMs: PROGRESS_LOG_LATEST_FLASH_PERIOD_MS,
  latestProgressLogFlash,
};
