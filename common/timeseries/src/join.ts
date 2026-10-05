// Purpose: Replace sampled rows and align timelines without losing structured values.
import { DataType } from "apache-arrow";
import {
  allowsDuplicateTimes,
  replaceTail,
  tailStart,
  type DataFrame,
  type DataFrameRow,
  type DataFrameSpec,
} from "./dataFrame";
import { assertCompatible, rebuild } from "./rows";

/**
 * Require one row per timestamp so matching a time never discards a distinct event.
 * Only event frames can repeat a time; construction keeps other frames strictly ascending.
 */
function sampled(frame: DataFrame): void {
  if (!allowsDuplicateTimes(frame)) return;
  const times = frame.column("time");
  if (times.some((time, index) => time === times[index - 1]))
    throw new Error(
      "Sampled-row operations do not accept duplicate event timestamps",
    );
}

/** Position of the first row at or after `time`, by binary search of the ascending timeline. */
function firstAtOrAfter(frame: DataFrame, time: number): number {
  let low = 0;
  let high = frame.numRows;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (frame.get(middle)!.time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Combine readings by timestamp, replacing a whole row when an update matches it.
 *
 * Each input must contain at most one row per timestamp and have matching labels,
 * column layouts and metadata. The result is sorted by time. An update replaces
 * every cell in the old row, including nulls and nested lists; list contents are
 * never appended to the previous row. Duplicate event timestamps are rejected
 * because they represent distinct events that must not be collapsed into one.
 *
 * Only rows from the update's first time on are rebuilt and checked; earlier
 * rows share the existing frame's immutable storage. A live update near the end
 * therefore costs about the same for a long frame as for a short one.
 *
 * @param frame - Existing readings; they remain unchanged.
 * @param update - Complete replacement rows and any additional timestamps.
 * @returns A frame containing the union of timestamps, with updates winning
 * matches; the existing frame itself when the update is empty.
 * @throws If either input repeats a timestamp, or schemas or labels differ.
 *
 * @example
 * ```ts
 * import { fromPoints, mergeByTime } from "@openchart/timeseries";
 *
 * const original = fromPoints({ sensor: "room" }, [
 *   { time: 1_000, temperature: 20 },
 *   { time: 2_000, temperature: 21 },
 * ]);
 * const update = fromPoints({ sensor: "room" }, [
 *   { time: 2_000, temperature: 23 },
 *   { time: 3_000, temperature: 24 },
 * ]);
 * const current = mergeByTime(original, update);
 * Array.from(current, (row) => row.temperature); // [20, 23, 24]
 * original.get(1)?.temperature; // 21: the old frame is unchanged.
 * ```
 */
export function mergeByTime<S extends DataFrameSpec>(
  frame: DataFrame<S>,
  update: DataFrame<S>,
): DataFrame<S> {
  assertCompatible(frame, update);
  sampled(frame);
  sampled(update);
  const first = update.get(0);
  if (!first) return frame;
  // Rows before the update's first time keep their storage; rebuild the rest.
  const start = tailStart(frame, firstAtOrAfter(frame, first.time));
  const rows = new Map<number, DataFrameRow<S>>();
  for (let index = start; index < frame.numRows; index++) {
    const row = frame.get(index)!;
    rows.set(row.time, row);
  }
  for (const row of update) rows.set(row.time, row);
  const tail = rebuild<S>(
    frame.schema,
    [...rows.values()].sort((a, b) => a.time - b.time),
  );
  return replaceTail(frame, start, tail);
}

/**
 * Produce one row at each requested timestamp using readings from another frame.
 *
 * The fill policy picks the source row each requested time shows:
 *
 * - `"nan"` (the default): only a row at exactly that time.
 * - `"hold"`: the most recent whole row at or before that time, carried forward.
 *   Times before the first source row still receive gaps; no value is borrowed
 *   from the future.
 * - `"last"`: the last row from that time until the next requested time, or of
 *   all later rows for the last one. With the timeline as bar open times, each
 *   bar shows the last row that opened inside it, Pine's lower-timeframe rule;
 *   rows before the first bar show nowhere. When every row sits on a requested
 *   time, this equals `"nan"`.
 *
 * A time with no such row gets NaN in floating-point columns and null in all
 * other columns, including integer, string and nested columns. Existing null and
 * NaN cells stay unchanged, including when held forward. Labels, nested values
 * and metadata are preserved; columns receiving new null gaps become nullable.
 * Only the root `time` changes when a row moves to a requested time, so
 * timestamps inside nested event lists retain their original values.
 *
 * @param timeline - Strictly increasing safe-integer timestamps in epoch milliseconds.
 * @param frame - Source with at most one row per timestamp; it is never modified.
 * @param options - Fill policy: `"nan"` (the default), `"hold"` or `"last"`.
 * @returns An independent frame with exactly the requested timeline.
 * @throws If the timeline is invalid or the source repeats a timestamp.
 *
 * @example
 * ```ts
 * import { fromPoints, joinByTime } from "@openchart/timeseries";
 *
 * const readings = fromPoints({ sensor: "room" }, [
 *   { time: 1_000, temperature: 20 },
 *   { time: 1_500, temperature: 21 },
 *   { time: 3_000, temperature: null },
 * ]);
 * const timeline = [0, 1_000, 2_000, 3_000];
 * const gaps = joinByTime(timeline, readings);
 * Array.from(gaps, (row) => row.temperature); // [NaN, 20, NaN, null]
 * const held = joinByTime(timeline, readings, { fill: "hold" });
 * Array.from(held, (row) => row.temperature); // [NaN, 20, 21, null]
 * const last = joinByTime(timeline, readings, { fill: "last" });
 * Array.from(last, (row) => row.temperature); // [NaN, 21, NaN, null]
 * ```
 */
export function joinByTime<S extends DataFrameSpec>(
  timeline: readonly number[],
  frame: DataFrame<S>,
  options: { fill?: "nan" | "hold" | "last" } = {},
): DataFrame<S> {
  sampled(frame);
  const source = Array.from(frame);
  const schema = frame.schema;
  let cursor = -1;
  let gaps = false;
  const rows = timeline.map((time, index) => {
    if (!Number.isSafeInteger(time))
      throw new Error("DataFrame time must be safe integer epoch milliseconds");
    if (index > 0 && time <= timeline[index - 1]!)
      throw new Error("Sampled alignment time must be strictly ascending");
    // The candidate is the last row before `end`: the next requested time
    // with "last", else just past this one (times are integers).
    const end =
      options.fill === "last" ? (timeline[index + 1] ?? Infinity) : time + 1;
    while (cursor + 1 < source.length && source[cursor + 1]!.time < end)
      cursor++;
    const row = source[cursor];
    if (row && (row.time >= time || options.fill === "hold"))
      return { ...row, time };
    gaps = true;
    return Object.fromEntries(
      schema.fields.map((field) => [
        field.name,
        field.name === "time"
          ? time
          : DataType.isFloat(field.type)
            ? NaN
            : null,
      ]),
    );
  });
  if (gaps)
    for (let index = 0; index < schema.fields.length; index++) {
      const field = schema.fields[index]!;
      if (field.name !== "time" && !DataType.isFloat(field.type))
        schema.fields[index] = field.clone({ nullable: true });
    }
  return rebuild(schema, rows);
}
