// Purpose: Pin vertical profile layout and its schema invariants.
import { describe, expect, it } from "vitest";
import { layoutVerticalProfile } from "./render";
import { VerticalProfile } from "./types";

const up = "#26a69a";
const down = "#ef5350";
// 1 value unit = 10 pixels, inverted like a canvas y axis.
const yToPixel = (y: number) => 1000 - y * 10;

const rows: VerticalProfile.Row[] = [
  {
    low: 10,
    high: 11,
    segments: [
      { value: 2, color: up },
      { value: 2, color: down },
    ],
  },
  { low: 11, high: 12, segments: [{ value: 2, color: up }] },
];

describe("layoutVerticalProfile", () => {
  it("scales the longest row to the box and stacks segments from the left", () => {
    const { rects } = layoutVerticalProfile(
      { rows, levels: [] },
      { left: 100, right: 300, anchor: "left", yToPixel },
    );
    expect(rects).toEqual([
      { x: 100, y: 890, width: 100, height: 9, color: up },
      { x: 200, y: 890, width: 100, height: 9, color: down },
      { x: 100, y: 880, width: 100, height: 9, color: up },
    ]);
  });

  it("stacks segments inward from the right edge", () => {
    const { rects } = layoutVerticalProfile(
      { rows, levels: [] },
      { left: 100, right: 300, anchor: "right", yToPixel },
    );
    expect(rects.map(({ x, width, color }) => ({ x, width, color }))).toEqual([
      { x: 200, width: 100, color: up },
      { x: 100, width: 100, color: down },
      { x: 200, width: 100, color: up },
    ]);
  });

  it("draws levels across the box and no rows when every value is zero", () => {
    const geometry = layoutVerticalProfile(
      {
        rows: [{ low: 1, high: 2, segments: [{ value: 0, color: up }] }],
        levels: [{ y: 1.5, color: "#f5a623" }],
      },
      { left: 0, right: 50, anchor: "left", yToPixel },
    );
    expect(geometry.rects).toEqual([]);
    expect(geometry.lines).toEqual([
      { x1: 0, x2: 50, y: 985, color: "#f5a623" },
    ]);
  });
});

describe("VerticalProfile.State", () => {
  const valid = {
    box: { kind: "time", from: 0, to: 60 },
    rows,
    levels: [],
    visible: true,
  };

  it("accepts rows in any order", () => {
    expect(
      VerticalProfile.State.safeParse({ ...valid, rows: [...rows].reverse() })
        .success,
    ).toBe(true);
  });

  it.each([
    ["overlapping rows", { rows: [rows[0]!, { ...rows[1]!, low: 10.5 }] }],
    ["an inverted row", { rows: [{ low: 2, high: 1, segments: [] }] }],
    [
      "a negative value",
      { rows: [{ low: 1, high: 2, segments: [{ value: -1, color: up }] }] },
    ],
    ["an empty time box", { box: { kind: "time", from: 60, to: 60 } }],
    [
      "a zero-width edge box",
      { box: { kind: "edge", side: "right", width: 0 } },
    ],
  ])("rejects %s", (_, patch) => {
    expect(
      VerticalProfile.State.safeParse({ ...valid, ...patch }).success,
    ).toBe(false);
  });
});
