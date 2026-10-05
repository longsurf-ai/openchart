// Purpose: Canonical boundary and exact hover geometry regression checks
// Module:  @openchart/chart-core / drawing

import { describe, expect, it } from "vitest";
import { Drawing } from "./types";
import {
  drawingBoundary,
  projectDrawingBoundary,
  resolveBoundary,
} from "./boundary";
import {
  boundaryLabelPlacements,
  labelPlacementDistance,
} from "./boundary-labels";
import { drawBoundary } from "./canvas";
import type { Point } from "./shared";

const area = { x: 0, y: 0, width: 100, height: 100 };
const anchors = [
  { time: 1, price: 80 },
  { time: 9, price: 20 },
];

describe("canonical drawing boundaries", () => {
  it("preserves a backtracking/self-intersecting pencil as an open ordered path", () => {
    const item = Drawing.create("freehand", [
      { time: 1, price: 10 },
      { time: 3, price: 30 },
      { time: 2, price: 10 },
      { time: 1, price: 30 },
    ]);
    const path = drawingBoundary(item)!;
    const resolved = resolveBoundary(path, [0, 2, 1, 0], (price) => price)!;
    expect(path.closed).toBe(false);
    expect(resolved.primitives.map((edge) => edge.index)).toEqual([0, 1, 2]);
    expect(resolved.primitives.map((edge) => [edge.start, edge.end])).toEqual([
      [
        { x: 0, y: 10 },
        { x: 2, y: 30 },
      ],
      [
        { x: 2, y: 30 },
        { x: 1, y: 10 },
      ],
      [
        { x: 1, y: 10 },
        { x: 0, y: 30 },
      ],
    ]);
    expect(resolveBoundary(path, [0, 2], (price) => price)).toBeNull();
    expect(projectDrawingBoundary(item, [{ x: 1, y: 1 }])).toBeNull();
  });

  it.each(["rectangle", "triangle"] as const)(
    "%s closes explicitly and resolves in ordinal X before pixel projection",
    (kind) => {
      const item = Drawing.create(kind, anchors);
      const boundary = drawingBoundary(item)!;
      const logical = resolveBoundary(boundary, [2, 6], (price) => price)!;
      const pixel = projectDrawingBoundary(item, [
        { x: 20, y: 20 },
        { x: 60, y: 80 },
      ])!;
      expect(boundary.closed).toBe(true);
      expect(logical.primitives.map((edge) => edge.start)).toEqual(
        kind === "rectangle"
          ? [
              { x: 2, y: 80 },
              { x: 6, y: 80 },
              { x: 6, y: 20 },
              { x: 2, y: 20 },
            ]
          : [
              { x: 4, y: 80 },
              { x: 6, y: 20 },
              { x: 2, y: 20 },
            ],
      );
      expect(pixel.primitives.at(-1)!.end).toEqual(pixel.primitives[0]!.start);
      expect(pixel.primitives.map((edge) => edge.start)).toEqual(
        logical.primitives.map((edge) => ({
          x: edge.start.x * 10,
          y: 100 - edge.start.y,
        })),
      );
      const reversed = Drawing.create(kind, [...anchors].reverse());
      const reversedPath = resolveBoundary(
        drawingBoundary(reversed)!,
        [6, 2],
        (price) => price,
      )!;
      expect(
        reversedPath.primitives
          .map((edge) => edge.start)
          .sort((a, b) => a.x - b.x || a.y - b.y),
      ).toEqual(
        logical.primitives
          .map((edge) => edge.start)
          .sort((a, b) => a.x - b.x || a.y - b.y),
      );
    },
  );

  it("paints the same true quadratic, not its control polygon", () => {
    const item = Drawing.create("curved_line", [
      ...anchors,
      { time: 4, price: 50 },
    ]);
    const path = resolveBoundary(
      drawingBoundary(item)!,
      [0, 100, 50],
      (price) => price,
    )!;
    const commands: unknown[] = [];
    const canvas = {
      beginPath: () => {},
      moveTo: (...args: number[]) => commands.push(["move", ...args]),
      lineTo: (...args: number[]) => commands.push(["line", ...args]),
      quadraticCurveTo: (...args: number[]) =>
        commands.push(["quadratic", ...args]),
      stroke: () => {},
    } as unknown as CanvasRenderingContext2D;
    drawBoundary(canvas, path);
    expect(commands).toEqual([
      ["move", 0, 80],
      ["quadratic", 100, 20, 50, 50],
    ]);
    expect(drawingBoundary(Drawing.create("curved_line", anchors))).toBeNull();
    expect(drawingBoundary(Drawing.create("ellipse", anchors))).toBeNull();
  });
});

