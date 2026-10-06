// Purpose: Execute drawing-derived Tea against the renderer's ordinal geometry and edge policies.
import {
  indexFromTime,
  offsetFromLine,
  FIB_CHANNEL_LEVELS,
  FIB_RETRACEMENT_LEVELS,
} from "@openchart/chart-core/drawing/geometry";
import { Drawing } from "@openchart/chart-core/drawing/types";
import { BarsSeries } from "@openchart/feed";
import type { DrawingAlertDefinition } from "@openchart/server/resources/alert-rule/schema";
import { DrawingEntity, DrawingId } from "@openchart/server/resources/drawing";
import * as Tea from "@openchart/tea";
import {
  Bool,
  Field,
  Float64,
  Schema as ArrowSchema,
  TimestampMillisecond,
} from "apache-arrow";
import { Schema } from "effect";
import { of } from "rxjs";
import {
  createNode,
  DataStream,
  pineBuiltinSupplier,
  tea,
  type Datum,
} from "tea";
import { expect, test } from "vitest";

import { drawingTeaDefinition } from "./drawing-alerts";

const day = 86_400_000;
const start = Date.UTC(2026, 8, 18); // Friday, followed by a weekend gap.
const times = [0, 3, 4, 5, 6, 7, 10].map((offset) => start + offset * day);
const inputs = Schema.decodeUnknownSync(BarsSeries)({
  provider: "binance",
  listing: { symbol: "BTCUSDT", currency: "USDT" },
  resolution: "1d",
  session: "regular",
  adjustment: "raw",
});
const schema = new ArrowSchema([
  new Field("time", new TimestampMillisecond(), false),
  new Field("close", new Float64(), false),
  new Field("high", new Float64(), false),
  new Field("low", new Float64(), false),
  new Field("provisional", new Bool(), false),
]);
const anchor = (index: number, price: number): Drawing.Anchor => ({
  time: times[index]! / 1000,
  price,
});
const drawing = (type: Drawing.Type, anchors: Drawing.Anchor[]) =>
  Schema.decodeUnknownSync(DrawingEntity)({
    id: DrawingId.create(),
    revision: 1,
    createdAt: start,
    updatedAt: start,
    dashboardId: "dashboard",
    provider: inputs.provider,
    listing: inputs.listing,
    data: Drawing.create(type, anchors),
  });
const definition = (
  item: DrawingEntity,
  operator: DrawingAlertDefinition["operator"] = "crossing",
): DrawingAlertDefinition => ({
  kind: "drawing",
  drawingId: item.id,
  operator,
  inputs,
});

test("a drawing alert requires the same native listing ID even when symbols match", () => {
  const original = drawing("horizontal_line", [anchor(0, 100)]);
  const item = { ...original, listing: { ...original.listing, id: 10244 } };
  const rule = definition(item);
  expect(() =>
    drawingTeaDefinition(item, {
      ...rule,
      inputs: { ...inputs, listing: { ...item.listing, id: 55090 } },
    }),
  ).toThrow("same drawing and market");
  expect(() =>
    drawingTeaDefinition(item, {
      ...rule,
      inputs: {
        ...inputs,
        listing: {
          ...item.listing,
          name: "Updated metadata",
          symbol: "RENAMED",
        },
      },
    }),
  ).not.toThrow();
});
type Sample = {
  time: number;
  close: number;
  high?: number;
  low?: number;
  provisional?: boolean;
};
function evaluate(
  item: DrawingEntity,
  samples: Sample[],
  operator: DrawingAlertDefinition["operator"] = "crossing",
) {
  const generated = drawingTeaDefinition(item, definition(item, operator));
  const template = tea`${generated.source}`;
  const node = createNode(
    template.module.bind(generated.config.parameters),
    pineBuiltinSupplier(() => times.at(-1)!),
  ).bind(
    new DataStream(
      schema,
      of(
        ...samples.map((sample) => ({
          provisional: false,
          high: sample.close,
          low: sample.close,
          ...sample,
        })),
      ),
    ),
  );
  const rows: Datum[] = [];
  const errors: unknown[] = [];
  try {
    expect(Tea.teaAlertOutputs(node.module.outputs.schema)).toEqual(["alert"]);
    node.to({
      next: (row) => rows.push(row),
      error: (error) => errors.push(error),
    });
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(samples.length);
    return rows;
  } finally {
    node.dispose();
    template.dispose();
  }
}
const samples = (prices: number[], timeline = times) =>
  prices.map((close, index) => ({ time: timeline[index]!, close }));
