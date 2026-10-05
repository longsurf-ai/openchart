// Purpose: Tests for drawing canvas rendering safeguards
// Module:  @openchart/chart-core / drawing

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createCartesian2D } from "@openchart/chart-core/coord";
import { DrawingRenderUtils, renderDrawings } from "./render";
import { hitTestDrawings } from "./hit";
import { Drawing } from "./types";
import {
  FIB_CHANNEL_LEVELS,
  FIB_RETRACEMENT_LEVELS,
  lineLabelPlacements,
  offsetFromLine,
  anchorToPoint,
  continuousIndexFromTime,
  handlePoints,
} from "./geometry";
import type { LineLabelPlacement } from "./shared";

function createCanvasContext(ops: string[]): CanvasRenderingContext2D {
  return {
    save: () => ops.push("save"),
    restore: () => ops.push("restore"),
    beginPath: () => ops.push("beginPath"),
    closePath: () => ops.push("closePath"),
    rect: (x: number, y: number, w: number, h: number) =>
      ops.push(`rect:${x}:${y}:${w}:${h}`),
    clip: () => ops.push("clip"),
    moveTo: (x: number, y: number) => ops.push(`moveTo:${x}:${y}`),
    lineTo: (x: number, y: number) => ops.push(`lineTo:${x}:${y}`),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) =>
      ops.push(`curve:${cx}:${cy}:${x}:${y}`),
    stroke: () => ops.push("stroke"),
    arc: () => ops.push("arc"),
    fill: () => ops.push("fill"),
    setLineDash: (segments: number[]) => ops.push(`dash:${segments.join(",")}`),
  } as unknown as CanvasRenderingContext2D;
}

describe("renderDrawings", () => {
  it("does not paint or hit a stroke across an unresolved interior anchor", () => {
    const item = Drawing.create("freehand", [
      { time: 1, price: 20 },
      { time: 2, price: 50 },
      { time: 1, price: 80 },
    ]);
    const context = {
      coord: createCartesian2D(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: { min: 0, max: 1 }, y: { right: { min: 0, max: 100 } } },
        "right",
      ),
      // A one-bar timeline can resolve both endpoints, but not the interior time.
      data: [{ time: 1 }],
      xPositions: [0],
      xFn: (i: number) => i * 100,
      visibleRange: { from: 0, to: 2 },
      area: { x: 0, y: 0, width: 100, height: 100 },
    };
    const operations: string[] = [];
    const canvas = createCanvasContext(operations);
    const state = { ...Drawing.createState(), items: [item] };
    renderDrawings(canvas, state, context);
    expect(operations).toEqual([]);
    expect(
      hitTestDrawings(state, { ...context, mouse: { x: 50, y: 50 } }, canvas),
    ).toBeNull();
  });
  it("publishes centred, sloped placements only for resolved visible saved drawings", () => {
    const item = Schema.decodeUnknownSync(Drawing.LineItem)({
      id: "line",
      type: "extended_line",
      anchors: [
        { time: 1, price: 20 },
        { time: 2, price: 80 },
      ],
    });
    const labels = new Map<string, readonly LineLabelPlacement[]>();
    renderDrawings(
      createCanvasContext([]),
      {
        ...Drawing.createState(),
        items: [
          item,
          { ...item, id: "hidden", hidden: true },
          {
            ...item,
            id: "unresolved",
            anchors: [
              { time: NaN, price: 20 },
              { time: 2, price: 80 },
            ],
          },
        ],
        draft: { ...item, id: "draft" },
      },
      {
        coord: createCartesian2D(
          { x: 0, y: 0, width: 100, height: 100 },
          { x: { min: 0, max: 1 }, y: { right: { min: 0, max: 100 } } },
          "right",
        ),
        data: [{ time: 1 }, { time: 2 }],
        xPositions: [0, 100],
        xFn: (i) => i * 100,
        visibleRange: { from: 0, to: 2 },
        area: { x: 10, y: 10, width: 80, height: 80 },
      },
      labels,
    );
    expect([...labels.keys()]).toEqual(["line"]);
    expect(labels.get("line")![0]).toMatchObject({ x: 50, y: 50 });
    expect(labels.get("line")![0]!.angle).toBeCloseTo(-30.9637565);
  });
  it("clips drawing items to the supplied render area", () => {
    const ops: string[] = [];
    const coord = createCartesian2D(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: { min: 0, max: 1 }, y: { right: { min: 0, max: 100 } } },
      "right",
    );
    const item = Schema.decodeUnknownSync(Drawing.Item)({
      id: "trend",
      type: "trend_line",
      anchors: [
        { time: 1, price: 50, axisId: "right" },
        { time: 2, price: 50, axisId: "right" },
      ],
      style: { lineColor: "#ffffff", textColor: "#ffffff" },
    });

    renderDrawings(
      createCanvasContext(ops),
      { ...Drawing.createState(), items: [item] },
      {
        coord,
        xPositions: [0, 100],
        xFn: (index) => index * 100,
        data: [{ time: 1 }, { time: 2 }],
        visibleRange: { from: 0, to: 2 },
        area: { x: 10, y: 20, width: 80, height: 40 },
      },
    );

    expect(ops).toContain("rect:10:20:80:40");
    expect(ops.indexOf("clip")).toBeLessThan(ops.indexOf("lineTo:100:50"));
  });
});

