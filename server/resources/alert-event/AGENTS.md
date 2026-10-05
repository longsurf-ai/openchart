# alert-event

Owns the durable history of alert fires as a read-only Resource.
See [alert-trigger](../../../docs/architecture/alert-trigger.md).

- Every domain field is server-managed and `readOnly` hides intrinsic
  mutations: get/list use `ruleId` as the only list key.
  The backend writes through the internal intrinsic create inside
  [recordAlertFire](../macros/record-alert-fire.ts); add no custom transition
  for insertion.
- `condition` is the source's stable condition id; `time` is occurrence epoch
  milliseconds. `detail = {title, message, data}` stores source-authored text
  and JSON facts. Source adapters provide explicit scalar identity fields;
  consumers never infer event identity from nested inputs. No action-rendered
  text, read state, or Run link belongs here.
- `(ruleId, condition, time)` may repeat. Never add a unique key or dedupe:
  the script alone decides fire frequency.
- The required Rule foreign key cascades on Rule deletion; the database
  publishes each cascaded removal.
