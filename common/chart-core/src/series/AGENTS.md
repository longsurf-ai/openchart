# series

Pluggable series module: defines the `Series.Def` interface, Zod option schemas for each built-in chart type (Line, Area, Histogram, Bar, Candlestick, Baseline), and a global registry that maps type names to their implementations.

## Invariants

- Every `Def` must implement `visibleExtent` separately from `extent`; `extent` covers the full dataset while `visibleExtent` covers only the current viewport slice and is called on every pan/zoom
- Histogram visible extents always include zero and bars extend from their `base` option (default `0`) to the value; do not regress them into pane-floor bars
- `fieldMap` allows callers to remap data field names (e.g., `{ value: "close" }`); helpers like `resolveField` fall back to built-in defaults when no mapping is provided
- Missing/null/non-finite samples remain gaps during projection; never coerce null to zero.
