# state

Owns the chart state object model and the public mutation API. `ChartStateModel` enforces structural invariants (pane/object membership, schema version); `ChartStateUtils` provides the high-level operations consumed by the SolidJS layer; `defaults` supplies factory functions for canonical initial state.

## Invariants

- Every mutating `ChartStateUtils` method calls `assertModelReady` up front; passing non-canonical state (e.g. missing `objects` map) throws immediately.
- `createState` sets `schemaVersion = 3` and calls `assertModelReady` before returning; manually constructed state that skips this will fail validation.
- `Chart.State.objects` is a closed `Chart.ObjectState` discriminated union keyed by `ChartObjectId`; `ChartId` identifies the containing chart and must never be used as the object-map key type. Runtime-corrupt object shapes still fail through `assertModelReady`.
- Pane membership is authoritative via `pane.objectIds` + object `paneId`; derive pane order from `ChartStateModel.paneIndexForSeriesId()` instead of storing it on `Series.State`.
- Pane layout and adjacent-pane resize math is owned by `ChartPaneLayout`; canvas events and Solid overlays must not duplicate proportional height or drag clamp formulas.
- Parent-owned axes (`parentId`) and automatically allocated Histogram axes default to hidden and zero-locked. Other explicit axis IDs default to ordinary visible axes; registering another series never changes an existing axis's presentation. Callers own explicit volume-overlay axis options.
- A y-axis id belongs to one pane at a time. `ChartStateUtils.useOwnAxis()` allocates an axis identity exclusive to the requested series, and state invariant repair splits any legacy axis id shared across panes; never derive pane-scoped own axes from lossy series-id prefixes because y-axis ids are global across panes.
- Data adapters explicitly create every visual series, including volume Histograms. Core never synthesizes volume from an OHLC series. Existing `parentId` children move and delete with their parent; their data and options stay caller-owned.
- Rendering and read-only chart consumers must use resolved series helpers. Multi-output indicators keep generic rows in `chart.dataSeries[dataRef]`, keep visual `series.data` empty, and select output fields through `fieldMap`; writing projected indicator rows into visual series would override the shared source of truth.
- Comparison mode only owns root provider-backed price series in the comparison
  main pane. It hides non-participant series in that pane, but detached-pane
  series remain independent and must not become comparison participants or
  anchor sources.
- `Chart.ComparisonState.fixedZeroAxis` is only user intent for
  percentage-from-anchor comparison mode. State utilities preserve or clear the
  flag; renderer autoscale owns the actual zero-line extent math.
