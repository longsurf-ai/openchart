# dashboard

Owns navigation metadata and widget placements. The unique Chart retains
`dashboardId` ownership and its inner grid preset.

- schema.ts owns dashboard/dashboard_widget. Only the root has an envelope;
  widgets share its revision, have unique positions and kinds, and cascade
  with root deletion.
- Placements contain only id/kind/layout with integer x/y/w/h geometry in 12
  columns. Widgets query their own content. Kinds remain open; each may appear
  at most once per Dashboard. Entity invariants reject overlaps and duplicate IDs.
- Store maps positions to array order. Page roots before widgets;
  replacement/reorder shares the root's revision and transaction.
- Derive StoreBody from DashboardEntity. Internal writes may supply managed
  data; client schemas exclude it. SQLite owns timestamps; widget-only changes
  update the root while preserving createdAt.
- Adding/removing a widget changes only its placement. Removing Chart keeps
  its configuration; adding it again resolves that same Chart by dashboardId.
- Ordinary create produces an empty Dashboard without Feed access. The New
  Dashboard macro explicitly creates a default Chart and placement atomically.
- Catalog imports resource.ts; schema.ts stays independent of runtime composition.
