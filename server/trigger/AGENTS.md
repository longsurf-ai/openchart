# trigger

Owns best-effort Trigger execution. See [contract](../../docs/architecture/alert-trigger.md)
and [Post publication](../../docs/architecture/posts.md).

- `trigger.ts` is the service; registration starts nothing. `background.ts` owns
  its scoped fiber, interrupted/joined before dependencies close.
- Sweep orphans once, then consume ID-only Bus events. Read source facts from
  Resources; log/skip missing events. Match enabled Triggers by kind/ruleId.
- One source branch and target switch, no registry. Dispatch sequentially and
  independently. Expected failures log/skip; defects/interruption propagate.
  Overflow logs and resubscribes, losing that gap. No replay, throttle or retries.
- `serialize.ts` owns pure token rendering: fixed fields, explicit data scalars,
  parameters, then values. Unknown tokens stay literal; backslashes escape.
  Render text Parts only; never infer identity from nested inputs.
- Agent admission uses shared `admitPromptTarget` and stable intent
  `trigger:<triggerId>:<eventId>`. Add original Post context/publication instructions
  inside the same prompt; never modify stored targets or await Run execution.
- `post-context.ts` alone parses Alert intents, resolves retained originals and
  reads Feed executions and publication presence. Edit links require the current
  matching Agent Trigger and Rule. Reads never admit work.
- Test with isolated SQLite; no test-only service APIs.
