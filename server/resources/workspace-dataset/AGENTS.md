# workspace-dataset

Owns Workspace Dataset declarations: which CSV file holds a timeseries, its
time and observation columns, and how the file is collected.

- The Workspace file owns rows; this Resource owns only the declaration. The
  workspace Provider derives one runtime Dataset per Resource.
- `collection` is an `AgentPromptTarget` or a `script` run by `uv run --script`.
  A `.workflow.ts` is an Agent prompt holding one WorkflowPart, not a third kind.
  CRUD never runs a collection; Collection and Scheduler do.
- `approvedScriptHash` is server-managed: client creates and patches cannot
  write it, and edits preserve it. Only `approveCollection` sets it, from the
  application, so an Agent cannot approve the script it wrote.
- Column names are distinct and never `time`; the Provider rejects a column
  that repeats the time column when it reads the file.
- Chart series bind Datasets by value with no FK; charts skip missing ones.
