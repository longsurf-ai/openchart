# state

Owns the chart state object model and the public mutation API. `ChartStateModel` enforces structural invariants (pane/object membership, schema version); `ChartStateUtils` provides the high-level operations consumed by the SolidJS layer; `defaults` supplies factory functions for canonical initial state.

Read [INVARIANTS.md](INVARIANTS.md) before changing this module. It preserves the
renderer, state, identity, and lifecycle rules that apply here.
