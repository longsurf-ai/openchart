# Alerts

[Contract](../../../../docs/architecture/alert-trigger.md).

- Page and dialog share one editor, which publishes its rule ID via
  `useAssistantContext`. Capture revisions on mount; refreshes and closing keep
  drafts. Saves are atomic; `save` validates.
- Tea source and canonical config JSON stay authoritative; mounting never
  dirties a rule. Preserve invalid JSON. Conditions exactly project
  starters/generated programs and edit the market root Bars inputs share
  (`alertConfigMarket`); saving needs Bars or a followed Indicator. Custom code
  resets only when confirmed. Use upstream React Query Builder.
- A followed Indicator (`indicatorId` config) shows read-only as its chart
  market; its outputs join Conditions as `indicator.<output>`.
- Drawing rules keep fixed symbol/Price, linked Value and captured bars;
  boundary shapes add Touch; history uses saved contacts.
- App injects composer and market selector. Preserve
  Parts/model/workspace/binding and sibling Trigger IDs; actions edit
  independently until Save. Sounds store only an optional override; previews
  never save.
- New rules default to removable Agent and notification actions; Then/And are
  independent Triggers. Paused actions keep state; notification-only needs no
  model. Editing admits no Runs.
- `api/` owns RPC/cache invalidation; health lacking a ready connection or
  Status is unknown. Unchanged Rules never restart Tea. Read marks stay
  device-local. Use Sonner for failures.
