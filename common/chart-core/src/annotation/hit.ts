// Purpose: Hit-testing for runtime-laid-out chart annotation callout pills
// Module:  @openchart/chart-core / annotation

import { HitTest } from "@openchart/chart-core/hit";
import {
  expandChartAnnotationPlacements,
  layoutChartAnnotations,
  type AnnotationPlacement,
  type ChartAnnotationLayoutInput,
} from "./layout";

export type ChartAnnotationHit = {
  kind: "chart_annotation";
  id: string;
  part: "body" | "target_handle" | "label_handle" | "expand_button";
  anchor: { x: number; y: number };
  pill: { x: number; y: number; width: number; height: number };
  compactPill?: { x: number; y: number; width: number; height: number };
  actionButton?: { x: number; y: number; width: number; height: number };
  dragAnchor?: { x: number; y: number };
  layered: boolean;
  expanded: boolean;
  bodyExpanded?: boolean;
  bodyTruncated?: boolean;
};

export function orderChartAnnotationPlacementsForHit(
  placements: readonly AnnotationPlacement[],
): AnnotationPlacement[] {
  return [...placements].sort((a, b) => b.zIndex - a.zIndex);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rectHit(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return HitTest.rect(
    point.x,
    point.y,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );
}

/** Project canonical placement geometry and disclosure into a hit without changing hit priority.
 * @example hitFromPlacement(placement, "body", placement.handles.label)
 */
export function hitFromPlacement(
  placement: AnnotationPlacement,
  part: ChartAnnotationHit["part"],
  anchor: { x: number; y: number },
): ChartAnnotationHit {
  return {
    kind: "chart_annotation",
    id: placement.annotation.id,
    part,
    anchor,
    pill: placement.pill,
    compactPill: placement.compactPill,
    actionButton: placement.actionButton,
    dragAnchor: {
      x: placement.pill.x + placement.pill.width / 2,
      y: placement.pill.y + placement.pill.height / 2,
    },
    layered: placement.layer > 0,
    expanded: placement.state === "expanded",
    bodyTruncated: placement.bodyTruncated,
    ...(placement.bodyExpanded === true ? { bodyExpanded: true } : {}),
  };
}

export function hitChartAnnotationPlacements(input: {
  placements: readonly AnnotationPlacement[];
  pointer: { x: number; y: number };
  hoveredAnnotationId?: string | null;
  expandedAnnotation?: ChartAnnotationLayoutInput["expandedAnnotation"];
  activeAnnotationId?: string | null;
  zSorted?: boolean;
}): ChartAnnotationHit | null {
  const placements = input.zSorted
    ? input.placements
    : orderChartAnnotationPlacementsForHit(input.placements);
  const retainedId =
    input.expandedAnnotation?.id ?? input.hoveredAnnotationId ?? null;
  const retained = retainedId
    ? placements.find((placement) => placement.annotation.id === retainedId)
    : undefined;
  if (retained && retained.state !== "collapsed") {
    if (rectHit(input.pointer, retained.hit)) {
      if (
        retained.actionButton &&
        rectHit(input.pointer, retained.actionButton)
      ) {
        return hitFromPlacement(retained, "expand_button", {
          x: retained.actionButton.x + retained.actionButton.width / 2,
          y: retained.actionButton.y + retained.actionButton.height / 2,
        });
      }
      return hitFromPlacement(retained, "body", {
        x: retained.pill.x + retained.pill.width / 2,
        y: retained.pill.y + retained.pill.height / 2,
      });
    }
    if (distance(input.pointer, retained.handles.target) <= 8) {
      return hitFromPlacement(
        retained,
        "target_handle",
        retained.handles.target,
      );
    }
    if (distance(input.pointer, retained.handles.label) <= 8) {
      return hitFromPlacement(retained, "label_handle", retained.handles.label);
    }
  }
  for (const placement of placements) {
    if (placement.state === "collapsed") continue;
    if (distance(input.pointer, placement.handles.target) <= 10) {
      return hitFromPlacement(
        placement,
        "target_handle",
        placement.handles.target,
      );
    }
  }
  for (const placement of placements) {
    const handlesVisible =
      placement.annotation.id === input.activeAnnotationId ||
      placement.annotation.id === input.hoveredAnnotationId ||
      placement.annotation.id.startsWith("annotation-draft-");
    if (rectHit(input.pointer, placement.hit)) {
      if (
        placement.actionButton &&
        rectHit(input.pointer, placement.actionButton)
      ) {
        return hitFromPlacement(placement, "expand_button", {
          x: placement.actionButton.x + placement.actionButton.width / 2,
          y: placement.actionButton.y + placement.actionButton.height / 2,
        });
      }
      return hitFromPlacement(placement, "body", {
        x: placement.pill.x + placement.pill.width / 2,
        y: placement.pill.y + placement.pill.height / 2,
      });
    }
    if (
      handlesVisible &&
      placement.state !== "collapsed" &&
      distance(input.pointer, placement.handles.label) <= 8
    ) {
      return hitFromPlacement(
        placement,
        "label_handle",
        placement.handles.label,
      );
    }
  }
  return null;
}

export function hitChartAnnotations(
  input: ChartAnnotationLayoutInput & { pointer: { x: number; y: number } },
): ChartAnnotationHit | null {
  const placements = layoutChartAnnotations(input);
  return hitChartAnnotationPlacements({
    placements: expandChartAnnotationPlacements(input, placements),
    pointer: input.pointer,
    hoveredAnnotationId: input.hoveredAnnotationId,
    expandedAnnotation: input.expandedAnnotation,
    activeAnnotationId: input.activeAnnotationId,
  });
}