it("centres on plot X rather than anchor midpoint and keeps reversed lines readable", () => {
  const item = Drawing.create("extended_line", [
    { time: 1, price: 1 },
    { time: 2, price: 2 },
  ]);
  const area = { x: 10, y: 0, width: 80, height: 100 };
  for (const points of [
    [
      { x: 20, y: 80 },
      { x: 70, y: 30 },
    ],
    [
      { x: 70, y: 30 },
      { x: 20, y: 80 },
    ],
  ]) {
    const [label] = lineLabelPlacements(item, points, area);
    expect(label).toMatchObject({ x: 50, y: 50 });
    expect(label!.angle).toBeCloseTo(-45);
  }
});

it("constrains finite/ray placement to visible bounds and publishes both channel edges", () => {
  const anchors = [
    { time: 1, price: 1 },
    { time: 2, price: 2 },
  ];
  const area = { x: 0, y: 0, width: 100, height: 100 };
  expect(
    lineLabelPlacements(
      Drawing.create("trend_line", anchors),
      [
        { x: 10, y: 10 },
        { x: 30, y: 30 },
      ],
      area,
    ),
  ).toEqual([{ x: 30, y: 30, angle: 45 }]);
  expect(
    lineLabelPlacements(
      Drawing.create("ray", anchors),
      [
        { x: 30, y: 30 },
        { x: 20, y: 20 },
      ],
      area,
    ),
  ).toEqual([{ x: 30, y: 30, angle: 45 }]);
  expect(
    lineLabelPlacements(
      Drawing.create("horizontal_line", anchors.slice(0, 1)),
      [{ x: 70, y: 20 }],
      area,
    ),
  ).toEqual([{ x: 50, y: 20, angle: 0 }]);
  expect(
    lineLabelPlacements(
      Drawing.create("parallel_channel", [...anchors, { time: 3, price: 3 }]),
      [
        { x: 10, y: 20 },
        { x: 90, y: 20 },
        { x: 30, y: 70 },
      ],
      area,
    ),
  ).toEqual([
    { x: 50, y: 20, angle: 0 },
    { x: 50, y: 70, angle: 0 },
  ]);
  expect(
    lineLabelPlacements(
      Drawing.create("horizontal_line", anchors.slice(0, 1)),
      [{ x: 70, y: 120 }],
      area,
    ),
  ).toEqual([]);
});

it("centres Fibonacci pills on every visible ratio, with the channel's painted angle", () => {
  const area = { x: 0, y: 0, width: 100, height: 100 };
  const anchors = [
    { time: 1, price: 20 },
    { time: 2, price: 80 },
  ];
  const retracement = Drawing.create("fib_retracement", anchors);
  expect(
    lineLabelPlacements(
      retracement,
      [
        { x: 20, y: 20 },
        { x: 80, y: 80 },
      ],
      area,
    ),
  ).toEqual(
    FIB_RETRACEMENT_LEVELS.map((ratio) => ({
      x: 50,
      y: 20 + 60 * ratio,
      angle: 0,
    })),
  );
  // The pill stays on the ray when both handles are to the right of the plot centre.
  expect(
    lineLabelPlacements(
      retracement,
      [
        { x: 60, y: 20 },
        { x: 80, y: 80 },
      ],
      area,
    )[0]?.x,
  ).toBe(60);
  const points = [
    { x: 20, y: 20 },
    { x: 80, y: 40 },
    { x: 20, y: 60 },
  ];
  const placements = lineLabelPlacements(
    Drawing.create("fib_channel", [...anchors, { time: 3, price: 40 }]),
    points,
    area,
  );
  const offset = offsetFromLine(points[0]!, points[1]!, points[2]!);
  expect(placements).toHaveLength(FIB_CHANNEL_LEVELS.length);
  FIB_CHANNEL_LEVELS.forEach((ratio, index) => {
    expect(placements[index]!.x).toBe(50);
    expect(placements[index]!.y).toBeCloseTo(
      20 + offset.y * ratio + (50 - 20 - offset.x * ratio) / 3,
    );
    expect(placements[index]!.angle).toBeCloseTo(
      (Math.atan2(20, 60) * 180) / Math.PI,
    );
  });
});