function pathFromPoints(kind: "polyline" | "curved_line", points: Point[]) {
  return projectDrawingBoundary(
    Drawing.create(
      kind,
      points.map((point, index) => ({ time: index, price: point.y })),
    ),
    points,
  )!;
}

describe("finite boundary hover placement", () => {
  it("centres the entire pencil path rather than centring every tiny edge", () => {
    const path = pathFromPoints("polyline", [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 70, y: 20 },
      { x: 90, y: 20 },
    ]);
    expect(boundaryLabelPlacements(path, area)).toMatchObject([
      { x: 50, y: 20, angle: 0 },
    ]);
    const vertical = pathFromPoints("polyline", [
      { x: 20, y: -50 },
      { x: 20, y: 150 },
    ]);
    expect(boundaryLabelPlacements(vertical, area)).toMatchObject([
      { x: 20, y: 50, angle: 90 },
    ]);
    const finite = pathFromPoints("polyline", [
      { x: 10, y: 10 },
      { x: 30, y: 30 },
    ]);
    expect(boundaryLabelPlacements(finite, area)).toMatchObject([
      { x: 30, y: 30, angle: 45 },
    ]);
  });

  it("keeps every centre-X branch of an open backtracking stroke selectable", () => {
    const path = pathFromPoints("polyline", [
      { x: 0, y: 10 },
      { x: 100, y: 30 },
      { x: 0, y: 70 },
      { x: 100, y: 90 },
    ]);
    const labels = boundaryLabelPlacements(path, area);
    expect(labels.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 50, y: 20 },
      { x: 50, y: 50 },
      { x: 50, y: 80 },
    ]);
    const near = { x: 80, y: 86 };
    expect(labelPlacementDistance(labels[2]!, near)).toBeCloseTo(0);
    expect(labelPlacementDistance(labels[1]!, near)).toBeGreaterThan(20);
  });

  it("solves both nonmonotone quadratic branches, tangents and finite distances", () => {
    const path = pathFromPoints("curved_line", [
      { x: 0, y: 10 },
      { x: 200, y: 50 },
      { x: 0, y: 90 },
    ]);
    const labels = boundaryLabelPlacements(path, area).sort(
      (a, b) => a.y - b.y,
    );
    expect(labels).toHaveLength(2);
    for (const label of labels) expect(label.x).toBeCloseTo(50);
    expect(labels[0]!.y).toBeCloseTo(50 - 20 * Math.sqrt(2));
    expect(labels[1]!.y).toBeCloseTo(50 + 20 * Math.sqrt(2));
    expect(labels[0]!.angle).toBeCloseTo(
      (Math.atan2(80, 200 * Math.sqrt(2)) * 180) / Math.PI,
    );
    expect(labels[1]!.angle).toBeCloseTo(-labels[0]!.angle);
    // This is B(0.8), well away from either label and the control polygon.
    expect(labelPlacementDistance(labels[1]!, { x: 64, y: 74 })).toBeCloseTo(
      0,
      8,
    );
    expect(
      labelPlacementDistance(labels[0]!, { x: 64, y: 74 }),
    ).toBeGreaterThan(20);
    const clipped = boundaryLabelPlacements(path, {
      x: 0,
      y: 60,
      width: 100,
      height: 40,
    });
    expect(clipped).toHaveLength(1);
    expect(clipped[0]!.y).toBeCloseTo(labels[1]!.y);
  });
});