const fires = (rows: Datum[]) =>
  rows.map((row) => (row.alert as unknown[]).length > 0);

test.each([
  "horizontal_line",
  "horizontal_ray",
  "trend_line",
  "ray",
  "extended_line",
  "parallel_channel",
  "fib_retracement",
  "fib_channel",
  "freehand",
  "polyline",
  "rectangle",
  "triangle",
  "curved_line",
] as const)(
  "%s survives dense provisional updates without missing or duplicating confirmed fires",
  (kind) => {
    const minute = 60_000;
    const point = (index: number, price: number) => ({
      time: (start + index * minute) / 1000,
      price,
    });
    const horizontal = kind === "horizontal_line" || kind === "horizontal_ray";
    const channel = kind === "parallel_channel" || kind === "fib_channel";
    const path = [
      "freehand",
      "polyline",
      "rectangle",
      "triangle",
      "curved_line",
    ].includes(kind);
    const anchors = horizontal
      ? [point(0, 100)]
      : channel
        ? [point(0, 90), point(200, 90), point(100, 110)]
        : kind === "curved_line" || kind === "polyline"
          ? [point(0, 90), point(100, 110), point(200, 90)]
          : [point(0, 90), point(200, 110)];
    const item = drawing(kind, anchors);
    const operators: DrawingAlertDefinition["operator"][] =
      kind === "parallel_channel"
        ? [
            "entering_channel",
            "exiting_channel",
            "inside_channel",
            "outside_channel",
          ]
        : path
          ? ["crossing", "touching"]
          : ["crossing", "crossing_up", "crossing_down"];
    for (const operator of operators) {
      const data: Sample[] = [
        { time: start, close: 80 },
        { time: start + minute, close: 80 },
      ];
      // Pure Tea also evaluates history; TeaAlerts separately suppresses snapshot fires.
      const expected = [false, operator === "outside_channel"];
      let previous = 80;
      for (let bar = 2; bar < 66; bar++) {
        const time = start + bar * minute;
        // Each confirmed bar is preceded by ten attempts crossing both sides.
        for (let tick = 0; tick < 10; tick++) {
          data.push({
            time,
            close: tick % 2 ? 120 : 80,
            high: 130,
            low: 70,
            provisional: true,
          });
          expected.push(false);
        }
        const close =
          kind === "parallel_channel"
            ? [100, 120, 100, 80][(bar - 2) % 4]!
            : bar % 2
              ? 80
              : 120;
        data.push({ time, close, high: 130, low: 70 });
        expected.push(
          operator === "entering_channel"
            ? close === 100 && previous !== 100
            : operator === "exiting_channel"
              ? close !== 100 && previous === 100
              : operator === "inside_channel"
                ? close === 100
                : operator === "outside_channel"
                  ? close !== 100
                  : operator === "crossing_up"
                    ? close > previous
                    : operator === "crossing_down"
                      ? close < previous
                      : true,
        );
        previous = close;
      }
      const rows = evaluate(item, data, operator);
      expect(fires(rows), `${kind}/${operator}`).toEqual(expected);
      expect(rows.every((row) => (row.alert as unknown[]).length <= 1)).toBe(
        true,
      );
      // The same geometry must not produce positives on a wholly disjoint path.
      if (!operator.endsWith("_channel")) {
        expect(
          fires(
            evaluate(
              item,
              data.map((row) => ({ ...row, close: 200, low: 199, high: 201 })),
              operator,
            ),
          ),
        ).toEqual(data.map(() => false));
      }
    }
  },
  30_000,
);

