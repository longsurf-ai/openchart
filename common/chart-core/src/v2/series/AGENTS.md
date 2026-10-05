# series

Resolves field-name mappings for series data points and provides typed accessors (`readNumber`, `readString`) that look up values by role through the `SeriesRegistry` defaults and per-series `fieldMap` overrides.

## Invariants

- `getFieldMap` merges registry defaults with the series-level `fieldMap`; per-series entries win. If a series type is not registered, only the explicit `fieldMap` is used.
- `readNumber` silently returns `undefined` for `NaN`, `Infinity`, and non-number values; callers must handle the missing-value case.
