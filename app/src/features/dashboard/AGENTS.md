# Dashboard

- `components/dashboard-view.tsx` owns reads, layout and shared placement/Chart
  save/retry/discard state. App injects identity, transport, header and registry.
  Mount creates nothing; widths never persist/remount widgets. Grid resets must
  confirm discarding affected editor drafts.
- `dashboard-grid.tsx` owns RGL/keyboard geometry. Capture revision/geometry;
  commit once on stop, retaining failed requests.
- `widget-host.tsx` owns Context, Card, error boundary and toolbar leases.
  Widgets own Resource queries and runtime effects.
- First widget fills the viewport; second splits it equally; later additions
  preserve existing geometry. `placeBeside` reuses a matching Resource placement,
  including pending saves, otherwise docks right. `placeWidgetBeside` chooses
  free right, slide left, split, then push down; saves match displayed geometry.
- `api/queries.ts` owns mutations/directories; `lib/resource/dashboard.ts` shares
  identity reads. Missing entities are null. Deletion cancels stale reads,
  caches null and refreshes lists without blocking completion. Query is the
  sole cache.
- Creation uses `resources.macro.createDashboardWithChart` with the default Chart,
  without a dialog. Rename/delete dialogs preserve drafts and safe errors;
  deletion completes through hook-level callbacks, which see the latest route.
- Features never import app or siblings. Follow app/AGENTS.md and
  docs/architecture/widget-architecture.md.
