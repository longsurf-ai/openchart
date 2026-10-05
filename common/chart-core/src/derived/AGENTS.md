# derived

Type contracts for the derived-series scripting system. Defines the request/response shapes and runtime context that user-authored scripts receive when computing indicator or overlay series.

## Invariants

- All types live in the `DerivedContracts` namespace; there is no barrel `index.ts`, so import directly from `contracts.ts`.
- `OutputScaleMode` and `OutputPaneMode` control where a derived series is rendered — choosing the wrong mode silently places the series on an unexpected axis or pane.
- `fetchSeries` in `ScriptRuntimeContext` is async; scripts that call it must handle the returned promise or risk unresolved data in `ScriptResult.outputs`.
