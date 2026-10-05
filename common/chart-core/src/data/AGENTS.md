# data

Shared Effect Time and Zod time-series point schemas and a windowed read-only DataView for
efficient iteration over visible series data during rendering.

## Invariants

- `Data.Time` is finite Unix epoch seconds (fractional seconds allowed), within
  calendar years 0000–9999. Drawing and annotation schemas share it; Zod
  point/event consumers derive validation through `Schema.is(Data.Time)`.
  Dates, calendar objects and milliseconds are rejected at write boundaries.
  Feed milliseconds are converted by the app at its rendering boundary.

- All point schemas extend `Whitespace` (which carries `time` + optional `custom`); value-based series extend `Value`, OHLC-based series extend `OHLC`.
- `DataView.create` accepts a `buffer` config to include extra items beyond the visible `from`/`to` range, used for off-screen rendering padding.
- `SeriesType` is currently just `string`; if it becomes a union, update `DataView.create`'s generic constraint accordingly.
