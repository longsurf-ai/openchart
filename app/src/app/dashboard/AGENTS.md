# Dashboard composition

- `dashboard-page.tsx` binds route ID and transport to the Dashboard feature,
  ChartSelectionProvider and registry. Mounting creates no Resources.
- `dashboard-header.tsx` composes PageHeader, the selected Chart symbol and one
  Widgets dropdown from `app/widgets`. The widget catalog and render registry live
  there; feature grid/host components receive the registry through props.
  `selected-chart.ts` owns the target chart rule (active, else first chart widget;
  its focused cell), shared with Workspace widgets' Add to chart.
- Agent capabilities come from Layout's shared `lib/agent` Provider, without
  per-widget injection or definition overrides.
- `use-dashboard-actions.ts` owns route/sidebar coordination: New Dashboard saves
  immediately (no dialog) and navigates; rename and delete open
  dialogs. Dashboard owns their queries, mutations and form state.
- Query, geometry, widget cards, drag/resize, save recovery and settings drafts
  belong in `features/dashboard`, not this composition directory.
