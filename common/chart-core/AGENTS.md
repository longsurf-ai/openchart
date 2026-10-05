# Chart Core

Framework-independent V1 core transplanted into the OpenChart workspace. Keep renderer,
state, interaction, drawing, and cache behavior intact. `src/v2` is the existing state-based core API.

- App owns React, Feed subscriptions, DataFrame adaptation, theme, and resize.
  Common code imports neither app/server nor V1 workspace packages.
- Tea output decoding, indicator-specific styling, and Tea-backed primitives
  belong to `app/src/lib/chart`. Core supplies generic series/primitive APIs.
- OpenChart Market owns identity. Records use `market: ProviderListing`, validated by
  the owner schema directly in Effect annotations or through existing Zod records. Draft annotation
  geometry does not require or fabricate a market identity.
- Feed owns access, script requests, and live subscription contracts. Core has no
  DataSource, InstrumentView, or Calendar implementation. `src/market` contains
  the schema bridge and core-second cadence math derived from Feed.
- Source submodules retain their existing local invariants. Core time is seconds.
  Use a fresh array for each `setSeriesData` write; updates repaint at `light`.
- Run `npm test` and `npm run typecheck` here. The OpenChart gate includes both.
- Native headless rendering remains a separate `./headless` export.

See [README.md](README.md) for provenance and migration scope.
