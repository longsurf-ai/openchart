// Purpose: Tests for Chart Explain progress-log render helpers
// Module:  @openchart/chart-core / span

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it, vi } from "vitest";
import { createCartesian2D } from "@openchart/chart-core/coord";
import { renderSpanBands, SpanRenderUtils } from "./render";

const {
  strengthenScanColor,
  layoutProgressLogLines,
  progressLogDisplayLines,
  progressLogMaxLines,
  progressLogOldestAlpha,
  progressLogFadeInMs,
  progressLogLatestFlashPeriodMs,
  latestProgressLogFlash,
} = SpanRenderUtils;

it("dims only the gaps outside all scanners, once per frame", () => {
  const ctx = createCanvas(1000, 300).getContext("2d");
  const fill = vi.spyOn(ctx, "fillRect");
  const now = vi.spyOn(performance, "now").mockReturnValue(2800);
  const area = { x: 0, y: 0, width: 1000, height: 300 };
  try {
    renderSpanBands({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      render: {
        coord: createCartesian2D(
          area,
          { x: { min: 0, max: 10 }, y: { right: { min: 0, max: 1 } } },
          "right",
        ),
        xPositions: [0, 1000],
        xFn: (i) => i * 1000,
        data: [{ time: 1_756_684_800 }, { time: 1_756_684_810 }],
        visibleRange: { from: 0, to: 2 },
        area,
        backgroundColor: "#ffffff",
      },
      progressBands: [
        [1_756_684_806_000, 1_756_684_808_000],
        [1_756_684_801_000, 1_756_684_803_000],
      ].map(([tStart, tEnd]) => ({
        xStart: 0,
        xEnd: 0,
        tStart: tStart! / 1000,
        tEnd: tEnd! / 1000,
        color: "#00ffff",
        translucent: true,
        mode: "annotating",
        startedAtMs: 0,
      })),
    });
    expect(fill.mock.calls).toEqual([
      [0, 0, 100, 300],
      [300, 0, 300, 300],
      [800, 0, 200, 300],
      [600, 0, 200, 300],
      [100, 0, 200, 300],
    ]);
  } finally {
    fill.mockRestore();
    now.mockRestore();
  }
});

function parseHsl(color: string): { h: number; s: number; l: number } {
  const match = color.match(/^hsl\((\d+) (\d+)% (\d+)%\)$/);
  if (!match) throw new Error(`expected solid hsl() color, got: ${color}`);
  return {
    h: Number(match[1]),
    s: Number(match[2]),
    l: Number(match[3]),
  };
}

describe("strengthenScanColor", () => {
  it("accepts raw HSL triples and keeps the hue", () => {
    const { h } = parseHsl(strengthenScanColor("174 86% 62%"));
    expect(Math.abs(h - 174)).toBeLessThanOrEqual(2);
  });

  it("boosts saturation and clamps it at 100", () => {
    expect(parseHsl(strengthenScanColor("174 86% 62%")).s).toBe(100);
    const lowSat = parseHsl(strengthenScanColor("hsl(200 10% 50%)"));
    expect(lowSat.s).toBeGreaterThan(20);
    expect(lowSat.s).toBeLessThanOrEqual(100);
  });

  it("caps lightness on light chart backgrounds", () => {
    const { l } = parseHsl(strengthenScanColor("174 86% 62%", "#ffffff"));
    expect(l).toBeLessThanOrEqual(42);
  });

  it("floors lightness on dark chart backgrounds", () => {
    const { l } = parseHsl(strengthenScanColor("174 86% 32%", "#0b1220"));
    expect(l).toBeGreaterThanOrEqual(68);
  });

  it("resolves var() colors through their fallback", () => {
    const { h, s } = parseHsl(
      strengthenScanColor("var(--glow-reveal, 198 94% 66%)"),
    );
    expect(Math.abs(h - 198)).toBeLessThanOrEqual(2);
    expect(s).toBe(100);
  });

  it("returns a solid color with no alpha channel", () => {
    expect(strengthenScanColor("174 86% 62%")).not.toContain("/");
  });
});

