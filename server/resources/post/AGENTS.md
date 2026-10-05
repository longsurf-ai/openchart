# post

Owns published snapshots.

- Rule content uses saved `data.symbol` and scalar `data.value` (then
  `data.values.value`); never infer from inputs or current Rules.
- `schema.ts` owns durable shapes; `entity.ts` derives the read-only Resource.
  Trusted publishers call internal `transitions/publish.ts`; author, origin,
  publication keys, hashes and lookup stay private.
- Internal publication takes typed content and prepared bytes. Workspace owns
  media types; the tool rejects empty or oversized attachments before publication.
- Entity invariants cap text and media descriptions at 350 Unicode code points.
  Publication validates its derived write schema; Rule Posts truncate, preserving full Events.
- Publication keys identify requests, not Runs. Identical retries return existing
  Posts; changed retries fail. Internal request hashes allow replay before media reads.
- Rule/event/Run/Session and quote identities are historical references without
  cascading source FKs. Deleting sources preserves Posts and media. Quotes read
  current content; missing targets remain explicit.
- `post_media` belongs to its Post and cascades only on Post removal. Publish
  snapshots bytes in the same transaction. Pages never include bytes.
- Feed filters precede pagination; unread counts include history. Read preferences
  are transient. Resolve quotes after pagination. Stores own SQL; transitions own
  validation and transactions. No background jobs.
