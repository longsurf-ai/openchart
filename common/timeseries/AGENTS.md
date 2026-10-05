# timeseries

Owns time ranges, Arrow-backed DataFrames, row operations and the shared IPC codec.
See [timeseries architecture](../../docs/architecture/timeseries.md).

- Leaf package: Effect and Arrow; no other OpenChart dependencies.
- One private Arrow table is the only stored representation. Struct/List values,
  field metadata, validity and NaN survive construction, operations and IPC.
- Frames may share immutable storage; constructors copy their inputs. Rows and
  `column()` values are detached; objects and arrays are frozen.
  `schema`/`toArrow()` return copies.
- `time` is a non-null millisecond Arrow timestamp; numeric accessors expose safe
  integer epoch milliseconds. Sampled timelines strictly ascend. Explicit event
  timelines may repeat timestamps; sampled merge/alignment must reject them.
- Labels are schema metadata describing constant identity, never request ranges.
- Dataset scalar declarations derive Arrow layout and codecs through
  `defineDataFrame`; preserve their Effect refinements. Structured producers
  supply their existing Arrow schema directly, never a parallel scalar spec.
- `hasColumns` checks a minimum scalar vocabulary; other columns may remain.
- Null and NaN are distinct; the shared base64 IPC codec never rewrites them.
  Hose transports the opaque carrier without depending on Arrow.
- Row operations preserve full schemas, metadata and nested values. Compatibility
  includes metadata. Do not flatten append lists or silently deduplicate events.
