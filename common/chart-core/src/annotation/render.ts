// Purpose: Canvas painting for runtime-laid-out chart annotation callout pills
// Module:  @openchart/chart-core / annotation

import { Schema } from "effect";
import { TextCache } from "@openchart/chart-core/cache";
import { type RenderContext } from "@openchart/chart-core/drawing";
import { type Rect } from "@openchart/chart-core/span";
import { Color } from "@openchart/chart-core/util";
import {
  resolveAgentAnnotationStyle,
  sourceBadgePlateColor,
  sourceBadgeText,
} from "./appearance";
import {
  layoutChartAnnotations,
  type AnnotationPlacement,
  type AnnotationPoint,
  type ChartAnnotationLayoutInput,
  type ChartAnnotationOccupancySnapshot,
} from "./layout";
import { ChartAnnotation } from "./types";

export type ChartAnnotationRenderInput = {
  ctx: CanvasRenderingContext2D;
  textCache: ReturnType<typeof TextCache.create>;
  render: RenderContext;
  stripArea: Rect;
  annotations: ChartAnnotation.Renderable[];
  placements?: readonly AnnotationPlacement[];
  hoveredAnnotationId?: string | null;
  hoveredAnnotationPart?:
    "body" | "target_handle" | "label_handle" | "expand_button" | null;
  expandedAnnotation?: ChartAnnotation.Expansion;
  activeAnnotationId?: string | null;
  hiddenBodyAnnotationIds?: ReadonlySet<string>;
  hiddenTextAnnotationIds?: ReadonlySet<string>;
} & Pick<
  ChartAnnotationLayoutInput,
  | "expandedCardsByAnnotationId"
  | "layoutState"
  | "layoutStateWritable"
  | "onOccupancySnapshot"
  | "agentAnnotationIds"
  | "sourceBadgesByAnnotationId"
>;

const DEFAULT_FILL = ChartAnnotation.DEFAULT_FILL_COLOR;
const DEFAULT_TEXT = ChartAnnotation.DEFAULT_TEXT_COLOR;
const DEBUG_MAP_BACKGROUND = "#070a10";
const DEBUG_CHART_INK = "#f97316";
const DEBUG_ANNOTATION_INK = "#22d3ee";
type BadgeImageState =
  | {
      status: "loading";
      image: HTMLImageElement;
      listeners: Set<() => void>;
    }
  | { status: "loaded"; image: HTMLImageElement }
  | { status: "failed" };

const badgeImageCache = new Map<string, BadgeImageState>();
const tintedBadgeImageCache = new Map<string, HTMLCanvasElement>();
const ANNOTATION_LABEL_MARQUEE_PIXELS_PER_SECOND = 36;
const ANNOTATION_LABEL_MARQUEE_GAP = 16;

export function annotationLabelMarqueeOffset(input: {
  elapsedMs: number;
  loopWidth: number;
}): number {
  if (input.loopWidth <= 0) return 0;
  const travelled =
    (Math.max(0, input.elapsedMs) / 1000) *
    ANNOTATION_LABEL_MARQUEE_PIXELS_PER_SECOND;
  return -(travelled % input.loopWidth);
}

export function resolveAnnotationSentimentColor(
  annotation: ChartAnnotation.Renderable,
): string {
  if (annotation.sentiment > 0.15) return "#c9efcf";
  if (annotation.sentiment < -0.15) return "#ffc5cc";
  return "#2b2118";
}

function isAgentPlacement(
  input: Pick<
    ChartAnnotationRenderInput,
    "agentAnnotationIds" | "expandedCardsByAnnotationId"
  >,
  placement: AnnotationPlacement,
): boolean {
  return Boolean(
    placement.annotation.content ??
    input.agentAnnotationIds?.[placement.annotation.id] ??
    input.agentAnnotationIds?.[
      placement.annotation.eventId ?? placement.annotation.id
    ] ??
    input.expandedCardsByAnnotationId?.[placement.annotation.id] ??
    input.expandedCardsByAnnotationId?.[
      placement.annotation.eventId ?? placement.annotation.id
    ] ??
    placement.appearance.sourceBadges.length,
  );
}

