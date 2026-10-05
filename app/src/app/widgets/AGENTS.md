# Widget composition

- `widget-registry.ts` is the cross-feature inventory. `widgetCatalog` owns
  menu inventory and derives the registry passed to Dashboard.
- `widget-gallery.tsx` composes the shared DropdownMenu. Every selection adds
  immediately; Dashboard callbacks own placement writes and save recovery.
- Feature adapters remain in `features/chart` and `features/workspace`. Alerts
  are not a widget: the sidebar and Feed own them.
  Shared widget contracts and Context remain in `lib/widget`; the Dashboard
  feature owns placement layout, saves and the host. Features never import app.
- `workspace-file-beside.tsx` gives chart widgets WorkspaceFileNavigation that
  docks the file's Workspace widget beside them via Dashboard `placeBeside` and
  requests the file before the save, so Dashboard Retry still opens it.
- `workspace-chart-actions.tsx` gives Workspace widgets `WorkspaceFileActions`:
  the chart's `AddToChartAction` aimed at the header's target from
  `app/dashboard/selected-chart.ts`. The full-page Workspace gets none.
- Cross-feature widget integration tests live here; route/action tests stay
  with `app/dashboard`.
