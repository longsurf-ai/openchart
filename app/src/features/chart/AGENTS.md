# React chart

See [README.md](README.md) and [architecture](../../../../docs/architecture/chart.md).

- Query caches Resources; Dashboard owns placements/focus; ChartGridContext owns
  identity/interactions/mounted handles; cells own preferences.
- No cell-delete UI. Presets/maximization retain sibling renderers.
- Serialize writes against cached revisions. Capture IDs; await saves before dialog close.
- ChartCell composes sources; ChartPanes owns panes; ChartLegend positions targets.
  Visible cells publish identity, main bar settings and focus through `useAssistantContext`.
  Loading/remounts never prune panes. One DatasetSource/useDataset per Dataset holds
  each bar's latest known value; its Collect action reviews changed scripts before
  approving. One MarketSource/useBars per input; preserve
  fields/gaps/fresh arrays, convert milliseconds at rendering. Unmount releases
  instances/subscriptions.
- CSS Grid: tracks; core: pane geometry. Reuse shared Radix controls.
- Drawing Resources own geometry; Query owns saved/pending edits; core holds
  projections/drafts. Unmount flushes original scope; projections never become edits.
  Read-only cells lock projected drawings, record no edits and show legend values only.
  A drawing-scoped cell projects only that Resource; queued edits retain its ID
  and may only update the existing drawing, never create, replace its type, or delete.
- Drawing-alert creation: await serialized geometry saves; bind Resource-envelope IDs.
  Only supported boundaries on normal main-price/ordinal-time axes qualify.
  Pill bells dim on interval/session/adjustment mismatch without changing Rules.
- Axis +: price (main pane), then each pane's outputs IndicatorSource registers.
  Alert lines use their series' pane/scale: main price or the output's binding.
- DrawingSource owns cell/scope Chart Explain. Chart submits drawing intent/owns
  scanners; backend plugin prepares context. `lib/agent` supplies commands/observation.
  Chart gestures submit `chart_explain` Sessions without opening conversation
  UI. Unmount clears progress, never execution.
- `useTea` runs an Indicator's stored snapshot as content; settings only re-observe,
  Reload re-snapshots and recompiles.
  Window refresh/failure retains data until snapshots; execution-identity changes
  clear it. Snapshots replace windows. TeaVisuals/MarketVisuals share ChartSeries/SeriesLegend.
  One indicator legend aggregates colored pane values. Presentation never restarts Tea.
  Its Open code action uses app-supplied WorkspaceFileNavigation for the live source.
  Reload is dotted while `useTeaSource` files differ from the snapshot; failed reads never dot.
- Tea only through `hooks/use-tea` (never the client; ESLint enforces). Adding
  decides once `useTeaDefinition` settles on the post-save read.
- menus.tsx/chart-explain-drawings.tsx may use Effect Schema for Drawing input.
- MarketVisuals tags intraday Extended/24h bars with calendar sessions;
  failures only omit shading.