function styleForPlacement(
  placement: AnnotationPlacement,
  agentBacked: boolean,
): ChartAnnotation.Style {
  if (agentBacked) return resolveAgentAnnotationStyle(placement.annotation);
  return (
    placement.annotation.style ??
    Schema.decodeUnknownSync(ChartAnnotation.Style)({})
  );
}

function setLineDash(ctx: CanvasRenderingContext2D, style: string): void {
  if (style === "dashed") {
    ctx.setLineDash([6, 5]);
    return;
  }
  if (style === "dotted") {
    ctx.setLineDash([1.5, 4]);
    return;
  }
  ctx.setLineDash([]);
}

function paintLeader(
  ctx: CanvasRenderingContext2D,
  placement: AnnotationPlacement,
  style: ChartAnnotation.Style,
  agentBacked: boolean,
): void {
  if (placement.state === "collapsed") return;
  const lineStart = leaderPointAfterTargetGap(placement);
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = Color.withAlpha(style.lineColor, 0.72);
  ctx.lineWidth = style.lineWidth;
  ctx.lineCap = "round";
  setLineDash(ctx, style.lineStyle);
  ctx.beginPath();
  ctx.moveTo(lineStart.x, lineStart.y);
  const lineEnd = leaderPointUnderPill(placement);
  ctx.lineTo(lineEnd.x, lineEnd.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = Color.withAlpha(style.lineColor, 0.96);
  if (agentBacked) {
    const size = (placement.appearance.targetDotRadius + 1) * 1.45;
    ctx.save();
    ctx.translate(placement.leader.to.x, placement.leader.to.y);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.roundRect(-size / 2, -size / 2, size, size, 1.8);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(
      placement.leader.to.x,
      placement.leader.to.y,
      placement.appearance.targetDotRadius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function leaderPointUnderPill(placement: AnnotationPlacement): {
  x: number;
  y: number;
} {
  const center = {
    x: placement.pill.x + placement.pill.width / 2,
    y: placement.pill.y + placement.pill.height / 2,
  };
  const dx = center.x - placement.leader.from.x;
  const dy = center.y - placement.leader.from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return placement.leader.from;
  const inset = Math.min(9, placement.appearance.radius * 0.45, length);
  return {
    x: placement.leader.from.x + (dx / length) * inset,
    y: placement.leader.from.y + (dy / length) * inset,
  };
}

function leaderPointAfterTargetGap(placement: AnnotationPlacement): {
  x: number;
  y: number;
} {
  const dx = placement.leader.from.x - placement.leader.to.x;
  const dy = placement.leader.from.y - placement.leader.to.y;
  const length = Math.hypot(dx, dy);
  if (length <= placement.appearance.leaderTargetGap) {
    return placement.leader.to;
  }
  return {
    x:
      placement.leader.to.x +
      (dx / length) * placement.appearance.leaderTargetGap,
    y:
      placement.leader.to.y +
      (dy / length) * placement.appearance.leaderTargetGap,
  };
}

function paintSourceBadges(
  ctx: CanvasRenderingContext2D,
  placement: AnnotationPlacement,
  style: ChartAnnotation.Style,
): void {
  const badges = placement.appearance.sourceBadges;
  if (badges.length === 0) return;
  const size = 22;
  const step = 16;
  const y = placement.pill.y + placement.pill.height / 2;
  let x = placement.pill.x + 5 + size / 2;
  ctx.save();
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const badge of badges) {
    const image = badge.logoUrl ? sourceBadgeImage(badge.logoUrl) : null;
    const plateColor = sourceBadgePlateColor({
      badge,
      hasLoadedLogo: image !== null,
    });
    if (plateColor) {
      ctx.fillStyle = plateColor;
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (image) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, size / 2 - 1, 0, Math.PI * 2);
      ctx.clip();
      paintSourceBadgeImage(ctx, image, badge.textColor, x, y, size);
      ctx.restore();
    }
    ctx.strokeStyle = Color.withAlpha(style.fillColor ?? DEFAULT_FILL, 0.96);
    ctx.lineWidth = 1.25;
    ctx.stroke();
    if (!image && badge.showTextFallback !== false) {
      ctx.fillStyle = badge.textColor ?? "#ffffff";
      ctx.fillText(sourceBadgeText(badge), x, y + 0.5);
    }
    x += step;
  }
  ctx.restore();
}

function paintSourceBadgeImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  tintColor: string | undefined,
  x: number,
  y: number,
  size: number,
): void {
  const left = x - size / 2;
  const top = y - size / 2;
  const color = tintColor?.trim();
  if (!color || typeof document === "undefined") {
    ctx.drawImage(image, left, top, size, size);
    return;
  }

  const cacheKey = `${image.currentSrc || image.src}|${color}|${size}`;
  let tinted = tintedBadgeImageCache.get(cacheKey);
  if (!tinted) {
    tinted = document.createElement("canvas");
    tinted.width = size;
    tinted.height = size;
    const tintCtx = tinted.getContext("2d");
    if (!tintCtx) {
      ctx.drawImage(image, left, top, size, size);
      return;
    }
    tintCtx.drawImage(image, 0, 0, size, size);
    tintCtx.globalCompositeOperation = "source-in";
    tintCtx.fillStyle = color;
    tintCtx.fillRect(0, 0, size, size);
    tintedBadgeImageCache.set(cacheKey, tinted);
  }
  ctx.drawImage(tinted, left, top, size, size);
}

function sourceBadgeImageStatus(url: string): BadgeImageState["status"] {
  if (typeof Image === "undefined") return "failed";
  return badgeImageCache.get(url)?.status ?? "loading";
}

function sourceBadgeImageReady(url: string): boolean {
  const status = sourceBadgeImageStatus(url);
  return status === "loaded" || status === "failed";
}

function notifySourceBadgeImageListeners(
  listeners: Set<() => void> | undefined,
): void {
  if (!listeners) return;
  for (const listener of listeners) listener();
}

function ensureSourceBadgeImage(
  url: string,
  onStatusChange?: () => void,
): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  const cached = badgeImageCache.get(url);
  if (cached?.status === "loaded") return cached.image;
  if (cached?.status === "loading") {
    if (onStatusChange) cached.listeners.add(onStatusChange);
    return null;
  }
  if (cached) return null;

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  const listeners = new Set<() => void>();
  if (onStatusChange) listeners.add(onStatusChange);
  image.onload = () => {
    badgeImageCache.set(url, { status: "loaded", image });
    notifySourceBadgeImageListeners(listeners);
  };
  image.onerror = () => {
    badgeImageCache.set(url, { status: "failed" });
    notifySourceBadgeImageListeners(listeners);
  };
  badgeImageCache.set(url, { status: "loading", image, listeners });
  image.src = url;
  if (image.complete && image.naturalWidth > 0) {
    badgeImageCache.set(url, { status: "loaded", image });
    return image;
  }
  return null;
}