test.each([
  "freehand",
  "polyline",
  "rectangle",
  "triangle",
  "curved_line",
] as const)(
  "%s emits one confirmed occurrence with recorded contacts for Crossing and Touch",
  (kind) => {
    const anchors =
      kind === "polyline" || kind === "curved_line"
        ? [anchor(0, 100), anchor(3, 130), anchor(6, 100)]
        : kind === "freehand"
          ? [anchor(0, 100), anchor(6, 100)]
          : [anchor(0, 90), anchor(6, 150)];
    const item = drawing(kind, anchors);
    for (const operator of ["crossing", "touching"] as const) {
      const data =
        operator === "crossing"
          ? samples([50, 50, 50, 170, 170, 170, 170])
          : samples([50, 50, 50, 120, 50, 50, 50]).map((row, index) =>
              index === 3 ? { ...row, low: 50, high: 170 } : row,
            );
      const rows = evaluate(
        item,
        [
          ...data.slice(0, 3),
          { ...data[3]!, provisional: true },
          data[3]!,
          ...data.slice(4),
        ],
        operator,
      );
      expect(fires(rows)).toEqual([
        false,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
      ]);
      const hits = rows[4]!.alert as {
        data: {
          observation: string;
          contacts: { primitiveIndex: number; price: number; time: number }[];
        };
      }[];
      expect(hits).toHaveLength(1);
      expect(hits[0]!.data.observation).toBe(
        operator === "crossing" ? "confirmed_close" : "confirmed_range",
      );
      expect(hits[0]!.data.contacts.length).toBeGreaterThan(0);
      expect(
        hits[0]!.data.contacts.every(
          (contact) =>
            Number.isFinite(contact.price) && Number.isFinite(contact.time),
        ),
      ).toBe(true);
    }
  },
);

test("path Crossing excludes boundary travel and corner grazes, while Touch includes overlap", () => {
  const item = drawing("rectangle", [anchor(0, 100), anchor(1, 110)]);
  expect(fires(evaluate(item, samples([100, 100]), "crossing"))).toEqual([
    false,
    false,
  ]);
  expect(fires(evaluate(item, samples([100, 100]), "touching"))).toEqual([
    false,
    true,
  ]);
  const open = drawing("polyline", [
    anchor(0, 100),
    anchor(1, 100),
    anchor(1, 110),
  ]);
  expect(fires(evaluate(open, samples([100, 100]), "crossing"))).toEqual([
    false,
    false,
  ]);
  const v = drawing("polyline", [
    { time: times[0]! / 1000, price: 110 },
    { time: (times[0]! + times[1]!) / 2000, price: 100 },
    { time: times[1]! / 1000, price: 110 },
  ]);
  expect(fires(evaluate(v, samples([100, 100]), "crossing"))).toEqual([
    false,
    false,
  ]);
});

test("Touch skips missing closes and unsupported geometry fails at authoring", () => {
  const item = drawing("freehand", [anchor(0, 100), anchor(6, 100)]);
  const rows = evaluate(
    item,
    [
      { time: times[0]!, close: 90 },
      { time: times[1]!, close: NaN, low: 90, high: 110 },
    ],
    "touching",
  );
  expect(fires(rows)).toEqual([false, false]);
  for (const price of [1e-80, 1e71]) {
    const unsupported = drawing("freehand", [
      anchor(0, price),
      anchor(1, price),
    ]);
    expect(() =>
      drawingTeaDefinition(unsupported, definition(unsupported)),
    ).toThrow(/Float64/);
  }
  const large = drawing("freehand", [anchor(0, 1e21), anchor(1, 1e21)]);
  expect(fires(evaluate(large, samples([1e21 - 1e10, 1e21 + 1e10])))).toEqual([
    false,
    true,
  ]);
});

