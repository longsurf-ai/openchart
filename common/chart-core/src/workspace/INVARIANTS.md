# workspace

Framework-agnostic canonicalization, digest, and repair helpers for persisted dashboard workspace state.

## Invariants

- `digestDashboardWorkspace` is the shared pure digest function for dashboard workspace equality. Do not add client-only or server-only digest implementations.
- `repairDashboardWorkspace` is the shared pure repair function for malformed persisted workspace shape. Keep repair at this owner instead of scattering best-effort cleanup across hydrate/save call sites.
- Repair is structural only: it may scope orphaned charts/series inputs, canonicalize pane membership, drop stale indicator/comparison references, and remove runtime volume axes; it must not fetch data, invent market sources, or mutate runtime chart state.
- Runtime fields such as fetched data arrays, derived volume series, the derived volume y-axis, transient UI state, revisions, timestamps, and thumbnails must not become part of this digest.
- Indicator digest equality is about durable chart presentation content: definition identity, display name, and output membership. Indicator params, bindings, and deterministic `dataSeriesId`/`dataField` projections belong to `seriesInputs` / chart-series projection state, not the chart-local indicator grouping node. Server-owned metadata (`createdAt`, `updatedAt`) must not participate in workspace equality.
- Pane identity in workspace equality is positional (`pane-main`, `pane-2`, ...). Runtime-generated pane IDs, including y-axis pane references, must be canonicalized before comparing client and server workspace state.
- Preserve array order when it is semantic; only plain object keys are sorted.