function sourceBadgeImage(url: string): HTMLImageElement | null {
  return ensureSourceBadgeImage(url);
}

export function preloadAnnotationSourceBadgeImages(
  badges: readonly { logoUrl?: string }[],
  onStatusChange?: () => void,
): void {
  for (const badge of badges) {
    if (badge.logoUrl) ensureSourceBadgeImage(badge.logoUrl, onStatusChange);
  }
}

export function annotationSourceBadgeImagesReady(
  badges: readonly { logoUrl?: string }[],
): boolean {
  return badges.every((badge) =>
    badge.logoUrl ? sourceBadgeImageReady(badge.logoUrl) : true,
  );
}

function paintExpandAffordance(
  ctx: CanvasRenderingContext2D,
  placement: AnnotationPlacement,
  style: ChartAnnotation.Style,
  hovered: boolean,
): void {
  const rect = placement.actionButton;
  const motion = placement.pillMotion;
  const progress =
    placement.state === "hover" ? (motion?.progress ?? 1) : motion?.progress;
  if (!rect || !progress || progress <= 0.01) return;
  const x = rect.x + rect.width / 2 - 9;
  const y = rect.y + rect.height / 2 - 9;
  const toCanvasPoint = (point: { x: number; y: number }): AnnotationPoint => ({
    x: x + point.x,
    y: y + point.y,
  });
  ctx.save();
  ctx.globalAlpha = style.opacity * progress;
  ctx.strokeStyle = Color.withAlpha(
    style.textColor || DEFAULT_TEXT,
    hovered ? 0.98 : 0.64,
  );
  ctx.lineWidth = 1.1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const p0 = toCanvasPoint({ x: 14.5, y: 9 });
  const p1 = toCanvasPoint({ x: 14.5, y: 6.4 });
  const p2 = toCanvasPoint({ x: 11.6, y: 3.5 });
  const p3 = toCanvasPoint({ x: 9, y: 3.5 });
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.quadraticCurveTo(x + 14.5, y + 3.5, p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  const p4 = toCanvasPoint({ x: 3.5, y: 9 });
  const p5 = toCanvasPoint({ x: 3.5, y: 11.6 });
  const p6 = toCanvasPoint({ x: 6.4, y: 14.5 });
  const p7 = toCanvasPoint({ x: 9, y: 14.5 });
  ctx.moveTo(p4.x, p4.y);
  ctx.lineTo(p5.x, p5.y);
  ctx.quadraticCurveTo(x + 3.5, y + 14.5, p6.x, p6.y);
  ctx.lineTo(p7.x, p7.y);
  ctx.stroke();
  ctx.restore();
}

function paintPill(
  ctx: CanvasRenderingContext2D,
  placement: AnnotationPlacement,
  style: ChartAnnotation.Style,
  hideText: boolean,
  expandAffordanceHovered: boolean,
): void {
  if (placement.state === "expanded" && placement.expandedContent) {
    return;
  }
  ctx.save();
  const pillRadius = placement.appearance.radius;
  const fill = style.fillColor ?? DEFAULT_FILL;
  const text = style.textColor || DEFAULT_TEXT;
  if (placement.state === "collapsed") {
    ctx.fillStyle = Color.withAlpha(fill, style.opacity * 0.86);
    ctx.beginPath();
    ctx.roundRect(
      placement.pill.x,
      placement.pill.y,
      placement.pill.width,
      placement.pill.height,
      pillRadius,
    );
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.shadowColor = Color.withAlpha("#000000", 0.16);
  ctx.shadowBlur = placement.state === "expanded" ? 10 : 6;
  ctx.shadowOffsetY = placement.state === "expanded" ? 3 : 2;
  ctx.beginPath();
  ctx.roundRect(
    placement.pill.x,
    placement.pill.y,
    placement.pill.width,
    placement.pill.height,
    pillRadius,
  );
  ctx.globalAlpha = style.opacity;
  ctx.fillStyle = Color.withAlpha(fill, 0.94);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = Color.withAlpha(style.lineColor, 0.58);
  ctx.lineWidth = Math.max(1, style.lineWidth);
  setLineDash(ctx, style.lineStyle);
  ctx.stroke();
  ctx.setLineDash([]);

  paintSourceBadges(ctx, placement, style);

  if (hideText) {
    ctx.restore();
    return;
  }

  const textX =
    placement.pill.x +
    placement.appearance.paddingX +
    placement.appearance.sourceSlotWidth;
  const textRight =
    placement.actionButton?.x ??
    placement.pill.x + placement.pill.width - placement.appearance.paddingX;
  const textWidth = Math.max(
    0,
    textRight - textX - placement.appearance.textEndGap,
  );
  ctx.save();
  ctx.beginPath();
  ctx.rect(textX, placement.pill.y, textWidth, placement.pill.height);
  ctx.clip();
  ctx.globalAlpha = style.opacity;
  ctx.fillStyle = Color.resolve(text);
  ctx.font = `${style.fontSize}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const textY = placement.pill.y + placement.pill.height / 2;
  const marqueeElapsedMs = placement.pillMotion?.marqueeElapsedMs;
  if (
    placement.state === "hover" &&
    placement.fullText !== placement.text &&
    marqueeElapsedMs !== undefined
  ) {
    const loopWidth =
      ctx.measureText(placement.fullText).width + ANNOTATION_LABEL_MARQUEE_GAP;
    const offset = annotationLabelMarqueeOffset({
      elapsedMs: marqueeElapsedMs,
      loopWidth,
    });
    ctx.fillText(placement.fullText, textX + offset, textY);
    ctx.fillText(placement.fullText, textX + offset + loopWidth, textY);
  } else {
    ctx.fillText(placement.text, textX, textY);
  }
  ctx.restore();
  paintExpandAffordance(ctx, placement, style, expandAffordanceHovered);
  ctx.restore();
}

function paintHandle(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  style: ChartAnnotation.Style,
): void {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = Color.resolve(style.lineColor);
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(point.x, point.y, style.lineWidth > 2 ? 5.5 : 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function renderChartAnnotations(
  input: ChartAnnotationRenderInput,
): AnnotationPlacement[] {
  const placements = input.placements ?? layoutChartAnnotations(input);
  paintChartAnnotationPlacements(input, placements);
  return [...placements];
}

export function paintChartAnnotationPlacements(
  input: Omit<ChartAnnotationRenderInput, "placements">,
  placements: readonly AnnotationPlacement[],
): void {
  if (placements.length === 0) return;

  input.ctx.save();
  input.ctx.beginPath();
  input.ctx.rect(
    input.render.area.x,
    input.render.area.y,
    input.render.area.width,
    input.render.area.height,
  );
  input.ctx.clip();

  const ordered = [...placements]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((placement) => {
      const agentBacked = isAgentPlacement(input, placement);
      return {
        placement,
        agentBacked,
        style: styleForPlacement(placement, agentBacked),
      };
    });
  for (const { placement, style, agentBacked } of ordered) {
    paintLeader(input.ctx, placement, style, agentBacked);
  }
  for (const { placement, style } of ordered) {
    if (input.hiddenBodyAnnotationIds?.has(placement.annotation.id)) continue;
    paintPill(
      input.ctx,
      placement,
      style,
      input.hiddenTextAnnotationIds?.has(placement.annotation.id) ?? false,
      placement.annotation.id === input.hoveredAnnotationId &&
        input.hoveredAnnotationPart === "expand_button",
    );
  }
  for (const { placement, style, agentBacked } of ordered) {
    const selected =
      placement.annotation.id === input.activeAnnotationId ||
      placement.annotation.id === input.hoveredAnnotationId ||
      placement.annotation.id.startsWith("annotation-draft-");
    if (
      !selected ||
      placement.state === "collapsed" ||
      input.hiddenBodyAnnotationIds?.has(placement.annotation.id)
    ) {
      continue;
    }
    if (
      placement.state === "expanded" &&
      agentBacked &&
      placement.expandedContent
    ) {
      continue;
    }
    if (!agentBacked) {
      paintHandle(input.ctx, placement.handles.target, style);
    }
  }

  input.ctx.restore();
}

function paintOccupancySpans(
  ctx: CanvasRenderingContext2D,
  snapshot: ChartAnnotationOccupancySnapshot,
  spans: readonly { y: number; x1: number; x2: number }[],
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (const span of spans) {
    ctx.fillRect(
      snapshot.area.x + span.x1 * snapshot.ratio,
      snapshot.area.y + span.y * snapshot.ratio,
      Math.max(snapshot.ratio, (span.x2 - span.x1 + 1) * snapshot.ratio),
      Math.max(snapshot.ratio, snapshot.ratio),
    );
  }
  ctx.restore();
}

export function paintChartAnnotationOccupancyMap(
  ctx: CanvasRenderingContext2D,
  snapshot: ChartAnnotationOccupancySnapshot | undefined,
): void {
  if (!snapshot) return;
  ctx.save();
  ctx.fillStyle = DEBUG_MAP_BACKGROUND;
  ctx.fillRect(
    snapshot.area.x,
    snapshot.area.y,
    snapshot.area.width,
    snapshot.area.height,
  );
  paintOccupancySpans(
    ctx,
    snapshot,
    snapshot.chartSpans,
    DEBUG_CHART_INK,
    0.78,
  );
  paintOccupancySpans(
    ctx,
    snapshot,
    snapshot.placedSpans,
    DEBUG_ANNOTATION_INK,
    0.48,
  );

  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(7, 10, 16, 0.78)";
  ctx.fillRect(snapshot.area.x + 12, snapshot.area.y + 12, 278, 62);
  ctx.font = "12px system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(
    `Annotation occupancy ${snapshot.width}x${snapshot.height} @ ${snapshot.ratio.toFixed(
      2,
    )}px`,
    snapshot.area.x + 24,
    snapshot.area.y + 22,
  );
  ctx.fillStyle = DEBUG_CHART_INK;
  ctx.fillText(
    "orange: chart blockers",
    snapshot.area.x + 24,
    snapshot.area.y + 42,
  );
  ctx.fillStyle = DEBUG_ANNOTATION_INK;
  ctx.fillText(
    "cyan: placed annotation masks",
    snapshot.area.x + 150,
    snapshot.area.y + 42,
  );
  ctx.restore();
}
