# Workspace Datasets

Publishes one runtime timeseries Dataset per `workspace_dataset` Resource.

- Resource changes drive the lifecycle: create declares and publishes
  `workspace.<id>`; a changed source, time or columns retires the instance,
  unregisters its name and publishes a replacement; delete withdraws it.
  Unchanged declarations keep instance identity, so Feed keeps its version.
- File edits never touch the lifecycle: every select reads the CSV now.
  Missing Workspaces or files fail `Dataset.NotFound`; text that does not match
  the declaration fails `Dataset.InvalidResult` with the row in `cause`.
- `csv.ts` owns RFC 4180 parsing and declared decoding: trimmed headers,
  empty cells as null, epoch-millisecond or ISO 8601 times, rows sorted by
  time. The declaration's own frame rejects repeated times.
- `datasets.ts` records owned declarations by identity; `feed.ts` binds only
  those to Feed `series`, keyed by Resource id.
- Observation subscribes before listing and resubscribes after overflow
  without retiring unchanged instances.
