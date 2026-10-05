// Purpose: Sampled replacement and alignment retain complete execution attempts.
import { Field, Float64, Schema, Struct, Utf8 } from "apache-arrow";
import { expect, test } from "vitest";
import {
  createDataFrame,
  fromRows,
  type CreateDataFrameOptions,
  type DataFrame,
  type DataFrameRow,
} from "./dataFrame";
import { fromPoints } from "./fromPoints";
import { joinByTime, mergeByTime } from "./join";
import { parseJson, toJson } from "./json";
import { assertCompatible, rebuild } from "./rows";
import { structuredRows, structuredTable } from "./testFrames";

test("replacement replaces the entire append list and alignment preserves existing gaps", () => {
  const original = createDataFrame(structuredTable());
  const update = createDataFrame(
    structuredTable([
      { time: 10, value: 4, events: [{ time: 8, text: "replacement" }] },
    ]),
  );
  const merged = mergeByTime(original, update);
  expect(merged.get(0)).toEqual({
    time: 10,
    value: 4,
    events: [{ time: 8, text: "replacement" }],
  });
  expect(Array.from(original)).toEqual(structuredRows);
  const aligned = joinByTime([5, 10, 15, 20, 30], original);
  expect(Array.from(aligned, (row) => row.value)).toEqual([
    NaN,
    null,
    NaN,
    NaN,
    3,
  ]);
  expect(aligned.get(0)!.events).toBeNull();
  expect(aligned.get(1)!.events).toEqual(structuredRows[0]!.events);
  expect(aligned.schema.fields[2]!.metadata.get("tea:write")).toBe("append");
  expect(joinByTime([15], original, { fill: "hold" }).get(0)!.events).toEqual(
    structuredRows[0]!.events,
  );
});

test("the last fill shows the last row that opened inside each bar", () => {
  const finer = fromPoints({}, [
    { time: 5, value: 0 }, // Before the first bar: shown nowhere.
    { time: 10, value: 1 },
    { time: 15, value: 2 },
    { time: 30, value: 3 },
    { time: 35, value: 4 }, // The last bar takes every later row.
  ]);
  const bars = joinByTime([10, 20, 30], finer, { fill: "last" });
  expect(Array.from(bars, ({ time, value }) => [time, value])).toEqual([
    [10, 2],
    [20, NaN],
    [30, 4],
  ]);
  // Rows on bar times give the exact join's rows, gaps and nested values.
  const onBars = createDataFrame(structuredTable());
  const timeline = [5, 10, 15, 20, 30];
  expect(Array.from(joinByTime(timeline, onBars, { fill: "last" }))).toEqual(
    Array.from(joinByTime(timeline, onBars)),
  );
});

test("sampled operations reject events with duplicate root timestamps", () => {
  const events = fromPoints(
    {},
    [
      { time: 1, value: 1 },
      { time: 1, value: 2 },
    ],
    { allowDuplicateTimes: true },
  );
  expect(() => mergeByTime(events, events)).toThrow("duplicate event");
  expect(() => joinByTime([1], events)).toThrow("duplicate event");
});

/** The previous mergeByTime, which rebuilt every row: the oracle for the tail merge. */
function rebuildAll(frame: DataFrame, update: DataFrame): DataFrame {
  assertCompatible(frame, update);
  for (const input of [frame, update]) {
    const times = Array.from(input, (row) => row.time);
    if (times.some((time, index) => time === times[index - 1]))
      throw new Error(
        "Sampled-row operations do not accept duplicate event timestamps",
      );
  }
  const rows = new Map<number, DataFrameRow>();
  for (const row of frame) rows.set(row.time, row);
  for (const row of update) rows.set(row.time, row);
  return rebuild(
    frame.schema,
    [...rows.values()].sort((a, b) => a.time - b.time),
  );
}

