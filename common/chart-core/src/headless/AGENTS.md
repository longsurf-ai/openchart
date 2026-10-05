# headless

Headless chart renderer — produces PNG/JPEG image buffers using the same `repaint()` pipeline as the browser, backed by `@napi-rs/canvas` (Skia). No DOM, no browser required.

## Invariants

- `renderToBuffer()` is synchronous — no rAF, no events, no render loop
- The `@napi-rs/canvas` context is cast to `CanvasRenderingContext2D` — it's API-compatible but not the exact DOM type
- Callers must pre-fetch all data (bars + indicator outputs) before calling `assembleChartState()`
