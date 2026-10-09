# chart

Owns Chart persistence and invariants.

- Only roots carry envelope/revision. Children derive fields/defaults from
  schema; array order supplies positions, nesting parentage. Sort links by ID.
- dashboardId is the list key. Filter/window roots before batched child reads
  in one transaction; listing never queries Dashboard.
- Save replaces children with supplied identities/order; root identity and
  creation time stay. Respect FKs. Child writes, revision and decoding are atomic.
- Each cell has one main market series; source/pane determine its primary
  listing/pane, independent of order. Empty grids are valid; every saved
  pane has bindings. Remove the pane with its last binding in one edit.
  Loading/hidden/failed series keep their bindings and panes.
  Presets retain cells.
- Series bind same-cell sources without owning them. `output` names what is
  drawn: market `price`/`volume` or an indicator output; main draws price. IDs
  are unique per table; link endpoints differ; directed pairs unique.
- Keep relational checks in ChartEntity withInvariants: stable codes, JSON
  Pointer paths. Composite FKs enforce endpoint membership.
- Inputs retain provider-scoped Listing JSON. Cells own resolution/session/adjustment.
  Session constraints follow `SessionType`: regular, extended, 24h.
  Links synchronize listing/crosshair only.
- Bindings name [Indicators](../indicator/AGENTS.md) and Dataset columns by
  value without FKs; macros pair Indicators. Reject undeclared fields.
