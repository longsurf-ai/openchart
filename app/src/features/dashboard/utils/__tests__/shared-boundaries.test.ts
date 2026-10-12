// Purpose: Verify shared-edge resizing keeps valid rectangles, size constraints and unrelated placements.
import { expect, test } from "vitest";
import type { Layout } from "react-grid-layout";

import { resizeSharedBoundary, sharedBoundaries } from "../shared-boundaries";

const pair: Layout = [
  { i: "chart", x: 0, y: 0, w: 6, h: 24, minW: 4 },
  { i: "watchlist", x: 6, y: 0, w: 6, h: 24, minW: 3 },
];

test("a shared vertical edge exchanges space in both directions without changing its outer rectangle", () => {
  const boundary = sharedBoundaries(pair)[0]!;
  for (const delta of [-20, -1, 0, 1, 20]) {
    const next = resizeSharedBoundary(pair, boundary, delta);
    const [left, right] = next;
    expect(left!.x).toBe(0);
    expect(right!.x + right!.w).toBe(12);
    expect(left!.x + left!.w).toBe(right!.x);
    expect(left!.w).toBeGreaterThanOrEqual(4);
    expect(right!.w).toBeGreaterThanOrEqual(3);
    expect(next.map(({ y, h }) => ({ y, h }))).toEqual([
      { y: 0, h: 24 },
      { y: 0, h: 24 },
    ]);
  }
  expect(
    resizeSharedBoundary(pair, boundary, 1).map(({ x, w }) => ({ x, w })),
  ).toEqual([
    { x: 0, w: 7 },
    { x: 7, w: 5 },
  ]);
  expect(pair[0]!.w).toBe(6);
  expect(pair[1]!.x).toBe(6);
});

test("a shared horizontal edge respects both height limits and leaves a neighbour untouched", () => {
  const layout: Layout = [
    { i: "bottom", x: 0, y: 12, w: 6, h: 12, minH: 6, maxH: 14 },
    { i: "neighbour", x: 6, y: 0, w: 6, h: 24 },
    { i: "top", x: 0, y: 0, w: 6, h: 12, minH: 6, maxH: 15 },
  ];
  const boundary = sharedBoundaries(layout)[0]!;
  expect(boundary).toEqual({
    before: "top",
    after: "bottom",
    orientation: "horizontal",
  });
  const increased = resizeSharedBoundary(layout, boundary, 50);
  expect(increased[0]).toMatchObject({ y: 15, h: 9 });
  expect(increased[2]).toMatchObject({ y: 0, h: 15 });
  const decreased = resizeSharedBoundary(layout, boundary, -50);
  expect(decreased[0]).toMatchObject({ y: 10, h: 14 });
  expect(decreased[2]).toMatchObject({ y: 0, h: 10 });
  expect(increased[1]).toBe(layout[1]);
  expect(decreased[1]).toBe(layout[1]);
});

test("partial edges, gaps and corner contacts do not create ambiguous separators", () => {
  expect(
    sharedBoundaries([
      { i: "left", x: 0, y: 0, w: 6, h: 24 },
      { i: "upper-right", x: 6, y: 0, w: 6, h: 10 },
      { i: "lower-right", x: 6, y: 12, w: 6, h: 12 },
      { i: "corner", x: 0, y: 24, w: 3, h: 6 },
    ]),
  ).toEqual([]);
});
