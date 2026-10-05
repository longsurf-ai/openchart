// Purpose: Reject declarations that lose Dataset addressing, observation or layout invariants.

import { Schema } from "effect";
import type { DataFrame } from "@openchart/timeseries";
import { bars, echo } from "@openchart/server/data/dataset/tests/fixtures";
import {
  defineDataset,
  k,
  Layout,
  type DatasetInput,
  type DatasetOutput,
  type DatasetDefinition,
  type DataFrameSpecOf,
  type RowOf,
} from "./index";

const rows = defineDataset({
  name: "types.rows",
  keys: Schema.Struct({ id: k.eq(Schema.Int) }),
  schema: Schema.Struct({ value: Schema.String }),
  layout: Layout.Row,
  access: { select: true },
});
const optional = defineDataset({
  name: "types.optional",
  keys: Schema.Struct({
    id: k.eq(Schema.optionalKey(Schema.Int)),
    at: k.range(Schema.optionalKey(Schema.Int)),
  }),
  schema: rows.schema,
  layout: Layout.Row,
  access: { select: true, stream: true },
});
const live = defineDataset({
  ...bars,
  name: "types.live",
  access: { stream: true },
});
const input: DatasetInput<typeof rows, "select"> = { id: 1, count: 2 };
const output: DatasetOutput<typeof rows, "select"> = [{ value: "x" }];
const partial: DatasetInput<typeof optional, "select"> = {};
const range: DatasetInput<typeof optional, "select"> = { at: { to: 10 } };
const row: RowOf<typeof live> = { time: 1, open: 2, close: 3 };
const frame = (
  value: DatasetOutput<typeof live, "stream">,
): DataFrame<DataFrameSpecOf<typeof live>> => value;
const constructed: DatasetOutput<typeof live, "stream"> = live.frame.create({
  labels: {},
  rows: [row],
});
void [optional, live, input, output, partial, range, row, frame, constructed];

if (false) {
  // @ts-expect-error row layout has no DataFrame constructor
  rows.frame.create({ labels: {}, rows: [] });
  // @ts-expect-error frame observations derive their scalar types from the declaration
  live.frame.create({ labels: {}, rows: [{ time: 1, open: "2", close: 3 }] });
  // @ts-expect-error even an erased declaration must expose at least one operation
  const empty: DatasetDefinition = { ...rows, access: {} };
  // @ts-expect-error observation shape comes directly from schema, even on search-only or stream-only access
  const wrongRow: RowOf<typeof live> = { time: 1, open: "2", close: 3 };
  // @ts-expect-error select input derives from the marked key's native schema
  const wrong: DatasetInput<typeof rows, "select"> = { id: "1" };
  // @ts-expect-error response shape derives from the observation schema
  const response: DatasetOutput<typeof rows, "select"> = [{ value: 1 }];
  // @ts-expect-error timeseries select returns a branded DataFrame, never rows
  const rowFrame: DatasetOutput<typeof bars, "select"> = [
    { time: 1, open: 2, close: 3 },
  ];
  const streamRange: DatasetInput<typeof bars, "stream"> = {
    symbol: "A",
    // @ts-expect-error range keys never appear in streaming requests
    time: { from: 1 },
  };
  // @ts-expect-error undeclared operations have no input type
  const absent: DatasetInput<typeof rows, "stream"> = { id: 1 };
  // @ts-expect-error select reserves count, not limit
  const limit: DatasetInput<typeof rows, "select"> = { id: 1, limit: 1 };
  // @ts-expect-error at least one operation must be enabled
  defineDataset({ ...rows, name: "types.empty", access: {} });
  // prettier-ignore
  // @ts-expect-error no arbitrary operation names
  defineDataset({ ...rows, name: "types.mode", access: { select: true, other: true } });
  // prettier-ignore
  // @ts-expect-error callers cannot override derived operation schemas
  defineDataset({ ...rows, name: "types.override", access: { select: echo.access.select } });
  // @ts-expect-error every declaration has keys, schema and layout
  defineDataset({ name: "types.operations-only", access: { select: true } });
  // prettier-ignore
  // @ts-expect-error keys must carry explicit addressing semantics
  defineDataset({ ...rows, name: "types.unmarked", keys: Schema.Struct({ id: Schema.Int }), access: { select: true } });
  // prettier-ignore
  // @ts-expect-error modifiers must be applied before the key constructor
  defineDataset({ ...rows, name: "types.lost-mark", keys: Schema.Struct({ id: Schema.optionalKey(k.eq(Schema.Int)) }), access: { select: true } });
  // prettier-ignore
  // @ts-expect-error timeseries requires a numeric range key named time
  defineDataset({ ...bars, name: 'types.eq-time', keys: Schema.Struct({time: k.eq(Schema.Int)}), access: {select: true}, });
  // prettier-ignore
  // @ts-expect-error timeseries forbids a second range key
  defineDataset({ ...bars, name: 'types.extra-range', keys: Schema.Struct({...bars.keys.fields, price: k.range(Schema.Finite)}), access: {select: true}, });
  // prettier-ignore
  // @ts-expect-error timeseries requires a numeric response timeline
  defineDataset({ ...bars, name: 'types.no-time', schema: rows.schema, access: {select: true}, });
  // prettier-ignore
  // @ts-expect-error timeseries columns must be supported scalar schemas
  defineDataset({ ...bars, name: 'types.object-column', schema: Schema.Struct({time: Schema.Int, value: Schema.Struct({})}), access: {select: true}, });
  // prettier-ignore
  // @ts-expect-error every timeseries column must be present
  defineDataset({ ...bars, name: 'types.optional-column', schema: Schema.Struct({ time: Schema.Int, value: Schema.optionalKey(Schema.Finite), }), access: {select: true}, });
  defineDataset({
    ...bars,
    name: "types.search-series",
    // @ts-expect-error timeseries cannot expose row search
    access: { search: true },
  });
  void [empty, wrongRow, wrong, response, rowFrame, streamRange, absent, limit];
}
