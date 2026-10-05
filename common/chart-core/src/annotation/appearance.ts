// Purpose: Single source of truth for chart annotation overlay geometry and source badges
// Module:  @openchart/chart-core / annotation

import { Schema } from "effect";
import { ChartAnnotation } from "./types";

const AGENT_ANNOTATION_FILL_COLOR =
  "var(--chart-agent-annotation-fill, #111827)";
const AGENT_ANNOTATION_TEXT_COLOR =
  "var(--chart-agent-annotation-text, #f8fafc)";

export type AnnotationSourceBadge = {
  id: string;
  label: string;
  logoUrl?: string;
  color?: string;
  textColor?: string;
  showTextFallback?: boolean;
};

export type AnnotationExpandedCardContent = {
  title: string;
  content: string;
  questions: readonly string[];
};

export type AnnotationAppearance = {
  font: string;
  height: number;
  radius: number;
  paddingX: number;
  sourceBadges: AnnotationSourceBadge[];
  sourceSlotWidth: number;
  textGapAfterSources: number;
  textEndGap: number;
  minWidth: number;
  compactTextMaxWidth: number;
  expandedCardWidth: number;
  expandedCardHeight: number;
  expandedCardMinWidth: number;
  expandedCardMinHeight: number;
  leaderTargetGap: number;
  targetDotRadius: number;
  selectedHandleRadius: number;
};

export function resolveAgentAnnotationAccentColor(
  annotation: Pick<ChartAnnotation.Renderable, "sentiment">,
): string {
  if (annotation.sentiment > 0.15) {
    return "var(--chart-agent-annotation-positive, #51c27b)";
  }
  if (annotation.sentiment < -0.15) {
    return "var(--chart-agent-annotation-negative, #d65c5c)";
  }
  return "var(--chart-agent-annotation-neutral, #ffffff)";
}

export function resolveAgentAnnotationStyle(
  annotation: ChartAnnotation.Renderable,
): ChartAnnotation.Style {
  const accent = resolveAgentAnnotationAccentColor(annotation);
  return Schema.decodeUnknownSync(ChartAnnotation.Style)({
    lineColor: accent,
    lineWidth: 1,
    lineStyle: "solid",
    fillColor: AGENT_ANNOTATION_FILL_COLOR,
    textColor: AGENT_ANNOTATION_TEXT_COLOR,
    fontSize: ChartAnnotation.DEFAULT_FONT_SIZE,
    opacity: 1,
  });
}

const FONT_FAMILY = "system-ui, sans-serif";
const FONT_SIZE = ChartAnnotation.DEFAULT_FONT_SIZE;
const PILL_HEIGHT = 28;
const PILL_PADDING_X = 12;
const PILL_MIN_WIDTH = 34;
const COMPACT_TEXT_MAX_WIDTH = 180;
const EXPANDED_CARD_WIDTH = 420;
const EXPANDED_CARD_HEIGHT = 340;
const EXPANDED_CARD_MIN_WIDTH = 300;
const EXPANDED_CARD_MIN_HEIGHT = 144;
const SOURCE_BADGE_SIZE = 22;
const SOURCE_BADGE_OVERLAP = 6;
const SOURCE_BADGE_GAP = 8;
const TEXT_END_GAP = 8;
const MAX_SOURCE_BADGES = 3;

function normalizeBadges(
  badges: readonly AnnotationSourceBadge[] | undefined,
): AnnotationSourceBadge[] {
  if (!badges) return [];
  const result: AnnotationSourceBadge[] = [];
  const seen = new Set<string>();
  for (const badge of badges) {
    const id = badge.id.trim();
    const label = badge.label.trim();
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    result.push({ ...badge, id, label });
    if (result.length === MAX_SOURCE_BADGES) break;
  }
  return result;
}

function sourceSlotWidth(badges: readonly AnnotationSourceBadge[]): number {
  if (badges.length === 0) return 0;
  return (
    SOURCE_BADGE_SIZE +
    (badges.length - 1) * (SOURCE_BADGE_SIZE - SOURCE_BADGE_OVERLAP) +
    SOURCE_BADGE_GAP
  );
}

export function resolveAnnotationAppearance(input: {
  annotation: ChartAnnotation.Renderable;
  sourceBadges?: readonly AnnotationSourceBadge[];
  agentBacked?: boolean;
}): AnnotationAppearance {
  const sourceBadges = normalizeBadges(input.sourceBadges);
  const fontSize =
    input.agentBacked || sourceBadges.length > 0
      ? FONT_SIZE
      : input.annotation.style.fontSize || FONT_SIZE;
  return {
    font: `${fontSize}px ${FONT_FAMILY}`,
    height: PILL_HEIGHT,
    radius: PILL_HEIGHT / 2,
    paddingX: PILL_PADDING_X,
    sourceBadges,
    sourceSlotWidth: sourceSlotWidth(sourceBadges),
    textGapAfterSources: SOURCE_BADGE_GAP,
    textEndGap: TEXT_END_GAP,
    minWidth: PILL_MIN_WIDTH,
    compactTextMaxWidth: COMPACT_TEXT_MAX_WIDTH,
    expandedCardWidth: EXPANDED_CARD_WIDTH,
    expandedCardHeight: EXPANDED_CARD_HEIGHT,
    expandedCardMinWidth: EXPANDED_CARD_MIN_WIDTH,
    expandedCardMinHeight: EXPANDED_CARD_MIN_HEIGHT,
    leaderTargetGap: 9,
    targetDotRadius: 4,
    selectedHandleRadius: 5,
  };
}

export function sourceBadgeColor(badge: AnnotationSourceBadge): string {
  if (badge.color) return badge.color;
  const palette = ["#f97316", "#ff8a00", "#0f4c81", "#2563eb", "#0891b2"];
  let hash = 0;
  for (let i = 0; i < badge.id.length; i++) {
    hash = (hash * 31 + badge.id.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length]!;
}

export function sourceBadgePlateColor(input: {
  badge: AnnotationSourceBadge;
  hasLoadedLogo: boolean;
}): string | null {
  const explicitColor = input.badge.color?.trim();
  if (explicitColor) return explicitColor;
  return input.hasLoadedLogo ? null : sourceBadgeColor(input.badge);
}

export function sourceBadgeText(badge: AnnotationSourceBadge): string {
  return badge.label.trim().slice(0, 1).toUpperCase();
}
