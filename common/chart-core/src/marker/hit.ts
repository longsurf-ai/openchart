// Purpose: Hit-testing for in-plot Marker pins
// Module:  @openchart/chart-core / marker

import { HitTest } from "@openchart/chart-core/hit";
import { Marker } from "./types";
import type { RenderContext } from "@openchart/chart-core/drawing";
import type { Rect } from "@openchart/chart-core/span";
import { MarkerRenderUtils } from "./render";

export type MarkerHit = {
  kind: "marker";
  id: string;
  anchor: { x: number; y: number };
  stacked: boolean;
  expanded: boolean;
  stackSize: number;
};

export function hitMarkers(input: {
  pointer: { x: number; y: number };
  render: RenderContext;
  stripArea: Rect;
  markers: Marker.Record[];
  expandedMarkerId?: string | null;
}): MarkerHit | null {
  const laneHitPadding = 12;
  if (
    input.pointer.y < input.stripArea.y - laneHitPadding ||
    input.pointer.y >
      input.stripArea.y + input.stripArea.height + laneHitPadding
  ) {
    return null;
  }

  const hitGeometry = (
    geometries: ReturnType<typeof MarkerRenderUtils.layoutMarkerIcons>,
  ) => {
    let best: {
      geometry: (typeof geometries)[number];
      distance: number;
    } | null = null;
    for (let i = geometries.length - 1; i >= 0; i--) {
      const geometry = geometries[i]!;
      const size = geometry.size + laneHitPadding;
      if (
        !HitTest.rect(
          input.pointer.x,
          input.pointer.y,
          geometry.x - size / 2,
          geometry.y - size / 2,
          size,
          size,
        )
      )
        continue;

      const dx = input.pointer.x - geometry.x;
      const dy = input.pointer.y - geometry.y;
      const distance = dx * dx + dy * dy;
      if (!best || distance < best.distance) best = { geometry, distance };
    }
    return best?.geometry ?? null;
  };

  const toHit = (
    geometry: ReturnType<typeof MarkerRenderUtils.layoutMarkerIcons>[number],
  ): MarkerHit => ({
    kind: "marker",
    id: geometry.id,
    anchor: { x: geometry.x, y: geometry.y },
    stacked: geometry.stacked,
    expanded: geometry.expanded,
    stackSize: geometry.stackSize,
  });

  const expandedGeometries = MarkerRenderUtils.layoutMarkerIcons(
    input.render,
    input.stripArea,
    input.markers,
    input.expandedMarkerId,
  );
  const directExpandedHit = hitGeometry(expandedGeometries);
  if (directExpandedHit) return toHit(directExpandedHit);

  // Keep an expanded stack open while the pointer moves through the cluster's
  // original folded footprint or through the gap between fanned-out markers.
  // Without this hysteresis the hit geometry changes under the cursor and the
  // stack rapidly toggles between folded and expanded states.
  if (input.expandedMarkerId) {
    const collapsedGeometries = MarkerRenderUtils.layoutMarkerIcons(
      input.render,
      input.stripArea,
      input.markers,
      null,
    );
    const collapsedHit = hitGeometry(collapsedGeometries);
    if (collapsedHit) return toHit(collapsedHit);

    const expanded = expandedGeometries.filter((geometry) => geometry.expanded);
    const current =
      expanded.find((geometry) => geometry.id === input.expandedMarkerId) ??
      null;
    if (current && expanded.length > 0) {
      const minX = Math.min(...expanded.map((geometry) => geometry.x));
      const maxX = Math.max(...expanded.map((geometry) => geometry.x));
      const y = current.y;
      const keepAlivePadding = laneHitPadding + current.size / 2;
      if (
        input.pointer.x >= minX - keepAlivePadding &&
        input.pointer.x <= maxX + keepAlivePadding &&
        input.pointer.y >= y - keepAlivePadding &&
        input.pointer.y <= y + keepAlivePadding
      ) {
        let nearest = current;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const geometry of expanded) {
          const dx = input.pointer.x - geometry.x;
          const dy = input.pointer.y - geometry.y;
          const distance = dx * dx + dy * dy;
          if (distance < nearestDistance) {
            nearest = geometry;
            nearestDistance = distance;
          }
        }
        return toHit(nearest);
      }
    }
  }

  return null;
}
