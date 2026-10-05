# trigger

Owns user-authored "when this event happens, do that" definitions.
`server/trigger` matches and dispatches them; this Resource executes nothing.
See [alert-trigger](../../../docs/architecture/alert-trigger.md).

- A Trigger is `{event, target}`. `event` and `target` are strict
  unions discriminated by `kind`, owned by `schema.ts`. A new event source or
  action adds one variant; the table does not change.
- `target` reuses the shared
  [AgentPromptTarget](../../agent/contracts/agent-prompt-target.ts), the same
  value a Schedule stores.
- No foreign key to the event source, on purpose: deleting an Alert Rule does
  not cascade here. The Trigger service removes Triggers whose rule is gone,
  and an orphan never fires because its rule produces no events.
- Notification targets require `message` and may override `sound` with a catalog
  ID; omission follows Config, while `none` keeps the banner silent. Agent targets store full prompts.
  Text uses "{token}" syntax with backslash escapes for braces/backslashes.
  The Trigger service renders notification messages and prompt text parts only;
  never store rendered text or execution history here.
- Intrinsic create/patch/delete only.
