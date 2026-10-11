// Purpose: Keep Dataset alignment within each bar and preserve pre-window history.
import { expect, test } from "vitest";
import { fromPoints } from "@openchart/timeseries";
import { alignDatasetToBars } from "../utils/dataset";

const day = 86_400_000;

test("seeds a sparse window from earlier observations and excludes future rows", () => {
  const frame = fromPoints({}, [
    { time: 0, value: 1 },
    { time: 3.5 * day, value: 3 },
    { time: 10 * day, value: 99 },
  ]);
  const rows = alignDatasetToBars(
    [day, 2 * day, 3 * day, 4 * day],
    frame,
    "1d",
    20 * day,
  );
  expect(rows.map((row) => row.value)).toEqual([1, 1, 3, 3]);
  expect(rows.map((row) => row.time)).toEqual([day, 2 * day, 3 * day, 4 * day]);
});

test("preserves independently updated columns before and within each bar", () => {
  const frame = fromPoints({}, [
    { time: 0, alpha: 1, beta: null },
    { time: 1, alpha: null, beta: 2 },
    { time: day + 1, alpha: 3, beta: null },
    { time: day + 2, alpha: null, beta: 4 },
    { time: day + 3, alpha: NaN, beta: null },
  ]);
  expect(alignDatasetToBars([10, day], frame, "1d", 3 * day)).toEqual([
    { time: 10, alpha: 1, beta: 2 },
    { time: day, alpha: 3, beta: 4 },
  ]);
});

test("bounds a single unfinished bar by the clock and its exclusive close", () => {
  const frame = fromPoints({}, [
    { time: 0, value: 1 },
    { time: day + 1, value: 2 },
    { time: 2 * day, value: 99 },
  ]);
  expect(alignDatasetToBars([day], frame, "1d", day)[0]?.value).toBe(1);
  expect(alignDatasetToBars([day], frame, "1d", day + 1)[0]?.value).toBe(2);
  expect(alignDatasetToBars([day], frame, "1d", 3 * day)[0]?.value).toBe(2);
});

test("does not fold observations from missing bar intervals into the preceding bar", () => {
  const frame = fromPoints({}, [{ time: 2 * day, value: 2 }]);
  expect(alignDatasetToBars([0, 3 * day], frame, "1d", 4 * day)).toEqual([
    { time: 0 },
    { time: 3 * day, value: 2 },
  ]);
});

test("uses the calendar month instead of a nominal thirty-day final interval", () => {
  const january = Date.UTC(2024, 0, 1),
    february = Date.UTC(2024, 1, 1);
  const frame = fromPoints({}, [
    { time: Date.UTC(2024, 0, 31), value: 31 },
    { time: february, value: 99 },
  ]);
  expect(
    alignDatasetToBars([january], frame, "1M", Date.UTC(2024, 2, 1))[0]?.value,
  ).toBe(31);
});
