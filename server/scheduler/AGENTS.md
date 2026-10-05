# scheduler

Owns best-effort dispatch. See [scheduler contract](../../docs/architecture/scheduler.md).

- Service.runLoop owns scanning; runNow admits immediately even when disabled,
  preserving definition/cursor. Layer registration starts no work; background.ts
  owns the scoped loop, interrupted and joined before dependencies close.
- Scans fix a cutoff, read Schedule/Occurrence through intrinsic listAll in one
  read transaction, filter eligibility, and sort by nextFireAt/id. Admit sequentially
  after that transaction; never await Run execution or starve later fires.
- Intent is schedule:<scheduleId>:<fireAt>. AgentRunStore.getByIntent supplies the
  canonical accepted Session/input on retry; edits never replace that request.
- Manual fireAt uses the server clock; coincident timed fires share admission.
- Admit via shared admitPromptTarget (Session operations, submitPrompt). Session
  resolution, Run admission, ensureOccurrence, and cursor advancement remain separate
  commits. Never wrap them in an outer transaction or duplicate their rules.
- Record acceptance idempotently, then advance the cursor only if selected revision
  and cursor still match. Preserve concurrent edits, pauses, and deletion.
- Cron resumes at the next future instant without replaying missed intervals.
  Accepted one-time fires are exhausted without changing user-authored enabled state.
- Scan failures log and retry; manual errors and defects/interruption propagate.
  Agent owns execution and crash recovery.
- Test public Service with isolated SQLite/TestClock; expose no test-only APIs.
