# view

Framework-agnostic grid layout engine that manages multi-chart arrangements, interactive resize, and responsive collapse.

## Invariants

- Column/row widths are stored as **fractional values** (summing to 1), not pixels; forgetting to normalize after mutation will drift the total.
- `ViewStore` is a module-level singleton (`Map`); entries must be cleaned up on unmount or they leak.
- `Responsive.observeContainer` returns the `ResizeObserver` — the caller must call `.disconnect()` to avoid memory leaks.
