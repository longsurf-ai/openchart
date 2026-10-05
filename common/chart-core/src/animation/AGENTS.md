# animation

Framework-agnostic animation primitives: easing curves, kinetic (momentum) scrolling, generic value animation, and Zod-validated configuration for tuning all animation behaviour.

## Invariants

- `Kinetic.start` multiplies velocity by a fixed 16 ms frame budget (`currentVelocity * 16`); on high-refresh-rate displays this overestimates per-frame deltas
- `Kinetic.State` is mutated in place (not immutable); do not share a single state object across concurrent drags
- `AnimationConfig` self-registers at import time via `ConfigRegistry.register` -- the import must execute before any code reads the `"animation"` config key
