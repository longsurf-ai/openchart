# hit

Geometry-based hit testing for interactive chart elements. Provides point-in-shape tests (point, rect, line, horizontal, vertical) and a z-order-aware dispatch system that resolves mouse coordinates to the topmost series, primitive, axis, or pane.

## Invariants

- `test()` returns only the **first** hit in descending z-order; use `all()` when overlapping elements must all respond
- `line()` clamps the projection parameter `t` to [0, 1], so it tests a **segment**, not an infinite line
- Default thresholds vary: `point` = 10 px, `line` / `horizontal` / `vertical` = 5 px
