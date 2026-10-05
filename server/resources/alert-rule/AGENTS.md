# alert-rule

Owns Alert definitions; `server/alert` observes them. Saving starts nothing.
See [alert-trigger](../../../docs/architecture/alert-trigger.md).

- `alertable` stores complete Tea source/config or a Drawing reference, operator
  and Bars inputs. Drawing geometry, derived Tea and runtime objects never persist here.
- Drawing session constraints derive from shared `SessionType`, including
  upstream `provider` sessions.
- Drawing deletion has no FK cascade: the Alert service disables orphan rules,
  retaining their history. Moving a Drawing leaves the Rule revision unchanged.
- Inline source is self-contained SQLite text, not a Workspace reference;
  registry imports only.
- `alertable.config` is Bars-only NodeConfig JSON, or
  `{indicatorId, parameters, requests}`: a value reference without FK, expanded
  when it runs. `save` stores canonical JSON. `schema.ts` checks each child
  `requests` node as one opaque NodeConfig leaf; `@openchart/tea` owns the
  recursion. Do not inline it.
- `enabled` alone decides liveness. `repeat = false` means one fire: the
  [recordAlertFire](../macros/record-alert-fire.ts) transaction disables the
  rule. There is no error, expired, or triggered state.

<!-- HUMAN-ANNOTATION:START -->

- `alertable` is server-managed; `save` owns creation and definition changes.
- Every saved definition must compile and validate, including disabled Rules.
- `enabled` only controls monitoring. Rules know nothing about Triggers.

<!-- HUMAN-ANNOTATION:END -->

- Metadata edits/deletion use intrinsic patch/delete. Deletion cascades
  [alert-event](../alert-event/AGENTS.md) rows; Triggers have no foreign key here.
