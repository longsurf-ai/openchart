# cache

LRU caches that eliminate redundant work during chart rendering: `TextCache` caches canvas `measureText` results keyed by font+text, and `LabelCache` caches formatted price/time strings keyed by value+format.

## Invariants

- Both caches use LRU eviction that trims to 75% of max when the cap is reached. Changing the eviction ratio or max size affects memory usage during rendering.
- Cache keys are compound strings (e.g. `font|text`, `value|precision`). If the key format changes, stale entries will never match and the cache becomes ineffective.
- `TextCache.measure` mutates `ctx.font` as a side effect. Callers must not assume `ctx.font` is preserved after a call.
- `LabelCache` is purely computational (no canvas dependency), while `TextCache` requires a live `CanvasRenderingContext2D`.