test("Touch covers a whole ordinal candle slot, including an enclosed stroke and the half-slot edge", () => {
  const minute = 60_000;
  const timeline = [start, start + minute, start + 2 * minute];
  const point = (x: number, price: number) => ({
    time: (start + x * minute) / 1000,
    price,
  });
  const data = samples([100, 100, 100], timeline).map((row) => ({
    ...row,
    low: 90,
    high: 110,
  }));
  for (const x of [1.25, 1.5]) {
    const vertical = drawing("freehand", [point(x, 95), point(x, 105)]);
    const rows = evaluate(
      vertical,
      [data[0]!, { ...data[1]!, provisional: true }, data[1]!],
      "touching",
    );
    expect(fires(rows)).toEqual([false, false, true]);
    const event = (
      rows[2]!.alert as {
        data: { contacts: { time: number; price: number }[] };
      }[]
    )[0]!;
    expect(event.data.contacts[0]!.time).toBeCloseTo(start + x * minute, 2);
    expect(event.data.contacts[0]!.price).toBeGreaterThanOrEqual(90);
    expect(event.data.contacts[0]!.price).toBeLessThanOrEqual(110);
  }
  const outside = drawing("freehand", [point(1.5001, 95), point(1.5001, 105)]);
  expect(fires(evaluate(outside, data.slice(0, 2), "touching"))).toEqual([
    false,
    false,
  ]);
  const curve = drawing("curved_line", [
    point(0.6, 95),
    point(1.0, 105),
    point(1.4, 95),
  ]);
  expect(fires(evaluate(curve, data.slice(0, 2), "touching"))).toEqual([
    false,
    true,
  ]);
});

test("the reported pencil near-miss touches the candle rectangle away from its centre", () => {
  // Actual saved stroke segment and Binance 1m OHLC from 2026-09-24.
  // At 17:15 the centre misses by 0.2495, but the sloping boundary enters the slot.
  const item = drawing("freehand", [
    { time: 1790270124, price: 84466.28500585025 },
    { time: 1790270100, price: 84478.25949882995 },
  ]);
  const rows = evaluate(
    item,
    [
      { time: 1790270040000, close: 84478, low: 84424.01, high: 84484.04 },
      { time: 1790270100000, close: 84440.01, low: 84418, high: 84478.01 },
    ],
    "touching",
  );
  expect(fires(rows)).toEqual([false, true]);
  const event = (
    rows[1]!.alert as {
      data: { contacts: { time: number; price: number }[] };
    }[]
  )[0]!;
  expect(event.data.contacts[0]!.price).toBe(84478.01);
  expect(event.data.contacts[0]!.time).toBeGreaterThan(1790270100000);
  expect(event.data.contacts[0]!.time).toBeLessThan(1790270130000);
});

test("future-only paths are ready after two bars and retain fractional-millisecond anchors", () => {
  const item = drawing("freehand", [
    { time: (times.at(-1)! + day + 0.25) / 1000, price: 100 },
    { time: (times.at(-1)! + day * 2 + 0.75) / 1000, price: 110 },
  ]);
  const rows = evaluate(item, samples([90, 100, 110, 120, 130, 140, 150]));
  expect(rows[0]!.ready).toBe(0);
  expect(rows.slice(1).every((row) => row.ready === 1)).toBe(true);
  expect(fires(rows).some(Boolean)).toBe(false);
});

test("fractional future boundary keeps its position when the next bar arrives", () => {
  const minute = 60_000;
  const timeline = [0, 1, 2, 3].map((index) => start + index * minute);
  const item = drawing("freehand", [
    { time: (start + 1.1 * minute) / 1000, price: 90 },
    { time: (start + 1.1 * minute) / 1000, price: 110 },
  ]);
  const rows = evaluate(item, samples([100, 100, 100, 100], timeline));
  expect(fires(rows)).toEqual([false, false, true, false]);
  const event = (
    rows[2]!.alert as {
      data: { contacts: { time: number; price: number }[] };
    }[]
  )[0]!;
  expect(event.data.contacts[0]!.time).toBeCloseTo(start + 1.1 * minute, 2);
  expect(event.data.contacts[0]!.price).toBe(100);
});

test("oversized strokes fail before compiling without dropping points", () => {
  const item = drawing(
    "freehand",
    Array.from({ length: 1001 }, (_, index) => ({
      time: (start + index * 60_000) / 1000,
      price: 100,
    })),
  );
  expect(() => drawingTeaDefinition(item, definition(item))).toThrow(
    /up to 1,000 points/,
  );
});

