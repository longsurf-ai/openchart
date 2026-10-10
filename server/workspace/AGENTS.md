# Workspace files

`resources/workspace` owns registrations; disk owns artifacts. Workspace owns
scoped observations and file APIs.

- Parse paths at transport boundaries; reject symlinks and hidden segments.
- Default originals reject mutations case-insensitively and read as
  `readOnly`; `installBuiltin` restores their bundled text.
- Root is immutable; operations require registration. Forget closes admission
  and subscriptions, drains mutations and releases watchers; never deletes files.
- Effect owns scopes, queues, retries and caches; Chokidar owns watching.
  RcMap shares shallow directory watchers by active consumer; no eager root watch.
  Directory/tree queries read metadata only; never cache text.
- Index non-hidden directories, including empty ones, separately from `.tea`,
  `.workflow.ts`, CSV, Python, PDF and supported media. `mkdir` stays inside
  the root; existing directories succeed.
- Read Base64 bytes, MIME and hash. Media reads
  cap at 32 MiB, including concurrent growth. Scans omit oversized media;
  explicit reads fail with `WorkspaceMediaTooLarge`.
- Text writes reject binary paths. Reads never install dependencies or support
  files. Workflow owns execution.
- Hash exact bytes on reads/CAS. Serialize writes, never directory listings;
  external editors share no lock. Committed writes need no scan. Missing and unavailable differ.
- Errors stay in errors.ts; structured conflicts use the shared boundary.
  Watcher events invalidate, never transact.
