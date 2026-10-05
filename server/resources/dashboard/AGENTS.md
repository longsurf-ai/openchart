# dashboard

Owns navigation metadata and widget placements. Charts retain dashboardId
ownership and their inner grid preset.

- schema.ts owns dashboard/dashboard_widget. Only root has an envelope; widgets
  share revision, have unique positions, and cascade with root deletion.
  Referenced resourceId values imply no ownership or cascade.
- Placements contain id/kind/resourceId and integer x/y/w/h geometry in 12 columns.
  Chart requires a Chart ID; Workspace shows all directories with no reference.
  Other kinds remain open. Missing targets remain references, not cascades.
  DB checks enforce bounds; entity invariants reject overlap, duplicate placement
  IDs and multiple Workspace widgets per Dashboard. Chart references may repeat.
- Store converts NULL references to omitted fields and positions to array order.
  Page roots before their widgets; replacement/reorder shares revision and transaction.
- Derive StoreBody from DashboardEntity. Internal writes may supply
  managed data; client schemas exclude it. SQLite owns timestamps; widget-only
  changes still update the root while preserving createdAt.
- Create Chart + placement uses the application macro in one transaction.
  Removing a placement does not itself delete its referenced Resource.
- Ordinary create produces an empty Dashboard without Feed access.
- Catalog imports resource.ts; schema.ts stays independent of runtime composition.
