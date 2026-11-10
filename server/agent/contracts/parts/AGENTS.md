# parts

Owns concrete Part schemas and nested content; `part.ts` owns the public union.

- Each `*-part.ts` owns one variant. PartBase has `id` and `messageID`; no
  `sessionID` or origin flag. Consumers import `@openchart/server/agent/contracts/part`.
- Import Effect schema primitives, shared base and sibling Parts;
  never aggregate Part, Message, anchor, or prompt input contracts. Tests may use aggregates.
- Text uses `synthetic` for model-only content; metadata does not control visibility.
- Tool `providerMetadata` serves replay; `state.metadata` serves execution.
  Input comes from tool calls, not persisted fragments. Preserve
  unique `childSessionIds` across terminal states. Links describe direct child Sessions. No displayData or per-tool card schemas.
- Context has one durable payload. Quote stores only text; dig-in selection lives
  in Session anchors. Resource definitions own resolution;
  this package owns no resource-kind whitelist.
- Plugin context records `pluginId`, `hook`, `content`, optional `marketIdentity`
  (null for unverifiable legacy provenance). Part ID owns identity;
  plugin/hook pairs may repeat and establish no trusted authorship.
- `plugin-input-part.ts` reuses `BarsSeries` from `@openchart/feed/bars` for
  required Chart Explain resolution/session/adjustment snapshots.
- WorkflowPart is immutable intent. Assistant lifecycle determines execution
  progress; do not add Part consumption state.
- Document evidence remains immutable input; the server evidence owner
  materializes bounded blocks before replay.
