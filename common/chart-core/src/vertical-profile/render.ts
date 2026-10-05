// Purpose: Lay out and paint a vertical profile inside a pixel box
// Module:  @openchart/chart-core / vertical-profile

import type { VerticalProfile } from "./types";

/** Pixel rectangles and lines for one profile; pure data, so layout is testable without a canvas. */
export type VerticalProfileGeometry = {
  rects: {
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
  }[];
  lines: { x1: number; x2: number; y: number; color: string }[];
};

/**
 * Lay out a profile between two pixel x bounds. The longest row (sum of its
 * segments) spans the full width; segments stack outward from `anchor`. Rows
 * keep a one-pixel gap so adjacent bands stay distinguishable. A profile whose
 * rows are all zero lays out no rectangles, but still draws its levels.
 *
 * @example
 * const geometry = layoutVerticalProfile(profile, { left: 600, right: 800, anchor: "right", yToPixel });
 */
export function layoutVerticalProfile(
  profile: Pick<VerticalProfile.State, "rows" | "levels">,
  box: {
    left: number;
    right: number;
    anchor: "left" | "right";
    yToPixel: (y: number) => number;
  },
): VerticalProfileGeometry {
  const width = Math.max(0, box.right - box.left);
  const longest = Math.max(
    0,
    ...profile.rows.map((row) =>
      row.segments.reduce((sum, segment) => sum + segment.value, 0),
    ),
  );
  const rects: VerticalProfileGeometry["rects"] = [];
  if (longest > 0) {
    const scale = width / longest;
    for (const row of profile.rows) {
      const top = box.yToPixel(row.high);
      const bottom = box.yToPixel(row.low);
      const y = Math.min(top, bottom);
      const height = Math.max(1, Math.abs(bottom - top) - 1);
      let cursor = box.anchor === "left" ? box.left : box.right;
      for (const segment of row.segments) {
        const length = segment.value * scale;
        if (length <= 0) continue;
        const x = box.anchor === "left" ? cursor : cursor - length;
        rects.push({ x, y, width: length, height, color: segment.color });
        cursor += box.anchor === "left" ? length : -length;
      }
    }
  }
  const lines = profile.levels.map((level) => ({
    x1: box.left,
    x2: box.right,
    y: box.yToPixel(level.y),
    color: level.color,
  }));
  return { rects, lines };
}

/** Paint laid-out profile geometry; the caller owns clipping and canvas state. */
export function paintVerticalProfile(
  ctx: CanvasRenderingContext2D,
  geometry: VerticalProfileGeometry,
): void {
  for (const rect of geometry.rects) {
    ctx.fillStyle = rect.color;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.lineWidth = 1;
  for (const line of geometry.lines) {
    const y = Math.round(line.y) + 0.5;
    ctx.strokeStyle = line.color;
    ctx.beginPath();
    ctx.moveTo(line.x1, y);
    ctx.lineTo(line.x2, y);
    ctx.stroke();
  }
}