test.each(["fib_retracement", "fib_channel"] as const)(
  "%s crosses any painted ratio, recording every crossed boundary in one confirmed occurrence",
  (kind) => {
    const channel = kind === "fib_channel";
    const item = drawing(
      kind,
      channel
        ? [anchor(0, 100), anchor(1, 110), anchor(0, 200)]
        : [anchor(0, 100), anchor(1, 200)],
    );
    const slope = channel ? 10 : 0;
    const data = samples(
      [100, 100, 120, 150, 185, 130, 250].map(
        (price, index) => price + slope * index,
      ),
    );
    for (const [operator, expected] of [
      ["crossing", [false, false, false, true, true, true, true]],
      ["crossing_up", [false, false, false, true, true, false, true]],
      ["crossing_down", [false, false, false, false, false, true, false]],
    ] as const) {
      const rows = evaluate(item, data, operator);
      expect(fires(rows)).toEqual(expected);
      expect((rows[3]!.alert as unknown[]).length).toBe(
        operator === "crossing_down" ? 0 : 1,
      );
      if (operator !== "crossing_down") {
        const crossed = Object.entries(rows[3]!).filter(
          ([key, price]) =>
            key.startsWith("crossed_level_") && Number.isFinite(price),
        );
        expect(crossed).toEqual(
          channel
            ? [["crossed_level_0.382", 168.2]]
            : [
                ["crossed_level_0.236", 123.6],
                ["crossed_level_0.382", 138.2],
                ["crossed_level_0.5", 150],
              ],
        );
      }
    }
    const provisional = evaluate(item, [
      ...data.slice(0, 3),
      { ...data[3]!, provisional: true },
      data[3]!,
    ]);
    expect(fires(provisional)).toEqual([false, false, false, false, true]);
  },
);

test.each(["fib_retracement", "fib_channel"] as const)(
  "%s keeps reversed prices and moved anchors tied to renderer geometry",
  (kind) => {
    const channel = kind === "fib_channel";
    const item = drawing(
      kind,
      channel
        ? [anchor(1, 190), anchor(0, 200), anchor(0, 100)]
        : [anchor(1, 100), anchor(0, 200)],
    );
    const ratios = channel ? FIB_CHANNEL_LEVELS : FIB_RETRACEMENT_LEVELS;
    // Jump across every level; moving only the offset anchor updates their prices.
    const data = samples([300, 300, 0, 300, 0, 300, 0]);
    const rows = evaluate(item, data, "crossing_down");
    expect(rows[2]!.alert as unknown[]).toHaveLength(1);
    for (const ratio of ratios) {
      const first = item.data.anchors[0]!;
      const second = item.data.anchors[1]!;
      const projected = channel
        ? 180 - 100 * ratio
        : first.price + (second.price - first.price) * ratio;
      expect(rows[2]![`crossed_level_${ratio}`]).toBeCloseTo(projected);
    }
    const moved = drawing(
      kind,
      channel
        ? [anchor(1, 190), anchor(0, 200), anchor(0, 150)]
        : [anchor(1, 150), anchor(0, 200)],
    );
    expect(
      evaluate(moved, data, "crossing_down")[2]!["crossed_level_0.618"],
    ).not.toBe(rows[2]!["crossed_level_0.618"]);
    expect(() =>
      drawingTeaDefinition(item, definition(item, "inside_channel")),
    ).toThrow(/condition/);
  },
);

test("Fibonacci geometry requires complete, noncollapsed anchors and respects the retracement's left edge", () => {
  const data = samples([50, 250, 50, 250, 50, 250, 50]);
  expect(() =>
    drawing("fib_retracement", [anchor(0, 100), anchor(1, 100)]),
  ).toThrow(/distinct first and second prices/);
  for (const item of [
    drawing("fib_channel", [anchor(0, 100), anchor(1, 110), anchor(2, 120)]),
  ]) {
    const rows = evaluate(item, data);
    expect(rows.at(-1)!.ready).toBe(0);
    expect(fires(rows).at(-1)).toBe(false);
  }
  const sameTime = drawing("fib_retracement", [anchor(2, 100), anchor(2, 200)]);
  expect(fires(evaluate(sameTime, data))).toEqual([
    false,
    false,
    false,
    true,
    true,
    true,
    true,
  ]);
  const future = drawing("fib_retracement", [
    anchor(0, 100),
    { time: (times.at(-1)! + day) / 1000, price: 200 },
  ]);
  expect(evaluate(future, data).at(-1)!.ready).toBe(1);
});

