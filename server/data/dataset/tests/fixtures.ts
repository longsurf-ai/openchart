// Purpose: Test-only Dataset declarations shared by Dataset and transport tests.

import { Schema } from "effect";
import { defineDataset, k, Layout } from "@openchart/server/data/dataset";

/** Provider-native observation schema. */
export const echoRow = Schema.Struct({ value: Schema.String });

/** Row access derived from independent topic addressing and value observations. */
export const echo = defineDataset({
  name: "test.echo",
  keys: Schema.Struct({ topic: k.eq(Schema.String) }),
  schema: echoRow,
  layout: Layout.Row,
  access: { select: true, stream: true, search: true },
});

/** Provider-native observation schema. */
export const barsRow = Schema.Struct({
  time: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  open: Schema.Finite.check(Schema.isGreaterThan(0)),
  close: Schema.Finite.check(Schema.isGreaterThan(0)),
});

/** Both historical and live access use the Dataset-derived DataFrame codec. */
export const bars = defineDataset({
  name: "test.bars",
  keys: Schema.Struct({
    symbol: k.eq(Schema.String),
    time: k.range(Schema.Finite),
  }),
  schema: barsRow,
  layout: Layout.Timeseries,
  access: { select: true, stream: true },
});
