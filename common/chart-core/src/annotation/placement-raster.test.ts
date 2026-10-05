// Purpose: Tests for raster occupancy masks used by annotation placement
// Module:  @openchart/chart-core / annotation

import { describe, expect, it } from "vitest";
import {
  circleMask,
  combineMasks,
  createOccupancyBitmap,
  createRasterScale,
  lineMask,
  rectMask,
} from "./placement-raster";

describe("annotation placement raster occupancy", () => {
  const scale = createRasterScale({ x: 0, y: 0, width: 240, height: 160 });

  it("detects and counts overlapping spans", () => {
    const bitmap = createOccupancyBitmap(scale);
    const placed = rectMask(scale, { x: 20, y: 20, width: 40, height: 20 });
    const clear = rectMask(scale, { x: 90, y: 20, width: 40, height: 20 });
    const overlap = rectMask(scale, { x: 40, y: 30, width: 40, height: 20 });

    bitmap.set(placed);

    expect(bitmap.hasAny(clear)).toBe(false);
    expect(bitmap.hasAny(overlap)).toBe(true);
    expect(bitmap.overlapCount(overlap)).toBeGreaterThan(0);
    expect(bitmap.overlapCount(overlap)).toBeGreaterThan(
      bitmap.overlapCount(clear),
    );
  });

  it("exports occupied spans from the actual bitmap cells", () => {
    const bitmap = createOccupancyBitmap(scale);

    bitmap.set(rectMask(scale, { x: 20, y: 20, width: 40, height: 20 }));

    const spans = bitmap.spans();
    expect(spans.length).toBeGreaterThan(0);
    expect(
      spans.some(
        (span) =>
          span.y === scale.y(25) &&
          span.x1 <= scale.x(25) &&
          span.x2 >= scale.x(55),
      ),
    ).toBe(true);
  });

  it("does not smear out-of-bounds spans onto bitmap edges", () => {
    const bitmap = createOccupancyBitmap(scale);

    bitmap.set(rectMask(scale, { x: 20, y: -80, width: 40, height: 20 }));

    expect(bitmap.spans()).toHaveLength(0);
    expect(
      bitmap.hasAny(rectMask(scale, { x: 20, y: 0, width: 40, height: 4 })),
    ).toBe(false);
  });

  it("combines pill, leader, and anchor masks into one candidate footprint", () => {
    const bitmap = createOccupancyBitmap(scale);
    const pill = rectMask(scale, { x: 80, y: 30, width: 90, height: 28 });
    const leader = lineMask({
      scale,
      from: { x: 125, y: 58 },
      to: { x: 125, y: 110 },
      radius: 3,
    });
    const anchor = circleMask({ scale, center: { x: 125, y: 110 }, radius: 8 });
    const candidate = combineMasks([pill, leader, anchor]);

    bitmap.set(candidate);

    expect(
      bitmap.hasAny(rectMask(scale, { x: 100, y: 36, width: 10, height: 10 })),
    ).toBe(true);
    expect(
      bitmap.hasAny(rectMask(scale, { x: 122, y: 80, width: 6, height: 6 })),
    ).toBe(true);
    expect(
      bitmap.hasAny(rectMask(scale, { x: 120, y: 106, width: 10, height: 10 })),
    ).toBe(true);
  });
});
