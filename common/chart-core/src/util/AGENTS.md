# util

Framework-agnostic utility helpers shared across `@openchart/chart-core`. Provides color manipulation, layout/rendering constants, a Zod-validated function wrapper, and nominal (branded) types.

## Invariants

- `fn.ts` does **not** contain generic helpers like clamp/lerp/debounce; it is strictly a Zod-validated function factory. Do not add unrelated helpers here.
- `Constants` is the single source of truth for layout magic numbers. Prefer adding new constants here over scattering literals in renderers.
- `Color` functions assume 3- or 6-digit hex strings prefixed with `#`. Passing other formats (named colors, `rgb()`, `hsl()`) will produce incorrect results.
- `Nominal` relies on a `unique symbol` brand that exists only at the type level; the runtime value is unchanged.
- `UUID.random()` is the shared browser-safe UUID generator. Use it instead of calling `crypto.randomUUID()` directly in code that may run on plain HTTP origins such as local tunnels or ad-hoc dev hosts.
