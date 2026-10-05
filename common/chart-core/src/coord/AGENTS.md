# coord

Coordinate system abstraction that converts between data space (values) and pixel space (canvas positions). Provides linear and logarithmic transforms, a pluggable registry of coordinate system factories, and built-in Cartesian 2D and no-op implementations.

## Invariants

- `def.ts` is the most critical file: it contains both the type definitions AND the transform math. Changes to scale mapping logic here affect every renderer.
- Y-axis scales use inverted ranges (higher pixel value = lower data value) to match canvas coordinates where Y grows downward.
- The registry auto-registers `"cartesian2d"` and `"none"` at module load time via side effects in `registry.ts`. Importing the registry triggers registration.
- `ScaleConfig.from`/`to` in `cartesian.ts` control what fraction of the vertical bounds a Y scale occupies (e.g., volume overlay uses `from: 0, to: 0.3`).
