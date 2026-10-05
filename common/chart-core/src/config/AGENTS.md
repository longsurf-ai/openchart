# config

Federated configuration system: each chart component registers its own Zod schema, and the registry composes them into a single validated `ChartConfig.Full` object.

## Invariants

- Importing `index.ts` triggers **side-effect registrations** for every component config; import order matters if you add new component configs.
- `ConfigRegistry.compose()` caches its result; calling `register()` after `compose()` invalidates the cache, but callers that stored the old schema will hold a stale reference.
- `ChartConfig.set()` uses `structuredClone`, so config values must be serialisable (no functions or circular refs).
