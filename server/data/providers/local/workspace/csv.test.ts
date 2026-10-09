// Purpose: CSV decoding follows RFC 4180 quoting and reports the row and column at fault.
import { describe, expect, test } from "vitest";
import { decodeRows, parseCsv } from "./csv";

const cpi = {
  time: { column: "date" },
  columns: [
    { name: "cpi", type: "number" as const },
    { name: "note", type: "string" as const },
  ],
};

describe("parseCsv", () => {
  test("keeps quoted commas, quotes and line breaks", () => {
    expect(parseCsv('﻿a,b\r\n1,"x, ""y""\nz"\n2,\n')).toEqual([
      ["a", "b"],
      ["1", 'x, "y"\nz'],
      ["2", ""],
    ]);
  });
  test("rejects an unterminated quote", () => {
    expect(() => parseCsv('a\n"open')).toThrow(/quoted field/);
  });
});

describe("decodeRows", () => {
  test("reads declared columns in ascending time and ignores the rest", () => {
    const text = [
      " date ,cpi,note,extra",
      "2024-02-01,309.7,,ignored",
      "",
      "1704067200000,308.4,first,ignored",
      "2024-03-01T00:00:00Z,NaN,gap,ignored",
    ].join("\n");
    const rows = decodeRows(text, cpi);
    expect(rows.map((row) => row.time)).toEqual([
      Date.UTC(2024, 0, 1),
      Date.UTC(2024, 1, 1),
      Date.UTC(2024, 2, 1),
    ]);
    expect(rows[0]).toEqual({
      time: Date.UTC(2024, 0, 1),
      cpi: 308.4,
      note: "first",
    });
    expect(rows[1]!.note).toBeNull();
    expect(Number.isNaN(rows[2]!.cpi)).toBe(true);
  });

  test.each([
    ["", /no header/],
    ["day,cpi,note\n2024-01-01,1,a", /no "date" column/],
    ["date,cpi,note\nyesterday,1,a", /Row 2: "date"/],
    ["date,cpi,note\n2024-01-01,1.2.3,a", /Row 2: "cpi" must be a number/],
    ["date,cpi,note\n2024-01-01,1", /Row 2 has 2 fields/],
  ])("rejects %j", (text, message) => {
    expect(() => decodeRows(text, cpi)).toThrow(message);
  });

  test("rejects an observation column that repeats the time column", () => {
    expect(() =>
      decodeRows("date\n2024-01-01", {
        time: { column: "date" },
        columns: [{ name: "date", type: "string" }],
      }),
    ).toThrow(/time column/);
  });
});
