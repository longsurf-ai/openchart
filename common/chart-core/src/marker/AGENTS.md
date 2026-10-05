# marker

Timeline strip contract for provider-backed earnings marks. Marks are
pane-local bottom-lane chart affordances, not chart annotations or durable user
drawings.

## Invariants

- Market identity is `market: ProviderListing` from OpenChart; provider + symbol
  distinguish listings. Never require or fabricate V1 numeric listing IDs.

- An `earnings` Marker is a read-only projection of a provider-backed earnings result row; it is not persisted in chart state and is not user-owned bookmark state.
- Chart-coordinate Marker pins and vertical guide lines must render through `render.ts`; DOM tooltips are point-in-time chrome and dismiss on chart invalidation.
- Marker lanes are anchored to the pane that owns the chart's main listing series.
  Do not place provider-backed marks at the global chart bottom when auxiliary panes exist.
- Marker defaults use theme-owned glow tokens; only explicit user color overrides should bypass them.
