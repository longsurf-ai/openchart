// Purpose: Verify the OpenChart bars query boundary and boolean DataFrame transport.
import { Schema } from "effect";

import { listDefinitions, type RowOf } from "@openchart/server/data/dataset";
import { openchartBars as bars } from "./bars";
import { fromPoints, toJson } from "@openchart/timeseries";
import { expect, test } from "vitest";

const series = {
  listing: 42,
  session: "regular",
  resolution: "1m",
  adjustment: "split_dividend",
} as const;

test("registers OpenChart bars with explicit session filtering and with both access modes", () => {
  expect(listDefinitions()).toContain(bars);
  expect(Object.keys(bars.access)).toEqual(["select", "stream"]);
  expect(Schema.decodeUnknownSync(bars.access.stream.input)(series)).toEqual(
    series,
  );
  const query = { ...series, time: { from: 1, to: 2 } };
  expect(Schema.decodeUnknownSync(bars.access.select.input)(query)).toEqual(
    query,
  );
  for (const invalid of [
    { ...query, listing: "42" },
    { ...query, listing: 0 },
    { ...query, resolution: "2m" },
    { ...query, session: "provider" },
    { ...query, session: undefined },
    { ...query, adjustment: undefined },
    { ...query, adjustment: "dividend" },
    { ...query, time: { from: 1.5 } },
  ]) {
    expect(() =>
      Schema.decodeUnknownSync(bars.access.select.input)(invalid),
    ).toThrow();
  }
  expect(() =>
    Schema.decodeUnknownSync(bars.access.stream.input)(query),
  ).toThrow();
  expect("search" in bars.access).toBe(false);
});

test("roundtrips OHLCV, final, and asOf through both Dataset access modes", () => {
  const row: RowOf<typeof bars> = {
    time: 1,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 0,
    final: false,
    asOf: 2,
  };

  const frame = bars.frame.create({
    labels: {
      listing: "42",
      resolution: "1m",
      adjustment: "split_dividend",
    },
    rows: [row],
  });
  const wire = Schema.encodeSync(bars.access.select.output)(frame);
  for (const codec of [bars.access.select.output, bars.access.stream.output]) {
    const decoded = Schema.decodeUnknownSync(codec)(wire);
    expect([...decoded]).toEqual([row]);
    expect(decoded.labels).toEqual(frame.labels);
  }
  expect(() =>
    Schema.decodeUnknownSync(bars.access.stream.output)(
      toJson(fromPoints({}, [{ ...row, final: 0 }])),
    ),
  ).toThrow();
});
