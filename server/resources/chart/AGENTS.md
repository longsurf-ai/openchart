# chart

Owns Chart persistence.

- Only roots carry envelope/revision. Children derive fields/defaults from
  schema; array order supplies positions, nesting parentage. Sort links by ID.
- dashboardId is unique and is the list key. Store and SQLite enforce uniqueness,
  also for moves. Filter/window roots before batched child reads; listing never
  queries Dashboard.
- Save replaces children with supplied identities/order; root identity and
  creation time stay. Writes, revision and decoding are atomic.
- Each cell has one main market series; source/pane determine its primary
  listing/pane, independent of order. Empty grids are valid; every saved
  pane has bindings. Remove the pane with its last binding in one edit.
  Hidden/failed series retain bindings; presets retain cells.
- Series bind same-cell sources without owning them. `output` names what is
  drawn: market `price`/`volume` or an indicator output; main draws price. IDs
  are unique per table; link endpoints differ; directed pairs unique.
- Keep relational checks in ChartEntity withInvariants: stable codes, JSON
  Pointer paths. Composite FKs enforce endpoint membership.
- Inputs retain provider-scoped Listing JSON. Cells own resolution/session/adjustment.
  Session constraints follow `SessionType`: regular, extended, and 24h.
  Links synchronize listing/crosshair only.
- Bindings name [Indicators](../indicator/AGENTS.md) by value, without FKs;
  macros keep them paired. Reject undeclared fields.
