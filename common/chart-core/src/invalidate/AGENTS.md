# invalidate

Granular repaint scheduling for the chart renderer. Tracks a four-level invalidation hierarchy (`none < cursor < light < full`) per pane and at the chart level, so the render loop can skip unnecessary work.

## Invariants

- Levels are **monotonically merged**: once a pane reaches `full`, nothing can lower it until the mask is reset after a paint cycle.
- `get()` inherits the chart-level invalidation, so a chart-wide `full` overrides any per-pane level.
- The `Mask` is immutable by convention; every helper returns a new object rather than mutating in place.
