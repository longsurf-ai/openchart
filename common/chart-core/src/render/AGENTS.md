# render

Framework-agnostic rendering pipeline: transforms raw data into typed render items, caches them by version, clips to the visible viewport, and draws everything onto a Canvas 2D context.

## Invariants

- `Visible.clip` returns indices into the **items array**, not data indices; confusing the two silently renders the wrong slice.
- Line, area and baseline paths split at missing points; fills and selection glow never bridge gaps.
- `RenderCache` entries are invalidated lazily: `bump()` increments the global version, but stale entries remain in the map until the next `get()` miss or explicit `clear()`.
- `selection-glow` bucket colors are memoized per frame on the `SelectionGlowState` object; reusing a state across frames without calling `normalizeSelectionGlow` again will freeze the animation.
