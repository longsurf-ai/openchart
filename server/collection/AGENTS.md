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
- `uv.ts` installs pinned uv through the runtime installer. Script snapshots,
  Python and caches are app-owned. Scripts are self-contained with PEP 723
  dependencies; Workspace modules/config and inherited Python paths are excluded.
  The Workspace remains cwd for data. Each run owns its output staging file;
  only a zero exit publishes it, and cleanup removes only that run's files.
- One Monitoring check per Dataset (`collection/<id>`) reports each
  script outcome, so scheduled failures notify. Agent prompts report via Runs.
- The layer captures application services. `collect` has no requirements;
  scope cleanup stops scripts.
- `collection.scriptTimeoutSeconds` is read at each run.
