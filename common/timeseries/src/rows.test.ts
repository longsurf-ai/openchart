// Purpose: Every operation must preserve nested fields, metadata and validity.
import { expect, test } from "vitest";
import { createDataFrame } from "./dataFrame";
import { concatFrames, takeRows } from "./rows";
import { structuredRows, structuredTable } from "./testFrames";

const frame = createDataFrame(structuredTable(), {
  labels: { symbol: "AAPL" },
});

test("selection and concatenation preserve schema, append order, null and NaN", () => {
  expect(takeRows(frame, [0, 1, 2])).toBe(frame);
  const first = takeRows(frame, [0, 1]);
  expect(Array.from(first)).toEqual(structuredRows.slice(0, 2));
  expect(first.schema.fields[2]!.metadata.get("tea:write")).toBe("append");
  const last = takeRows(frame, [2]);
  expect(Array.from(last)).toEqual(structuredRows.slice(2));
  expect(Array.from(concatFrames(first, last))).toEqual(structuredRows);
  const empty = takeRows(frame, []);
  expect(empty.numRows).toBe(0);
  expect(Array.from(concatFrames(empty, frame))).toEqual(structuredRows);
  expect(Array.from(concatFrames(frame, empty))).toEqual(structuredRows);
});

test("reject invalid indices, overlaps, different labels and nested metadata", () => {
  for (const indices of [[-1], [3], [0.5], [1, 0], [1, 1]])
    expect(() => takeRows(frame, indices)).toThrow();
  expect(() => concatFrames(frame, frame)).toThrow("strictly ascending");
  expect(() =>
    concatFrames(
      frame,
      createDataFrame(structuredTable([]), { labels: { symbol: "OTHER" } }),
    ),
  ).toThrow("labels");
  const other = structuredTable([]);
  other.schema.fields[2]!.type.children[0]!.type.children[1]!.metadata.set(
    "style",
    "different",
  );
  expect(() =>
    concatFrames(frame, createDataFrame(other, { labels: frame.labels })),
  ).toThrow("metadata");
});

test("metadata ordering does not change schema compatibility", () => {
  const first = structuredTable(structuredRows.slice(0, 1));
  const last = structuredTable(structuredRows.slice(1));
  first.schema.metadata.set("a", "first");
  first.schema.metadata.set("b", "second");
  last.schema.metadata.set("b", "second");
  last.schema.metadata.set("a", "first");
  expect(
    Array.from(concatFrames(createDataFrame(first), createDataFrame(last))),
  ).toEqual(structuredRows);
});
