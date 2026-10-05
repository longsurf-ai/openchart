# Posts and Feed

```text
recordAlertFire -- transaction --> Alert Event + Rule Post + Once retirement
       |
       +-- committed Bus event --> Trigger --> accepted Agent Run
                                                   |
                                           publish_post tool
                                                   |
                                   Post + owned media byte snapshots
                                                   |
                         Resource queries --> Feed / quoted Post
```

`resources/post` owns published content. Alert Event remains the occurrence
ledger; Run owns execution. Posts retain source identifiers without cascading
source foreign keys, so deleting a Rule/Event does not erase published history.
Each Post has the standard Resource envelope, author/origin snapshots, ordered
content, and a nullable quoted Post ID. Quotes resolve current
published content; a retained quote ID with no target renders an unavailable state.
Post revisions are Resource revisions, not retained historical versions.
Rule Posts retain source-authored title/message and prefix explicit saved symbol
and scalar value (`data.value`, then `data.values.value`). Input bindings/current
Rule configuration never supply historical identity or values. A forward data
migration enriches existing source-backed Posts without replacing source snapshots,
creation time, attachments, or IDs; missing sources remain unchanged.

Content interleaves Markdown text, media references, and Resource references.
Text blocks contain only `type: "text"` and `text`; there is no format selector.
`PostEntity` declares a `withInvariants` limit of 350 Unicode code points across
text blocks and media descriptions, including Markdown syntax and whitespace. Publication
validates the assembled content through the derived entity write schema before
inserting. Rule Posts truncate with an ellipsis within this limit, preserving the
complete Alert Event. Resource references and quoted Post content do not count.
A forward migration truncates existing overlong content without changing Post
identity, publication keys, timestamps, references or media bytes.
Pure-media Posts are valid. `post_media` stores immutable bytes, MIME, and filename
and cascades only with its owning Post; paginated responses never contain bytes.
Media reads have a 32 MiB ceiling and publication limits combined attachments to
32 MiB. Workspace checks size before reading and bounds streamed bytes against
concurrent growth; scans omit oversized binary files. Media paths must point to
supported binary artifacts, not arbitrary text or outside-Workspace paths.
Workspace owns supported media types. The tool decodes Workspace Base64 once,
rejects empty attachments, and passes prepared bytes to the typed internal
publisher; publication validates the assembled Post content without decoding media again.

`publish_post` accepts authored content and an optional quote. The host
passes `rootRunID` through the invocation and tool contexts. The current persisted
Assistant supplies the provider and Session; a child invocation may use a different
provider from its root Run. Origin records both the root Run and actual publishing
Session. Trigger alone interprets its `trigger:<triggerId>:<eventId>` intent and
resolves the original retained Rule Post. Posts from Alert executions quote that
original.

Publication keys identify one event or tool call, never all posts in a Run. A
same-request replay returns the existing Post; changed input for the same key
fails. Internal publication is not registered as a public custom transition:
Post RPC is read-only and `resource_mutate` cannot forge author/origin. Media is
resolved before the caller-owned publication transaction; Posts and bytes commit
together. Rule Post publication shares the Event/Once transaction.

Trigger appends publication instructions and the original Post reference to the
same accepted prompt. It does not send a second prompt or rewrite the saved action.
Every Alert Agent task is instructed to publish its final analysis; completion
without any published Post is displayed explicitly, not converted into a fabricated
summary or an automatic retry. Multiple Posts from a Run remain valid.

`post.feed` reads all published Posts, including ordinary conversations, schedules
and Alert origins. Optional Rule/search and device-local unread filters apply
before newest-first `(createdAt,id)` pagination. No provenance or storage changes
are required: non-Alert Agent Posts already use `agent_run` with a null Alert reference. Quotes resolve only after
selecting the page. Exact unread counts include unloaded history. `resources.macro.alertFeedExecutions`
reads accepted Runs and their persisted Post publication presence; links survive
Trigger changes, while Edit prompt is available only for a current matching Agent action
and Rule. No read or navigation admits work.

Resource and Agent events invalidate query families; reconnect rereads canonical
state. Feed is an independent `/app/feed` page. Main navigation offers New Alert,
while saved Rules sit alongside Dashboards and Chats. Feed’s creation icons reuse
the existing Alert creation menu and Schedule dialog; it has no Rule navigation rail.
The widget keeps the compact Rule/history view. Post rows use the shared
theme tokens. The page, chart dialog, and widget share the If/Then/And
Rule editor; Conditions and Code edit one Tea source/config, while Chart adjusts
only the bound Drawing Resource. Save uses atomic Rule/action revision checks.

Search is a bounded (200-character) literal substring over saved author names,
provider IDs, text blocks and media descriptions. SQLite `lower` provides ASCII
case folding; `%` and `_` are literal characters, not wildcards. It uses the same
filtered cursor query, without an index or separate search service. Clicking a
Post marks it read locally; title links navigate to existing Rules. Page headings
belong to the fixed SectionPage header, while shared dialogs retain their titles.
