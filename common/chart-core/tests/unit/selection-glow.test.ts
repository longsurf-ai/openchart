// Purpose: Tests for selection-glow bucket helpers
// Module:  @openchart/chart-core / tests / unit

import { describe, expect, it } from "vitest";
import {
  bucketColor,
  bucketCountForSpan,
  bucketForIndex,
  glowColor,
  normalizeSelectionGlow,
  selectedSegmentWindowByIndex,
  selectedWindowByIndex,
} from "@openchart/chart-core/render/selection-glow";

describe("selection glow utilities", () => {
  it("normalizes and clamps glow options", () => {
    const glow = normalizeSelectionGlow(
      {
        enabled: true,
        fromIndex: -8.2,
        toIndex: 12.8,
        speed: -1,
      },
      1000,
    );
    expect(glow).not.toBeNull();
    expect(glow?.from).toBe(0);
    expect(glow?.to).toBe(12);
    expect(glow?.speed).toBe(1);
    expect(glow?.span).toBe(13);
    expect(glow?.bucketCount).toBe(13);
  });

  it("applies bucket count rule (cap at 96)", () => {
    expect(bucketCountForSpan(1)).toBe(1);
    expect(bucketCountForSpan(12)).toBe(12);
    expect(bucketCountForSpan(96)).toBe(96);
    expect(bucketCountForSpan(97)).toBe(96);
    expect(bucketCountForSpan(1200)).toBe(96);
  });

  it("assigns one bucket per selected index when span <= 96", () => {
    const glow = normalizeSelectionGlow(
      { enabled: true, fromIndex: 10, toIndex: 15, speed: 1 },
      1000,
    )!;
    const buckets = Array.from({ length: glow.span }, (_, i) =>
      bucketForIndex(glow, glow.from + i),
    );
    expect(buckets).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("produces deterministic colors for fixed time input", () => {
    const a = normalizeSelectionGlow(
      { enabled: true, fromIndex: 100, toIndex: 400, speed: 1.2 },
      123456,
    )!;
    const b = normalizeSelectionGlow(
      { enabled: true, fromIndex: 100, toIndex: 400, speed: 1.2 },
      123456,
    )!;

    expect(glowColor(a, 220)).toBe(glowColor(b, 220));
    expect(bucketColor(a, 7)).toBe(bucketColor(b, 7));
  });

  it("uses caller-provided theme color refs for bucket colors", () => {
    const glow = normalizeSelectionGlow(
      {
        colors: [
          "var(--glow-selection-test-a, 10 20% 30%)",
          "var(--glow-selection-test-b, 40 50% 60%)",
        ],
        enabled: true,
        fromIndex: 0,
        toIndex: 3,
        speed: 1,
      },
      0,
    )!;

    expect(bucketColor(glow, 0)).toBe("hsl(10 20% 30% / 0.98)");
    expect(bucketColor(glow, 2)).toBe("hsl(40 50% 60% / 0.98)");
  });

  it("finds selected item and segment windows with index clipping", () => {
    const items = Array.from({ length: 1000 }, (_, index) => ({ index }));
    const range = { from: 100, to: 900 };
    const glow = normalizeSelectionGlow(
      { enabled: true, fromIndex: 250, toIndex: 320, speed: 1 },
      1000,
    )!;

    const itemWindow = selectedWindowByIndex(items, range, glow);
    expect(itemWindow).toEqual({ from: 250, to: 321 });

    const segmentWindow = selectedSegmentWindowByIndex(items, range, glow);
    expect(segmentWindow).toEqual({ from: 249, to: 321 });
  });
});
