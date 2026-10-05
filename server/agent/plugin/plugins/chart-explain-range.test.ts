// Purpose: Keep Chart Explain swing detection factual and bounded.

import { expect, test } from "vitest";
import { summarizeRange, type RangeBar } from "./chart-explain-range";

const bar = (index: number, open: number, close: number): RangeBar => ({
  time: 1_700_000_000_000 + index * 86_400_000,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
});

test("separates a rise, pullback, and rebound at V1's reversal threshold", () => {
  const brief = summarizeRange(
    [bar(0, 100, 100), bar(1, 100, 110), bar(2, 110, 105), bar(3, 105, 112)],
    "1d",
  );
  expect(brief.changePct).toBeCloseTo(12);
  expect(brief.waves.map((wave) => Math.round(wave.changePct))).toEqual([
    10, -5, 7,
  ]);
  expect(brief.waves.map((wave) => wave.to)).toEqual([
    bar(1, 0, 0).time,
    bar(2, 0, 0).time,
    bar(3, 0, 0).time,
  ]);
});

test("keeps a quiet range as one wave and bounds noisy ranges", () => {
  expect(
    summarizeRange([bar(0, 100, 100), bar(1, 100, 101)], "1d").waves,
  ).toHaveLength(1);
  const noisy = Array.from({ length: 40 }, (_, index) =>
    bar(index, index % 2 ? 100 : 110, index % 2 ? 110 : 100),
  );
  const brief = summarizeRange(noisy, "1d");
  expect(brief.waves.length).toBeLessThanOrEqual(4);
  expect(brief.waves.map((wave) => wave.from)).toEqual(
    [...brief.waves.map((wave) => wave.from)].sort((a, b) => a - b),
  );
});