test("nearest-bar slope matches the renderer across a weekend, including a midpoint tie", () => {
  const anchors = [
    { time: (start + 1.5 * day) / 1000, price: 100 },
    { time: times[2]! / 1000, price: 120 },
  ];
  const item = drawing("extended_line", anchors);
  const rows = evaluate(item, samples([90, 100, 110, 130, 140, 160, 150]));
  const points = times.map((time) => ({ time: time / 1000 }));
  const first = indexFromTime(points, anchors[0]!.time)!;
  const second = indexFromTime(points, anchors[1]!.time)!;
  expect(first).toBe(0);
  expect(second).toBe(2);
  for (let index = 2; index < times.length; index++) {
    expect(rows[index]!.ready).toBe(1);
    expect(rows[index]!.level).toBe(
      100 + (20 * (index - first)) / (second - first),
    );
  }
  expect(fires(rows)).toEqual([false, false, false, true, false, false, true]);
});

test.each(["trend_line", "ray", "extended_line"] as const)(
  "%s preserves its extent when anchors point backwards",
  (kind) => {
    const item = drawing(kind, [anchor(4, 140), anchor(1, 110)]);
    // Geometry becomes known at q=4. A leftward ray/segment cannot cross at q=5.
    const rows = evaluate(item, samples([90, 100, 110, 120, 130, 150, 170]));
    expect(rows[5]!.level).toBe(150);
    expect(fires(rows)[5]).toBe(kind === "extended_line");
  },
);

test("channel projection agrees with the renderer's perpendicular translation", () => {
  const item = drawing("parallel_channel", [
    anchor(0, 100),
    anchor(2, 120),
    anchor(1, 140),
  ]);
  const rows = evaluate(
    item,
    samples([90, 90, 110, 130, 171, 180, 150]),
    "entering_channel",
  );
  const first = { x: 0, y: 100 };
  const second = { x: 2, y: 120 };
  const translation = offsetFromLine(first, second, { x: 1, y: 140 });
  for (let index = 2; index < rows.length; index++) {
    const shifted =
      first.y + translation.y + 10 * (index - first.x - translation.x);
    expect(rows[index]!.lower).toBe(100 + 10 * index);
    expect(Number(rows[index]!.upper)).toBeCloseTo(shifted, 10);
  }
  expect(fires(rows)).toEqual([false, false, false, true, false, true, false]);
});

test.each([
  ["entering_channel", [false, true, false, true, false, false, true]],
  ["exiting_channel", [false, false, true, false, true, false, false]],
  ["inside_channel", [false, false, false, false, false, false, true]],
  ["outside_channel", [false, false, true, false, true, true, false]],
] as const)(
  "%s uses each sample's bounds and preserves equality/jump semantics",
  (op, expected) => {
    const item = drawing("parallel_channel", [
      anchor(0, 100),
      anchor(1, 110),
      anchor(0, 120),
    ]);
    // At q=3 arrive at the lower boundary; q=5 jumps across the entire channel.
    expect(
      fires(evaluate(item, samples([90, 110, 110, 130, 161, 149, 170]), op)),
    ).toEqual(expected);
  },
);

test("horizontal crossings fire once on confirmation and include arrival at the boundary", () => {
  const item = drawing("horizontal_ray", [anchor(0, 100)]);
  const rows = evaluate(item, [
    { time: times[0]!, close: 90 },
    { time: times[1]!, close: 100, provisional: true },
    { time: times[1]!, close: 110, provisional: true },
    { time: times[1]!, close: 100 },
    { time: times[2]!, close: 110 },
  ]);
  expect(fires(rows)).toEqual([false, false, false, true, false]);
});

