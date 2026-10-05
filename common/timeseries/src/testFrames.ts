// Purpose: Shared structured Arrow fixture for ownership, IPC and row-operation tests.
import {
  Field,
  Float64,
  List,
  Schema,
  Struct,
  TimestampMillisecond,
  Utf8,
} from "apache-arrow";
import { tableFromRows } from "./dataFrame";

/**
 * Test readings with a null value, a NaN value, and nested events sharing a time.
 * The outer readings still have distinct times; equal event times inside a list
 * do not require allowing duplicate times on the frame itself.
 * @internal
 */
export const structuredRows = [
  {
    time: 10,
    value: null,
    events: [
      { time: 7, text: "a" },
      { time: 7, text: "b" },
    ],
  },
  { time: 20, value: NaN, events: [] },
  { time: 30, value: 3, events: null },
];

/**
 * Build the shared test table with nested field metadata and nullable cells.
 *
 * @param rows - Replacement test rows, or the shared fixture when omitted.
 * @returns A mutable Arrow table; tests pass it through the public constructors.
 * @internal
 */
export function structuredTable(
  rows: readonly Readonly<Record<string, unknown>>[] = structuredRows,
) {
  return tableFromRows(
    new Schema(
      [
        new Field("time", new TimestampMillisecond(), false),
        new Field("value", new Float64(), true),
        new Field(
          "events",
          new List(
            new Field(
              "item",
              new Struct([
                new Field("time", new TimestampMillisecond(), false),
                new Field(
                  "text",
                  new Utf8(),
                  false,
                  new Map([["style", "caption"]]),
                ),
              ]),
              false,
            ),
          ),
          true,
          new Map([["tea:write", "append"]]),
        ),
      ],
      new Map([["source", "tea"]]),
    ),
    rows,
  );
}
