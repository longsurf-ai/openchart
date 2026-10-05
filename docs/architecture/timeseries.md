# Timeseries

`common/timeseries` owns one Arrow-backed DataFrame, its time/labels constraints,
row operations and wire codec. It is a leaf package depending on Effect and
Apache Arrow, with no dependency on another OpenChart package or Tea.

## DataFrame

A DataFrame stores one private Arrow Table. It exposes `numRows`, `labels`,
`get(index)`, `column(name)` and row iteration. Rows and column values are
detached readonly values; `time` is a numeric epoch-millisecond value.
Out-of-range `get` returns null. `column` reads only the named column, such as
one Tea output, and rejects unknown names. The `schema` getter returns a
defensive Arrow schema copy, and `toArrow()` returns an independent table for
callers that need Arrow APIs.

```ts
import { Schema } from "effect";
import { defineDataFrame } from "@openchart/timeseries";

const Prices = defineDataFrame({
  close: Schema.Finite,
  volume: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
const frame = Prices.create({
  labels: { symbol: "AAPL" },
  rows: [{ time: 1_700_000_000_000, close: 189.4, volume: 100 }],
});
frame.get(0)?.close;
const wire = Prices.toJson(frame);
const received = Prices.parseJson(wire);
```

`defineDataFrame` derives Arrow fields, static row types and domain validation
from the existing scalar Effect declarations. It supports number/string/boolean
columns and preserves their refinements. This convenience is for producers
whose schema is already an Effect observation declaration.

A producer that already owns an Arrow schema uses `createDataFrame(table)`.
TeaService uses the Module output schema directly, preserving Struct/List
columns, coordinates and `tea:write` metadata. It does not flatten structured
outputs or translate them into another set of field declarations.

## Invariants

- The Arrow table is the only stored column representation. Detached rows and
  renderer projections are consumer values, not a second maintained frame.
- Frames may share immutable Arrow storage. Nothing ever writes a frame's
  table, so a derived frame may reuse the record batches of the rows it keeps.
  Construction from outside data (`createDataFrame`, the row constructors and
  the codec) still copies.
- There is exactly one non-null millisecond timestamp column named `time`.
  Timestamps are valid exact epoch milliseconds; sampled timelines strictly
  increase. Event frames may explicitly allow duplicate times while remaining
  non-decreasing.
- All columns have the same row count. Field names are unique, including in
  nested structures; Arrow schema/nullability and physical buffers agree.
- Null and NaN remain distinct through construction, operations and IPC.
  Existing numeric NaN gaps stay NaN; nullable numeric values do not become gaps.
- Labels describe constant series identity, never request bounds or coverage.
  They are stored in Arrow schema metadata and exposed read-only.
- Publication is immutable: constructor inputs, returned rows and column
  values, schema copies and exported Arrow tables cannot mutate an existing
  frame. Arrow's mutable vectors, metadata Maps and buffers remain behind the
  owner.
- Trusted internal operations use validated frames. Unknown wire payloads are
  parsed once by the codec; declaration-specific codecs also enforce the
  producer's observation schema and refinements.

Append outputs remain lists on their execution row. Event timestamps inside a
list keep their own timeline and order. Separate events sharing a timestamp
must not be collapsed by a sampled-row merge. TeaService owns provisional-step
semantics; Arrow only preserves the associated data and metadata.

## Dataset and Feed

`Layout.Timeseries` derives a frame factory from the Dataset observation schema
once and shares its codec between select and stream. Providers construct frames
through that factory after validating source I/O. They do not author a parallel
Arrow schema. `Layout.Row` continues returning ordinary observations.

Feed carries these frames through history composition, snapshots and updates,
including native columns such as `trades`, `final` and `asOf`. Feed owns inspected
ranges, countBack and provider revision rules. Timeseries owns frame structure
and transformations.

The app reads detached rows at `lib/chart/data.ts`, converting milliseconds to
seconds when building chart-core input. Chart-core keeps its existing input
shape and does not depend on Arrow or timeseries. Hose remains payload-agnostic.

## Codec and row operations

- `dataFrameCodec`, `parseJson` and `toJson` encode one Arrow IPC stream as a
  base64 JSON string. IPC preserves nested types, validity, NaN and metadata;
  there is no scalar JSON column format or NaN/null conversion.
- `defineDataFrame(...).codec` uses that same wire representation while enforcing
  the declaration's expected fields and value refinements.
- `takeRows` preserves selected rows, labels and complete schema.
- `concatFrames` requires compatible schemas/labels and a later timeline.
- `mergeByTime` replaces complete sampled rows at matching timestamps; it is not
  an event deduplicator. It rebuilds and checks only the rows from the update's
  first time on and shares the earlier rows' storage, so a live update costs
  what it changes. A short trailing batch is rebuilt with them, so a frame
  grows about one Arrow batch per 64 rows rather than one per update.
- `joinByTime` aligns a sampled frame to the supplied timeline, retaining its
  fill policy and source values: exact times by default, the last row at or
  before each time with `"hold"`, or the last row inside each bar with
  `"last"`, which puts finer rows on coarser bars.
- `fromPoints(labels, points)` is a convenience for scalar observations and
  fixtures. Empty, all-null or structured columns need an explicit schema.

## TimeRange

`TimeRange` owns shared `{from, to}` bounds in epoch milliseconds. `to` is an
exclusive integer or `"now"`; numeric bounds require `from < to`. Requests may
use `"now"`, while snapshot contracts narrow `to` to the service-selected
integer cutoff and retain the range check.
