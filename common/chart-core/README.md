# Chart Core

`@openchart/chart-core` is the V1 `packages/core` engine copied from commit
`7f7c51d38` into the independent OpenChart workspace. Its existing `v2` namespace means
the state-based **core API**, not a new renderer implementation.

The transplant preserves renderer, interaction, geometry, and cache behavior and
carries the original regression suite. Package names, source exports, import
paths, and OpenChart test/build wiring are updated.

Market identity follows OpenChart: Event, Annotation, Marker, and Span records
carry `market: ProviderListing`. The existing Zod records delegate that field to
`@openchart/market`'s schema instead of duplicating it. Alerts are not modeled
here; see `docs/architecture/alert-trigger.md`. Draft annotations use a render-only shape without a fake
listing. The unused V1 DataSource/InstrumentView facade is removed; Feed owns
market access. Script requests and live subscriptions use OpenChart Feed contracts.
Only the core-second resolution math remains local, with its supported cadence
vocabulary derived from Feed. No V1 workspace or Calendar implementation is used.

The package retains the original compiler's indexed-access behavior and source
checking scope (`src/`); old `tests/` fixtures run through Vitest, as in V1.

```ts
import { v2 } from "@openchart/chart-core";

const state = v2.createState();
const renderer = v2.createRenderer({
  container,
  getState: () => state,
  setState: (mutate) => mutate(state),
});
renderer.render("full");
// The owner must eventually call renderer.dispose().
```

React runtime integration lives in `app/src/lib/chart`, product composition in
`app/src/features/chart`, and lifecycle/data hooks in `app/src/hooks`. The public
`@openchart/app/chart` export is ChartCore. Core consumes epoch-second rows; the
app preserves all DataFrame fields at that boundary.

React migration removes auto-derived volume, reads drawings from canonical chart
objects, respects explicitly mapped value columns, and makes viewport set/get use
the same plot width and pixel offsets as paint. Resource main roles retain native
series IDs. Core still depends on no React or state-management library.

Run `npm test` and `npm run typecheck` in this directory, or `just check` in OpenChart.