/** The returned frame, or the thrown message, so outcomes compare directly. */
function outcome(merge: () => DataFrame): DataFrame | string {
  try {
    return merge();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Same rows, labels, schema and metadata, also after IPC and through `column()`. */
function expectSameFrame(actual: DataFrame, expected: DataFrame): void {
  assertCompatible(actual, expected);
  const rows = Array.from(expected);
  expect(Array.from(actual)).toEqual(rows);
  expect(Array.from(parseJson(toJson(actual)))).toEqual(rows);
  for (const { name } of expected.schema.fields)
    expect(actual.column(name)).toEqual(rows.map((row) => row[name]));
}

// 300 merges against the oracle; the budget covers a busy machine, not latency.
test("mergeByTime matches rebuilding every row over randomized histories", () => {
  // Seeded (Park-Miller), so a failing history replays exactly.
  let seed = 7;
  const random = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647;
  const below = (limit: number) => Math.floor(random() * limit);
  const base = structuredTable([]).schema;
  // The fixture's list of structs, plus a top-level struct column.
  const schema = new Schema(
    [
      ...base.fields,
      new Field(
        "quote",
        new Struct([
          new Field("bid", new Float64(), true),
          new Field("side", new Utf8(), false),
        ]),
        true,
      ),
    ],
    base.metadata,
  );
  const number = () => [null, NaN, below(1_000) / 10][below(3)]!;
  const row = (time: number) => ({
    time,
    value: number(),
    events:
      below(5) === 0
        ? null
        : Array.from({ length: below(3) }, () => ({
            time: below(100),
            text: below(2) ? "a" : "b",
          })),
    quote: below(5) === 0 ? null : { bid: number(), side: "buy" },
  });
  // Ascending times; event frames occasionally repeat one.
  const times = (from: number, count: number, events: boolean) => {
    let time = from;
    return Array.from({ length: count }, () => {
      const current = time;
      time += events && below(40) === 0 ? 0 : 1 + below(15);
      return current;
    });
  };
  for (let history = 0; history < 30; history++) {
    const events = below(3) === 0;
    const options: CreateDataFrameOptions = {
      labels: { symbol: "AAPL" },
      allowDuplicateTimes: events,
    };
    let frame = fromRows(
      schema,
      times(0, [0, 1, 63, 64, 65, 150][below(6)]!, events).map(row),
      options,
    );
    for (let step = 0; step < 10; step++) {
      const last = frame.numRows ? frame.get(frame.numRows - 1)!.time : 0;
      // Before the start, mid-frame, at the last row, or past the end.
      const starts = [-20, below(last + 1), last, last + 1 + below(20)];
      const from = starts[below(4)]!;
      const count = below(4) === 0 ? 1 + below(80) : 1 + below(4);
      const rows = times(from, count, events).map(row);
      if (rows.length > 1 && rows[0]!.time !== rows.at(-1)!.time)
        expect(() =>
          fromRows(schema, [rows.at(-1)!, ...rows.slice(0, -1)], options),
        ).toThrow(events ? "non-decreasing" : "strictly ascending");
      const variant = below(10);
      const update = fromRows(schema, rows, {
        ...options,
        // Incompatible updates must fail exactly as before.
        ...(variant === 0 ? { labels: { symbol: "OTHER" } } : {}),
        ...(variant === 1 && !events ? { allowDuplicateTimes: true } : {}),
      });
      const expected = outcome(() => rebuildAll(frame, update));
      const actual = outcome(() => mergeByTime(frame, update));
      if (typeof expected === "string") expect(actual).toBe(expected);
      else if (typeof actual === "string") expect.fail(actual);
      else {
        expectSameFrame(actual, expected);
        frame = actual; // Later steps merge into shared storage.
      }
    }
  }
}, 20_000);

test("an empty update returns the frame itself after the usual checks", () => {
  const frame = createDataFrame(structuredTable());
  expect(mergeByTime(frame, createDataFrame(structuredTable([])))).toBe(frame);
  const other = createDataFrame(structuredTable([]), {
    labels: { symbol: "OTHER" },
  });
  expect(() => mergeByTime(frame, other)).toThrow("labels");
});

test("single-row appends add about one Arrow batch per 64 rows", () => {
  let frame = fromPoints(
    {},
    Array.from({ length: 100 }, (_, time) => ({ time, value: time })),
  );
  for (let time = 100; time < 1_100; time++)
    frame = mergeByTime(frame, fromPoints({}, [{ time, value: time }]));
  expect(frame.column("value")).toEqual(
    Array.from({ length: 1_100 }, (_, time) => time),
  );
  // The original batch, 15 full batches of 64 appended rows, and the last 40.
  expect(frame.toArrow().batches.length).toBeLessThanOrEqual(17);
}, 20_000);