describe("layoutProgressLogLines", () => {
  const now = 10_000;
  const settled = (text: string) => ({ text, atMs: now - progressLogFadeInMs });

  it("caps to the newest lines, dropping the oldest first", () => {
    const log = Array.from({ length: 10 }, (_, i) => settled(`line ${i}`));
    const lines = layoutProgressLogLines(log, now);
    expect(lines).toHaveLength(progressLogMaxLines);
    expect(lines[0]!.text).toBe("line 4");
    expect(lines.at(-1)!.text).toBe("line 9");
  });

  it("ramps alpha from the oldest base to 1 for the newest", () => {
    const lines = layoutProgressLogLines(
      [settled("a"), settled("b"), settled("c")],
      now,
    );
    expect(lines[0]!.alpha).toBeCloseTo(progressLogOldestAlpha, 5);
    expect(lines[1]!.alpha).toBeGreaterThan(lines[0]!.alpha);
    expect(lines[2]!.alpha).toBeCloseTo(1, 5);
  });

  it("fades the newest line in over the fade-in window", () => {
    const lines = layoutProgressLogLines(
      [settled("old"), { text: "new", atMs: now - progressLogFadeInMs / 2 }],
      now,
    );
    expect(lines[1]!.alpha).toBeCloseTo(0.5, 5);
  });

  it("clamps the fade-in factor to [0, 1]", () => {
    const future = layoutProgressLogLines([{ text: "a", atMs: now + 50 }], now);
    expect(future[0]!.alpha).toBe(0);
    const stale = layoutProgressLogLines([{ text: "a", atMs: 0 }], now);
    expect(stale[0]!.alpha).toBe(1);
  });

  it("renders a single settled line at full alpha", () => {
    expect(layoutProgressLogLines([settled("a")], now)[0]!.alpha).toBe(1);
  });
});

describe("progressLogDisplayLines", () => {
  const measure = (text: string) => text.length * 10;

  it("separates adjacent Markdown headings and removes bold markers", () => {
    const log = [
      {
        text: "**Constructing the stored array****Refining results**",
        atMs: 7,
      },
    ];
    expect(progressLogDisplayLines(log, 300, measure)).toEqual([
      { text: "Constructing the stored array", atMs: 7 },
      { text: "Refining results", atMs: 7 },
    ]);
    expect(log[0]!.text).toContain("****");
  });

  it("preserves explicit line breaks and wraps long lines at words", () => {
    expect(
      progressLogDisplayLines(
        [{ text: "First line\nConstructing the stored array", atMs: 9 }],
        140,
        measure,
      ).map((line) => line.text),
    ).toEqual(["First line", "Constructing", "the stored", "array"]);
  });

  it("breaks long unspaced text without dropping characters", () => {
    expect(
      progressLogDisplayLines([{ text: "abcdefghij", atMs: 3 }], 40, measure)
        .map((line) => line.text)
        .join(""),
    ).toBe("abcdefghij");
  });
});

describe("latestProgressLogFlash", () => {
  it("sweeps the newest progress-line highlight left to right", () => {
    const start = latestProgressLogFlash(0);
    const middle = latestProgressLogFlash(progressLogLatestFlashPeriodMs / 2);
    const end = latestProgressLogFlash(progressLogLatestFlashPeriodMs - 1);

    expect(start.centerRatio).toBeLessThan(0);
    expect(middle.centerRatio).toBeGreaterThan(start.centerRatio);
    expect(end.centerRatio).toBeGreaterThan(middle.centerRatio);
    expect(end.centerRatio).toBeGreaterThan(1);
    expect(start.spreadPx).toBe(30);
    expect(start.baseAlpha).toBeLessThan(start.highlightAlpha);
  });
});