test.each([
  "extended_line",
  "horizontal_line",
  "parallel_channel",
  "fib_retracement",
  "fib_channel",
] as const)(
  "%s can compare the preceding bar when its final anchor is the current forming bar",
  (kind) => {
    const item = drawing(
      kind,
      kind === "horizontal_line"
        ? [anchor(1, 110)]
        : kind === "parallel_channel" || kind === "fib_channel"
          ? [anchor(0, 100), anchor(1, 110), anchor(1, 130)]
          : [anchor(0, 100), anchor(1, 110)],
    );
    const rows = evaluate(
      item,
      [
        { time: times[0]!, close: 90 },
        { time: times[1]!, close: 109, provisional: true },
        { time: times[1]!, close: 110, provisional: true },
        { time: times[1]!, close: 110 },
      ],
      kind === "parallel_channel" ? "entering_channel" : "crossing_up",
    );
    expect(fires(rows)).toEqual([false, false, false, true]);
    expect(rows[1]!.ready).toBe(1);
    if (kind === "horizontal_line")
      expect(drawingTeaDefinition(item, definition(item)).from).toBeUndefined();
  },
);

test.each(["ray", "extended_line", "horizontal_line"] as const)(
  "%s preserves descending or horizontal boundaries beyond the anchors",
  (kind) => {
    const horizontal = kind === "horizontal_line";
    const item = drawing(
      kind,
      horizontal ? [anchor(0, 100)] : [anchor(0, 100), anchor(1, 90)],
    );
    const rows = evaluate(
      item,
      samples([100, 110, horizontal ? 100 : 80, 100, 100, 100, 100]),
      "crossing_down",
    );
    expect(rows[2]!.level).toBe(horizontal ? 100 : 80);
    expect(fires(rows)[2]).toBe(true);
  },
);

test("restarting with a different history prefix retains old-anchor geometry beyond 1000 bars", () => {
  const timeline = Array.from(
    { length: 1505 },
    (_, index) => start + index * day,
  );
  const item = drawing("extended_line", [
    { time: timeline[2]! / 1000, price: 100 },
    { time: timeline[4]! / 1000, price: 120 },
  ]);
  const data = samples(
    timeline.map(() => 0),
    timeline,
  );
  const complete = evaluate(item, data);
  const restarted = evaluate(item, data.slice(1));
  expect(complete.at(-1)!.ready).toBe(1);
  expect(complete.at(-1)!.level).toBe(restarted.at(-1)!.level);
  expect(complete.at(-1)!.level).toBe(15_120);
  expect(drawingTeaDefinition(item, definition(item)).from).toBe(timeline[2]);
});

test("unavailable and coincident snapped anchors never become ready", () => {
  const data = samples([90, 100, 110, 120, 130, 140, 150]);
  for (const anchors of [
    [{ time: (start - day) / 1000, price: 100 }, anchor(1, 110)],
    [anchor(1, 100), { time: (times[1]! + 1000) / 1000, price: 110 }],
  ]) {
    const rows = evaluate(drawing("extended_line", anchors), data);
    expect(rows.at(-1)!.ready).toBe(0);
    expect(fires(rows).at(-1)).toBe(false);
  }
  const collapsedChannel = drawing("parallel_channel", [
    anchor(0, 100),
    anchor(1, 110),
    anchor(2, 120),
  ]);
  expect(evaluate(collapsedChannel, data, "inside_channel").at(-1)!.ready).toBe(
    0,
  );
});

test("unsupported geometry, mismatched markets, invalid times and mixed axes fail explicitly", () => {
  const valid = drawing("extended_line", [anchor(0, 100), anchor(1, 110)]);
  expect(() =>
    drawing("extended_line", [{ time: NaN, price: 100 }, anchor(1, 110)]),
  ).toThrow();
  const invalid = [
    { ...valid, data: Drawing.create("circle", valid.data.anchors) },
    {
      ...valid,
      data: Drawing.create("extended_line", [anchor(0, 100), anchor(0, 110)]),
    },
    {
      ...valid,
      data: Drawing.create("extended_line", [
        { ...anchor(0, 100), axisId: "price" },
        { ...anchor(1, 110), axisId: "indicator" },
      ]),
    },
    { ...valid, listing: { ...valid.listing, symbol: "OTHER" } },
  ];
  for (const item of invalid)
    expect(() => drawingTeaDefinition(item, definition(valid))).toThrow(
      Tea.Error,
    );
  expect(() =>
    drawingTeaDefinition(valid, definition(valid, "inside_channel")),
  ).toThrow(/condition/);
});