it.each(["freehand", "polyline", "curved_line"] as const)(
  "%s paints and hits saved future anchors after reload, pan/zoom and new bars",
  (kind) => {
    const anchors = [
      { time: 1, price: 20 },
      { time: 3, price: 80 },
      { time: 4, price: 40 },
    ];
    const item = Schema.decodeUnknownSync(Drawing.SavedItem)(
      JSON.parse(JSON.stringify(Drawing.create(kind, anchors))),
    );
    const area = { x: 0, y: 0, width: 200, height: 100 };
    const context = {
      coord: createCartesian2D(
        area,
        { x: { min: 0, max: 1 }, y: { right: { min: 0, max: 100 } } },
        "right",
      ),
      data: [{ time: 1 }, { time: 2 }],
      xPositions: [20, 40],
      xFn: (index: number) => (index < 2 ? 20 + index * 20 : Number.NaN),
      visibleRange: { from: 0, to: 2 },
      area,
    };
    expect(
      item.anchors.map((anchor) => anchorToPoint(anchor, context)?.x),
    ).toEqual([20, 60, 80]);
    const operations: string[] = [];
    const canvas = createCanvasContext(operations);
    const input = { ...Drawing.createState(), items: [item] };
    renderDrawings(canvas, input, context);
    expect(operations).toContain(
      kind === "curved_line" ? "curve:60:20:80:60" : "lineTo:80:60",
    );
    expect(
      hitTestDrawings(input, { ...context, mouse: { x: 80, y: 60 } }, canvas)
        ?.id,
    ).toBe(item.id);
    const loaded = {
      ...context,
      data: [{ time: 1 }, { time: 2 }, { time: 3 }, { time: 4 }],
      xPositions: [],
      xFn: (index: number) => 20 + index * 20,
    };
    expect(anchorToPoint(item.anchors[2]!, loaded)?.x).toBe(80);
    const zoomed = {
      ...context,
      xPositions: [],
      xFn: (index: number) => 50 + index * 40,
    };
    expect(anchorToPoint(item.anchors[2]!, zoomed)?.x).toBe(170);
    expect(item.anchors).toEqual(anchors);
  },
);

it.each([
  "freehand",
  "polyline",
  "rectangle",
  "triangle",
  "curved_line",
] as const)(
  "%s keeps future fractional anchors at the same pixel when their bars arrive",
  (kind) => {
    const start = 1_700_000_000;
    const item = Drawing.create(kind, [
      { time: start + 15, price: 20 },
      { time: start + 66, price: 80 },
      ...(kind === "curved_line" ? [{ time: start + 105, price: 40 }] : []),
    ]);
    const area = { x: 0, y: 0, width: 100, height: 100 };
    const context = {
      coord: createCartesian2D(
        area,
        { x: { min: 0, max: 1 }, y: { right: { min: 0, max: 100 } } },
        "right",
      ),
      data: [{ time: start }, { time: start + 60 }],
      xPositions: [20, 40],
      xFn: (i: number) => 20 + i * 20,
      visibleRange: { from: 0, to: 3 },
      area,
    };
    const loaded = {
      ...context,
      data: [...context.data, { time: start + 120 }],
      xPositions: [20, 40, 60],
    };
    const before: string[] = [];
    const after: string[] = [];
    const input = { ...Drawing.createState(), items: [item] };
    renderDrawings(createCanvasContext(before), input, context);
    renderDrawings(createCanvasContext(after), input, loaded);
    expect(after).toEqual(before);
    expect(anchorToPoint(item.anchors[1]!, context, kind)?.x).toBeCloseTo(42);
    expect(anchorToPoint(item.anchors[1]!, loaded, kind)?.x).toBeCloseTo(42);
    expect(handlePoints(item, loaded)).toEqual(handlePoints(item, context));
    const first = anchorToPoint(item.anchors[0]!, loaded, kind)!;
    expect(
      hitTestDrawings(
        input,
        { ...loaded, mouse: first },
        createCanvasContext([]),
      )?.id,
    ).toBe(item.id);
    // Legacy line/channel/Fibonacci callers keep nearest-bar placement.
    expect(anchorToPoint(item.anchors[1]!, loaded, "trend_line")?.x).toBe(40);
    expect(anchorToPoint(item.anchors[1]!, loaded, "fib_retracement")?.x).toBe(
      40,
    );
  },
);

