# Widget composition

- `widget-registry.ts` is the cross-feature inventory: `widgetCatalog` feeds
  the menu, and `resolveWidget` is the resolver passed to Dashboard. Each kind
  occurs once; the menu disables placed kinds.
- `widget-gallery.tsx` adds placements immediately, passing definitions.
  Chart offers symbol selection when its grid is missing; Watchlist selects
  lists in its view. Dashboard owns placement writes and save recovery.
- Feature adapters stay in `features/chart`, `features/workspace` and
  `features/watchlist`; Watchlist gets SymbolPicker through
  `WatchlistSymbolPicker`. Alerts are not a widget. Contracts stay in
  `lib/widget`. Features never import app.
- `custom/` runs saved custom widgets (`custom:<kind>`): `sdk.ts` is
  `@openchart/widget`, `custom-widget.tsx` owns the module table and
  evaluation, and `symbol.tsx` aims the header's symbol control at widgets
  calling `useSymbol`. Keep `widgetModules` equal to `tooling/widget-types.ts`. See
  [custom widgets](../../../../docs/architecture/custom-widget.md).
- `workspace-file-beside.tsx` docks a chart's file in the Workspace widget via
  `placeBeside`, requesting it before the save so Retry still opens it.
- `workspace-chart-actions.tsx` gives Workspace widgets the chart's
  `AddToChartAction` for the Chart's focused cell.
- Cross-feature widget integration tests live here.
