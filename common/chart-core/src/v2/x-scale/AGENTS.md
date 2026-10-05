# x-scale

Manages x-axis configuration for both ordinal (time-based bar spacing) and linear (continuous value) modes. Provides CRUD operations on axis objects, coordinate transforms (index-to-pixel, pixel-to-index, value-to-pixel), domain derivation from data, and visible-range calculations.

## Invariants

- `removeAxis` silently refuses when only one axis remains, preventing an empty axes array.
- `deriveLinearDomain` falls back to `{ min: 0, max: 1 }` when no finite values exist; callers should guard for empty data before rendering.
- Ordinal helpers rebuild a `TimeScale.State` on every call; avoid calling them in tight loops without caching the scale.