it("maps each loaded interval continuously across gaps and preserves fractional seconds", () => {
  const start = 1_700_000_000;
  const data = [{ time: start }, { time: start + 60 }, { time: start + 180 }];
  expect(continuousIndexFromTime(data, start + 30)).toBe(0.5);
  expect(continuousIndexFromTime(data, start + 90)).toBe(1.25);
  expect(continuousIndexFromTime(data, start + 210)).toBe(2.25);
  expect(continuousIndexFromTime(data, start - 15)).toBe(-0.25);
  expect(continuousIndexFromTime(data, start + 60.00025)).toBeCloseTo(
    1 + 0.00025 / 120,
    8,
  );
  expect(continuousIndexFromTime(data, start + 90)).toBe(1.25);
  expect(continuousIndexFromTime([{ time: start }], start)).toBe(0);
  expect(continuousIndexFromTime([{ time: start }], start + 1)).toBeNull();
  expect(
    continuousIndexFromTime([{ time: start }, { time: start }], start + 1),
  ).toBeNull();
});

it("extrapolates fractional margin times without inventing an edge cadence", () => {
  const start = Date.UTC(2026, 8, 21) / 1000;
  const context = {
    coord: createCartesian2D(
      { x: 0, y: 0, width: 200, height: 100 },
      { x: { min: 0, max: 1 }, y: { right: { min: 0, max: 100 } } },
      "right",
    ),
    data: [{ time: start }, { time: start + 86400 }],
    xPositions: [20, 40],
    xFn: (i: number) => 20 + i * 20,
    visibleRange: { from: 0, to: 2 },
    area: { x: 0, y: 0, width: 200, height: 100 },
  };
  for (const time of [start + 216000]) {
    expect(anchorToPoint({ time, price: 50 }, context)?.x).toBe(70);
  }
  expect(
    anchorToPoint({ time: Date.UTC(2026, 8, 24) / 1000, price: 50 }, context)
      ?.x,
  ).toBe(80);
  expect(anchorToPoint({ time: start - 43200, price: 50 }, context)?.x).toBe(
    10,
  );
  for (const data of [
    [],
    [{ time: start }],
    [{ time: start }, { time: start }],
    [{ time: "bad" }, { time: start }],
  ]) {
    expect(
      anchorToPoint({ time: start + 86400, price: 50 }, { ...context, data }),
    ).toBeNull();
  }
});

describe("indexFromTime", () => {
  // Daily bars keyed at midnight ET (epoch seconds), like US equity charts.
  const etMidnightBars = [
    { time: 1672894800 }, // 2023-01-05 00:00 ET
    { time: 1672981200 }, // 2023-01-06 00:00 ET
    { time: 1673240400 }, // 2023-01-09 00:00 ET
  ];

  it("resolves an exact numeric bar time", () => {
    expect(DrawingRenderUtils.indexFromTime(etMidnightBars, 1672981200)).toBe(
      1,
    );
  });

  it("snaps a numeric anchor to the nearest bar when no bar matches exactly", () => {
    // 2023-01-06 00:00 UTC — five hours before the 2023-01-06 ET bar. Agent
    // drawing anchors are persisted at UTC midnight; the chart timeline is
    // keyed at exchange midnight, so exact equality never holds.
    expect(DrawingRenderUtils.indexFromTime(etMidnightBars, 1672963200)).toBe(
      1,
    );
  });

  it("does not reinterpret date objects, strings or milliseconds", () => {
    for (const time of [
      "2023-01-06",
      { year: 2023, month: 1, day: 6 },
      1672963200000,
    ])
      expect(DrawingRenderUtils.indexFromTime(etMidnightBars, time)).toBeNull();
  });

  it("returns null for anchors outside the loaded data range instead of clamping", () => {
    expect(
      DrawingRenderUtils.indexFromTime(etMidnightBars, 1672790400),
    ).toBeNull(); // 2023-01-04 00:00 UTC — before the first bar
    expect(
      DrawingRenderUtils.indexFromTime(etMidnightBars, 1673500000),
    ).toBeNull(); // after the last bar
  });
});
