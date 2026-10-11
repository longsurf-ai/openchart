# collection

Runs one Workspace Dataset collection without awaiting it. Resources own the
declaration and approval; Scheduler owns timing; this module owns execution.

- `collect(id, intent)` switches on the Dataset's `collection`: an
  `agent_prompt` is admitted through `admitPromptTarget` with the Dataset
  attached in its source Workspace; the Run is its status. Admission is
  serialized, and queued/running Runs under `collection:<id>:` block overlapping
  collections, including across restarts. Retries keep their Dataset/intent.
  A `script` runs a snapshot of bytes matching `approvedScriptHash`.
- Missing Datasets fail `ResourceNotFound`; no collection or an unapproved
  script or active collection fail `ResourceStateInvalid`. Scheduler accepts
  those fires without work.
- `uv.ts` installs the pinned uv on first use through the model runtime
  installer, then runs `uv run --script` in the Workspace root with app-owned
  Python and caches. Each run owns a hidden script snapshot and output staging
  file. Only a zero exit publishes its output; cleanup removes only its own files.
- One Monitoring check per Dataset (`collection/<id>`) reports each
  script outcome, so scheduled failures notify. Agent prompts report via Runs.
- The layer is built above application services and captures them, so
  `collect` has no requirements. Its scope stops running scripts.
- `collection.scriptTimeoutSeconds` is read at each run.
