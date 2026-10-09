# collection

Runs one Workspace Dataset collection without awaiting it. Resources own the
declaration and approval; Scheduler owns timing; this module owns execution.

- `collect(id, intent)` switches on the Dataset's `collection`: an
  `agent_prompt` is admitted through `admitPromptTarget` with the Dataset
  attached; the Run is its status. A `script` runs only when its current
  Workspace hash equals `approvedScriptHash`, one run per Dataset.
- Missing Datasets fail `ResourceNotFound`; no collection or an unapproved
  script fail `ResourceStateInvalid`. Scheduler accepts those fires without work.
- `uv.ts` installs the pinned uv on first use through the model runtime
  installer, then runs `uv run --script` in the Workspace root with app-owned
  Python and caches. Scripts write `OPENCHART_OUTPUT`; only a zero exit renames
  it onto the data file, so failures never clobber data.
- One long-lived Monitoring check per Dataset (`collection/<id>`) reports each
  script outcome, so scheduled failures notify. Agent prompts report via Runs.
- The layer is built above application services and captures them, so
  `collect` has no requirements. Its scope stops running scripts.
- `collection.scriptTimeoutSeconds` is read at each run.
