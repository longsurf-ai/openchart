# Dataset framework

Owns source-independent declarations, operation codecs and ready access. Source
schemas and Feed bindings belong in `data/providers/<name>/`.

- `defineDataset` owns name, keys, observations, layout and enabled access modes.
  Derive codecs; register each name once by Definition identity. Providers
  unregister retired `defineRuntimeDataset` declarations.
- Keys address data independently of observations. Apply modifiers before
  `k.eq`/`k.range`. Select adds count; stream uses equality keys; search uses
  query/limit and optional score. Reserved fields cannot be repurposed.
- Row operations use rows/arrays. Timeseries operations share one DataFrame kind
  and codec, require numeric time and scalar columns, and forbid search.
  Timeseries owns ordering, column lengths, gaps and Arrow encoding.
- Only `makeDataset` creates ready handles; no credential or service requirement
  escapes; mismatched methods are defects.
- Providers fail with `DatasetFailure` (a `Dataset.*` reason and server-only
  cause); `makeDataset` adds `dataset` and `operation` as `DatasetError`.
- Retirement closes admission (`Dataset.Retired`) while accepted finite work
  finishes. Streams acquire in a child of the caller Scope, closed on
  acquisition failure or stream exit. Closed subscriptions cannot restart.
- Parse unknown data at boundaries; trust typed internal calls. Preserve source
  pagination/count semantics. Declarations perform no I/O; the framework never
  imports concrete Providers or registers test fixtures through its entry point.
