# strategy

Runtime strategy execution state and chart-native visualization for entries, exits, and derived performance.

## Invariants

- Strategy scripts own order intent; the chart renderer automatically derives execution markers and performance presentation from runtime strategy state.
- Return, ending capital, and session count are derived from execution fills and the chart timeline. They are never duplicated as stored display values.
- Strategy execution state is a runtime projection and must never be serialized into a persisted chart workspace.
