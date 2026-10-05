# Dashboard

- `components/dashboard-view.tsx` owns reads, placement save/retry/discard state and layout.
  App injects ID, transport, header composition and widget registry. Adding existing
  placements uses this same save state; app controls only select the widget kind. Mount creates
  no content; widths never persist or remount widgets. Explicit grid-reset recovery
  must confirm discarding any editor drafts in the affected placements.
- `components/dashboard-grid.tsx` owns RGL gestures and keyboard geometry.
  Commit once on stop against the starting revision; failures retain the request.
- `components/widget-host.tsx` owns Context, Card, error boundary and toolbar
  visibility leases. Widgets own their Resource queries and runtime effects.
- Chart creation and placement edits share one Dashboard mutation state.
  Capture the current revision/geometry on selection; failures retain the request.
  The first widget fills the viewport; the second splits it into equal left/right
  halves in the same save; later additions leave existing geometry unchanged.
- Host `placeBeside` reuses the placement showing a Resource, even mid-save, else
  saves one docked right of the caller. `placeWidgetBeside` takes the least disruptive
  fit (free right, slide left, split, push down) and saves what the grid shows.
- `api/queries.ts` owns mutations/directory reads. Shared identity query options
  live in `lib/resource/dashboard.ts` for widget adapters. Query is the sole cache.
- Creation uses `resources.macro.createDashboardWithChart` for "New dashboard" with
  the backend's default Chart, without a dialog. Users can add more widgets.
  Rename/delete dialogs preserve drafts and show safe server errors.
- Features never import app or one another. See app/AGENTS.md and
  docs/architecture/widget-architecture.md for ownership and layout boundaries.
