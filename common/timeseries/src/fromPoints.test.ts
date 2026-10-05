// Purpose: Scalar inference is a convenience, never a lossy canonical format.
import { expect, test } from "vitest";
import { fromPoints } from "./fromPoints";

test("infers scalars, retaining false, null and NaN distinctly", () => {
  const frame = fromPoints({ symbol: "AAPL" }, [
    { time: 1, close: 10, final: false },
    { time: 2, close: NaN, note: "b" },
    { time: 3, close: null, final: true },
  ]);
  expect(Array.from(frame)).toEqual([
    { time: 1, close: 10, final: false, note: null },
    { time: 2, close: NaN, final: null, note: "b" },
    { time: 3, close: null, final: true, note: null },
  ]);
  expect(frame.labels).toEqual({ symbol: "AAPL" });
});

test("all-null columns require a schema and mixed scalar kinds are rejected", () => {
  expect(() => fromPoints({}, [{ time: 1, value: null }])).toThrow(
    "no non-null",
  );
  for (const value of ["two", false])
    expect(() =>
      fromPoints({}, [
        { time: 1, value: 1 },
        { time: 2, value },
      ]),
    ).toThrow("mixes");
});

test("omitted numeric properties remain gaps while explicit null stays distinct", () => {
  const frame = fromPoints({}, [
    { time: 1, value: 2 },
    { time: 2 },
    { time: 3, value: null },
  ]);
  expect(Array.from(frame, (row) => row.value)).toEqual([2, NaN, null]);
});
