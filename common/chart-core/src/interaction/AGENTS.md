# interaction

Framework-agnostic interaction pipeline that converts raw DOM events into typed state updates for chart panning, zooming, and crosshair snapping.

## Invariants

- Drag deltas are **total from start**, not incremental per frame. `state.ts` stores initial values; `effect.ts` applies the full delta each frame to avoid cumulative drift (see `effect.test.ts` regression test).
- `input.ts` includes a Windows Chrome `devicePixelRatio` workaround for scroll speed; removal will break wheel zoom on affected browsers.
- `mapping.ts` `zoomY` requires both `ctx.start` and `ctx.height`; missing either silently returns `{ effect: "none" }`.
