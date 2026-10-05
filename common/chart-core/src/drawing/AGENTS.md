# drawing

- `kinds/` owns attributes, paint/hit; `registry.ts` is exhaustive. Annotation
  and Agent scanners use batch layers. `types.ts` owns schemas/completion, without registry imports.
- Saved fixed geometry has exactly its required anchor count; freehand/polyline
  retain variable paths. Saved lines require distinct endpoints, areas require
  distinct times/prices, Fibonacci levels require a non-zero price difference,
  and paths cannot collapse to one point. Drafts remain incomplete `Item` values.
- `boundary.ts` shares Line/Quadratic recipes with renderer/Tea. Preserve order,
  backtracking, closure, triangle's ordinal midpoint and quadratic control.
  Never persist derived geometry or reconnect missing projected anchors.
- `boundary-labels.ts` owns centre-X placement and tangent/branch selection;
  pixel tolerances never define alert contact.
- `geometry.ts`: `indexFromTime` snaps legacy tools; `continuousIndexFromTime`
  interpolates finite paths. Both project blank margins without clamping.
  `render.ts` retains interaction's `DrawingRenderUtils`.
- Annotation stores content/time with empty anchors; `create` requires content.
  Optional `labelAnchor` is user-dragged only; automatic layout writes nothing.
- `agent_session` stores an anchorless ordered range. Ephemeral `sessionProgress`
  drives painting; absent progress paints nothing. Overlap groups are derived;
  never persist groups or Run state.
- Fibonacci ratios and channel geometry are shared by paint/hit/alerts.
- `startCap`, `endCap`, `middlePoint`, `priceLabels`, and `name` remain persisted
  intent; the renderer does not consume these decorations yet.
