# Assumption

- Every Resource can be rebuilt from its DB projection.
- The DB schema is the first-principles definition of a Resource's persisted structure. `entity.ts` derives domain fields from the DB schema and combines them with the shared envelope, exporting the Resource's single complete runtime shape. `defineResource` keeps that same Schema as `resource.entity` and derives ID rules and writable fields from it. The Resource's types, CRUD inputs and outputs, and agent-visible schema all derive further from this definition.
- IDs use `defineId` from `@openchart/identifier` to declare the prefix, brand, and `.create()`, the same mechanism Session uses. The Resource framework only composes the envelope and calls that constructor in the create transition; the default ascending generation rule is kept.
- A Resource describes user data; Dashboard, Chart, and Drawing all live at this layer. A Widget is a frontend unit of presentation and interaction.
- Symbology is also a Resource: it stores a rebuildable index of provider-native listings, not market bars. It is publicly read-only; only backend-only transitions can write search results or atomically replace a full index range. Feed owns external data fetching and indexing jobs.
- Data already modeled as a Resource is operated on by the Agent and the frontend through the same contract; frontend interaction state, market data, and Workspace disk files each have their own owner.

# Nomenclature

| Term               | Definition                                                                                                                      | Examples                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `WidgetKind`       | Stable string for a frontend presentation type; not a backend enum.                                                             | `chart`                                         |
| `WidgetDefinition` | Static definition: Content, optional Controls/Provider, icon, and default/minimum size.                                         | `features/chart/components/widget.tsx`          |
| `WidgetPlacement`  | One item in `dashboard.widgets[]`: id, kind, optional resourceId, and required layout. Shares the Dashboard revision.           | Chart placement on a Dashboard                  |
| `WidgetViewState`  | Frontend-only preferences that must survive a refresh, owned by the feature's Zustand store.                                    | chart viewport, column widths                   |
| `WidgetLocalState` | Temporary React state private to a Mount.                                                                                       | hover, uncommitted input                        |
| `WidgetMount`      | The React subtree currently mounted for a placement.                                                                            | one Chart widget                                |
| `WidgetHost`       | Composes Context, Card, error boundary, and the feature's Provider/Controls/Content.                                            | `features/dashboard/components/widget-host.tsx` |
| `WidgetContext`    | Plain React Context providing placementId, dashboardId, transport, and holdControls.                                            | `useWidget()`                                   |
| `DashboardLayout`  | The array reading order of placements and each one's `{x,y,w,h}` geometry. Chart's internal preset belongs to Chart separately. | 12-column outer grid                            |

For concrete component interfaces and interactions, see [Widget architecture](widget-architecture.md).

## Architecture

- Layered state modeling, plus a clear decision playbook (given a piece of state, you know where it belongs).
- Widget components subscribe to Query and Feed where they are used, reuse the existing transport and hooks, do not copy backend data, and do not require the Host to prepare data and pass it down layer by layer.
- A new presentation type needs only a frontend definition and a registry entry; the backend changes only when actual domain data or backend capabilities change. kind stays an open string.

# Concrete Architecture Choices

## State has 3+1 kinds, placed by priority

- WidgetLocalState:
  - Private to the Mount; the Host, other widgets, and the Agent cannot see it, so it is simply dropped on frontend refresh.
  - Stored directly in `useState()`.
- WidgetViewState (the placement of one widget on one dashboard):
  - Survives a frontend hard refresh, but not a change of device. Only that widget's renderer consumes it; the agent cannot see it: whether it is collapsed, column widths and sort, the chart viewport, pinned vs. linked. It is unrelated to the essence of a Resource; see "Content belongs to the Resource" below.
  - Stored in localStorage: the feature defines the schema and a Zustand persist store. It is usually isolated per placement; this round keeps the existing Chart cell preference and grid ratio keys, does not reset existing preferences, and does not add a generic ViewState framework.
  - If a read fails to parse, fall back to the default and warn; do not throw. Losing ViewState only returns to the default view; it is not data corruption. So do not write a migrate: when the schema changes, old data naturally resets. Only use persist's `version`/`migrate` when old data truly must be kept.
  - Every value must have a default.
  - Read and write it through the feature's own store/hook; WidgetContext does not proxy ViewState.
  - Widgets and Resources are decoupled: N\*M.
- Resource state:
  - This state is unrelated to the frontend. It models user data, and it is the only entry point through which the user or the agent changes user data.
    - A Resource is the unit of revision, and revision exists only for `expected_revision` conflict detection: two writes that must be serialized against each other must be values of the same Resource; only writes that need not be serialized may be split into two Resources. See "Relationships between Resources" for the test.
  - Resources exist essentially so that the user and the agent share the whole app.
  - Resources are flat: addressing is always `(resource, id)`, with no tree and no path. Ownership is just an FK on the child plus cascade; see "Relationships between Resources".
  - The Resource itself is the single owner of essential state; it is not projected into a separate Domain layer.
  - A Resource folder owns the entity, schema, store, and pure transitions. The persisted structure is defined first in the DB schema; `entity.ts` then derives the domain fields, and `defineResource` composes the envelope into the single complete runtime shape. The entity may add runtime constraints and annotations, but must not independently redefine the persisted fields.
  - Frontend components read and write Resources independently through the existing transport and React Query; the Query cache is a projection of backend data.
- +1: all world observation data can only come from the sources described in @data-access.md.
  - The frontend uses Feed hooks (for example `useBars`); backend Providers supply Datasets.

### Content belongs to the Resource; presentation belongs to the mount

What a widget shows is part of its Resource; how one mount presents it is WidgetViewState. A Chart's cells, panes, and series decide what is drawn, while its viewport, pane heights, and axis scaling only present it. A Watchlist's listings, sections, and columns decide what is tracked, while column widths, sort, collapsed sections, density, and decimals only present it. A value belongs to the Resource if any answer is yes:

- Does the Agent need to read or write it to fulfil a user request, such as adding a column?
- Should every placement of the same Resource agree on it?
- Does losing it discard authored work, rather than return the view to its default?

Market values a column displays are world data from Feed, never stored, even though the column itself is Resource state.

### Composed transitions are still transitions

A transition is a two-phase program with its input bound: `{resolve, apply}`. `resolve` is an Effect that runs outside the transaction; its result is passed as an argument to `apply(tx, resolved)`. `apply` runs its operations on the transaction it is given. Composing multiple transitions yields the same shape. Directories follow business ownership: a Resource's own operations live in its own directory; read/write operations that span Resources are called macros and live in `resources/macros/`. A macro is still an ordinary transition with no separate execution model.

**Transactor has only `run(transition)`** (`lib/resource/transactor.ts`): `resolve → db.transaction(tx => apply(tx, resolved))`. It does not understand Resources, CRUD, schemas, or revisions. Input is parsed once at the transport boundary; constructing a transition does no IO and generates no ids. If resolve fails, no transaction is opened; if apply fails, defects, or is interrupted, the transaction's writes roll back.

`defineResource({name, entity, store})` binds the schema, Store, and shared operation logic into `resource.transitions`: `get/list/listAll/create/patch/remove`. `lib/resource/intrinsic-transitions.ts` owns existence checks, id allocation, revision checks and increments, the writable projection, JSON Patch, and stored-entity parsing. Each intrinsic operation is wrapped with `Transition.from(tx => effect)` and uses `Effect.void` as its resolve. The Store owns only SQL and storage mapping; Resources do not repeat these shared rules. `resource.createSchema/updateSchema/listSchema` are still schemas, separate from `resource.transitions.create/patch/list`.

```ts
// body was already parsed at the transport boundary; construction runs no Store operations.
const program = Effect.gen(function* () {
  const transition = dashboardResource.transitions.create(body);
  return yield* Transactor.run(transition);
});
```

Intrinsic `create` and `patch` run `insert/save → toEntity` inside the same write transaction; the transaction can commit only after the complete stored entity passes schema parsing. A parse failure is a defect: writes to the parent table, child tables, revision, and timestamps all roll back together, and nothing is published. After commit, the already-parsed entity is returned directly without parsing again.

When external facts are needed, declare both phases with `Transition.make({resolve, apply})`, which keeps type inference from the resolve result to the apply argument. The composer orchestrates the child transitions' resolve and apply separately; the executor calls `run` once on the composed result. For example, the following composition shape, where `transitionA/B` are already-defined operations:

```ts
const combined = (input: Input) => {
  const a = transitionA(input.a);
  const b = transitionB(input.b);
  return Transition.make({
    resolve: Effect.all({ a: a.resolve, b: b.resolve }),
    apply: (tx, resolved) =>
      Effect.gen(function* () {
        const first = yield* a.apply(tx, resolved.a);
        const second = yield* b.apply(tx, resolved.b);
        return { first, second };
      }),
  });
};

const program = Transactor.run(combined(input));
```

External queries go in resolve; the current state of other entities that must be consistent is read in apply through the same tx. apply's Effect requires no additional services and cannot depend directly on Effect services such as Dataset; this is not a sandbox that forbids direct network calls or capabilities captured by closures. apply does not call `Transactor.run` again and does not open its own transaction. When resolvers depend on each other, the composed resolver orders them explicitly; if a later resolver depends on an earlier apply result, the phases must be re-split rather than pretending it can still complete outside the transaction.

Temporary database triggers collect the root rows that actually changed, including FK cascades; Database calls the injected `onCommitted` after the outermost commit. `lib/resource/events.ts` maps database changes to Resource events and publishes them in one place; the application assembly layer only injects the callback. Store, transitions, Transactor, and transport do not collect or publish events.

`defineResource` registers custom operations through `transitions: {promote}`; the key is the operation name, and the declaration does not repeat `name`. `Transition.make({input, resolve, apply})` keeps the type relationship between the input schema and both phases; once the input is bound, the declared `resolve(input)` and `apply(tx, input, resolved)` become the usual two-phase program. `resource.transitions.promote(input)` takes already-parsed input; construction runs no resolver or IO. The derived factory and the transport both use `Transition.bindInput` to bind a single declaration, so input-binding logic is maintained in one place. The framework also keeps `transitionDefinitions` for transport derivation: each custom operation generates a same-named tRPC procedure from the same input schema. `kind: "query"` generates a query; omitting kind or `kind: "mutation"` generates a mutation. The runtime route and client types keep the same kind, and resolve/apply execution is unchanged; a query declaration does not itself enforce that the Effect makes no writes. A custom operation cannot override an intrinsic operation or `delete`. The existing call shape of intrinsic CRUD is unchanged.

Custom operations are registered statically through `transitions: {ensureOccurrence}`. They can use their own Resource's Store directly and reuse the shared entity validation, existence checks, and revision checks. The operation itself is responsible for the ID and revision on write; it does not need the Resource passed in and does not import its own `resource.ts` back. For example, `ensureOccurrence` derives its input from the entity's domain fields and looks up the fire in the same tx: if it exists, it validates and returns it; otherwise it allocates an ID, inserts it at revision 1, and decodes the complete entity before commit. Cross-Resource macros compose public transitions; SQL stays encapsulated in each Resource's Store.

The current implementation includes the two-phase transition interface, intrinsic CRUD, internal composition, domain transitions, and backend query transitions for macros to compose. Custom queries already support tRPC derivation; Agent tools still do not expose custom operations.

### WidgetViewState is a frontend-owned schema

ViewState belongs to the feature; storage belongs to the browser. Zustand persist handles preferences that must survive a refresh;
temporary input and hover use React state. Neither Query results nor renderer instances may be stored in persisted preferences.
This round keeps `app/src/lib/chart/preferences.ts` and the existing grid ratio storage, and adds no unified Host store.

## Widget Injection

`WidgetContext` is a React Context declared in `app/src/lib/widget/widget.tsx`, containing
`placementId`, `dashboardId`, the shared `transport`, and `holdControls`.
The latter only keeps the floating toolbar visible while a portaled menu/dialog is open; components
acquire and release it automatically through `useWidgetControls(open)`.

The Host composes the Card and the optional Provider, Controls, and Content; feature components call Query, Feed, and
renderer hooks themselves. There is no unified four-handle resource/dataset/agent/view facade.
The header symbol control and Chart widgets share a single piece of frontend Chart/cell selection state; it contains no Resource
snapshot or renderer handle.

## How the frontend reads Resources and learns they changed

The frontend reads Resources in exactly one way: tRPC `get` and `list`, through TanStack Query's `useQuery`. The cache is a projection of the DB, not the truth. Here is how it learns about changes:

```
Any write (app tRPC, agent resource_mutate, composed or subscriber-triggered transitions)
  → Transactor.run: opens a Database transaction after resolve completes
  → transition.apply: performs writes, revision checks, and entity parsing in the same transaction
  → SQLite temporary triggers: collect the Resource root rows that actually changed, including FK cascades
  → Database: onCommitted([{table, id, revision}]) after the outer tx commits
  → Resource events: map and publish {resource, id, revision}
  → tRPC events.subscribe (SSE)
  → app lib/resource/invalidation.ts: invalidateQueries
  → TanStack re-runs get / list
  → widget re-renders
```

Four rules:

- Events carry no data, only `{resource, id, revision}`. This is invalidation, not push: the app refetches on its own, with no cache patching and no deltas.
- The app's own writes also go through this chain: a successful mutation invalidates locally once, then again when the SSE arrives; this is idempotent. Multiple windows and multiple desktop views need nothing extra.
- It does not go through Hose. Hose is the channel for world data; Resource events go through tRPC SSE, and the whole chain lives on the Effect side.
- Events are live-only, not a log. On SSE reconnect, `invalidateQueries()` with no arguments refetches everything; user data is bounded.

`server/db/event-detector.ts` owns change detection and the timing of the post-commit callback; the DB only hands over the committed change set of `{table, id, revision}` and does not depend on Events or the Resource event protocol. `lib/resource/events.ts` owns `makeOnCommitted(events)`, which maps root table names to Resource names and publishes through the shared Events service; `runtime.ts` only obtains the shared Events instance and constructs and injects the callback. The Store only maps reads and writes; intrinsic Resource transitions own revisions and entity validation. After migrations finish, Database identifies Resource root tables by the four shared envelope columns; a root table's SQL name is the Resource name. It installs connection-scoped TEMP triggers on root tables to record insert/update/delete, including cascade deletes that never pass through a child Store. Internal child tables have no envelope; changes to them must update the Resource root row and revision in the same transaction.

The change set is also a TEMP table that keeps, per `(table, id)`, the revision of the last change in the transaction. Only the outermost transaction reads and clears the set before commit, and after a successful commit it passes a non-empty set to `onCommitted`. Savepoints do not call the callback; a rollback or interruption undoes the change records along with everything else. Writing a Resource root table outside a managed Database transaction fails immediately. Startup publishes no historical data; the temporary detector does not change the persisted schema and introduces no event log. Delete events keep the deleted row's revision; the protocol is still only `{resource, id, revision}`.

Query keys derive from router paths, and router paths derive from `resources[]`, always as `resources.<resource>.<action>`, so the key's path prefix is `['resources', resource]`. A widget does not need to register what it uses; the keys in the cache show who on screen is using what:

```
trpc.resources.dashboard.get({id})          →  [['resources', 'dashboard', 'get'],  {input: {id}}]
trpc.resources.chart.list({filter: {dashboardId}}) → [['resources', 'chart', 'list'], {input: {filter: {dashboardId}}}]
trpc.resources.drawing.list({filter: {dashboardId}}) → [['resources', 'drawing', 'list'], {input: {filter: {dashboardId}}}]
```

Three levels of granularity, which stack rather than being alternatives:

| Level                  | Where                                                   | What it decides                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resource`             | the `['resources', resource]` path prefix of the key    | invalidates all queries for this Resource                                                                                                                               |
| `resource/id`          | the input of `get`                                      | invalidates only this entity's `get`; list still goes by Resource, since going finer would need a membership index, which is not worth it                               |
| `resource/id/revision` | the event's revision vs. the cached entity's `revision` | not enabled yet: delete events keep the old revision, so the same version must still be invalidated; skipping by version would first require extending delete semantics |

The first two levels are key structure and decide the invalidation scope; the third is not in the key, because revision is a data version, not a query identity. The first version implements only the first level: a blanket cut on the `[['resources', resource]]` prefix, so delete events at the same version also trigger invalidation.

## Resource list filtering and pagination

`entity.ts` applies `listKey(schema)` to top-level scalar fields that may be queried, such as chart's `dashboardId`; `defineResource` derives the `listSchema` input schema and `listKeys` metadata from these fields, so there is no hand-written array of field names. `listKey` and `serverManaged` can be stacked in any order: queryability and writability are independent dimensions. A `listKey` on an internal field, an object, or an array fails immediately when the Resource is assembled.

Filtering uses the entity's canonical read values and field constraints; it does not inherit create defaults, transforming codecs, or the full entity's cross-field rules. Each key is optional, and omitting it means no filter on that key; provided fields match by equality, and multiple conditions are ANDed. Unknown keys fail when parsed at the boundary. The shared input is `{filter?, limit?, cursor?, order?, orderBy?}` and the output is `{items, nextCursor}`; `list()` and `list({})` default to 50 items, and limit is at most 200. No match returns `{items: [], nextCursor: null}`, with no extra check that the parent exists.

`lib/resource/pagination.ts` owns input limits, page results, and cursors; `pagination-sql.ts` generates the SQL window in one place. HTTP and the Agent use the same opaque string cursor: the framework serializes the last row's `{createdAt, updatedAt, id}` from the previous page to JSON and encodes it as base64url; callers pass nextCursor back unchanged and never interpret or construct the token. The shared `ListCursor` codec decodes and strictly validates it once at the Resource input boundary, and the Store only receives the decoded position; `encodeListPage` returns the token, and the transport does no separate encoding. An invalid token is rejected as an input error before the Store is touched. No secret key, token storage, or database schema change is needed. By default, SQL compares strictly greater than in ascending `(createdAt, id)` order; `orderBy: "updatedAt"` switches to the update time, and `order: "desc"` reverses both the sort and the cursor comparison. Rows with the same time are ordered stably by id, and deleting the cursor row does not break continuation. Sorting happens before pagination; nothing is fully loaded for the frontend to sort. It is a live list, not a cross-request snapshot: continuation pages keep the same filter, order, and orderBy, and inserts, deletes, and changes to sort or filter fields become visible according to each transaction's current data.

The router parses once with the derived schema, and the intrinsic list transition passes the typed filter and a window with `limit + 1` rows of lookahead to `Store.list(tx, filter, window)`. The Store combines filter, cursor, sort, and limit in SQL; the framework drops the lookahead row and builds nextCursor from the last returned record, returning null when there is no next row. The framework never reads everything and then paginates. chart's `list({filter: {dashboardId}})` first narrows the root rows, then assembles internal grid tables only for rows in the window; dashboard likewise only queries widgets within the window, Workspace paginates over registration rows, and Occurrence paginates directly on the join query.

## Resource API operation exposure

`defineResource({readOnly: true, ...})` only turns off the public intrinsic create/patch/delete; it defaults to false when omitted. `resourceRouter(definition)` always generates get/list and the explicitly declared custom transitions. A readOnly Resource's intrinsic mutations exist neither in the tRPC routes nor in the generated client types; custom transitions generate a same-named query or mutation by kind. `resources/router.ts` aggregates these derived routes through `resourceRouters(resources)`, and mounts cross-Resource operations flat under `resources.macro.*`. Alert authoring and event Session queries reuse the existing query transition mechanism; the Alert Rule `save` transition validates and writes the server-managed `alertable` (including disabled) in one place, and the save macro and the dedicated Agent tool reuse it.

Occurrence sets `readOnly: true` on its own Resource definition. All fields remain server-managed, clients have no create, patch, or delete entry point, and the explicitly declared `ensureOccurrence` is exposed through tRPC. The Resource definition and Store always keep the full internal operations: the backend passes a complete body to the same `resource.transitions.create`, which, via `Transactor.run`, allocates id/revision, writes the Store, parses the complete entity, and commits; internal updates can call the full Store from a Transition. `readOnly` only restricts the public intrinsic mutations and does not affect these internal capabilities.

## What are Agent progress and results?

- Agent content is unrelated to Resources.

## Where state lives

|           | App                      | User/Agent                      | World                        |
| --------- | ------------------------ | ------------------------------- | ---------------------------- |
| Persist   | Zustand / `localStorage` | React Query / Resource API / DB | Feed hooks / backend Dataset |
| Ephemeral | `useState()`             | N/A                             | N/A                          |

## Relationships between Resources

Resources are flat: addressing is always `(resource, id)`, with no path. The tree lives only in database FKs.

```
dashboard         name, favorite ──value──> widgets[{id, kind, resourceId?, layout:{x,y,w,h}}]   inline; resourceId is a reference
    ├──owns──> chart (dashboardId ⇒, preset) ──value──> cells[{marketSources[], panes[{series[]}]}]   inline
    │             └──owns──> indicator (chartId ⇒, cellId, source, snapshot)   series reference it by value
    └──owns──> drawing (dashboardId ⇒, listing)

workspace         independent; root is immutable after creation; artifacts are referenced as {workspaceId,path}
watchlist         independent ──value──> columns[], sections[{items[{provider, listing}], sections[…]}]   inline, recursive; placed by widgets[].resourceId
agent_schedule    independent
agent_schedule_occurrence → agent_schedule; also references agent_run
alert_rule        independent
    └──owns──> alert_event (ruleId ⇒)   read-only
trigger           independent; event.ruleId is a reference, no FK
```

Dashboard stores the name, favorite flag, and all widget placements. A Chart widget references a Chart through `resourceId`;
its `layout` is the outer position and size on the Dashboard, while the Chart's own `preset` and `cells[]` describe its internal split.
Chart still belongs to a Dashboard through `dashboardId`; this FK and the placement reference express different relationships.
Removing a placement only changes the arrangement and does not implicitly delete the Chart; deleting a Dashboard still follows the existing Chart/Drawing cascade contract.

Four relationships, four representations, and no fifth:

| Relationship                                    | Representation                                                                                                                               | Examples                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Ownership: the parent defines the child's scope | FK on the child; cascade or RESTRICT chosen by domain; `listKeys` filter on it                                                               | `chart.dashboardId`, `drawing.dashboardId`, `occurrence.scheduleId`, `alert_event.ruleId`                    |
| Reference: points to but does not own           | an id in the value; durable references that must keep their target use FK + RESTRICT, otherwise the consumer handles "target does not exist" | `occurrence.agentRunId`, `widgets[].resourceId`, `series.source.indicatorId`, `drawing.listing` (world data) |
| Internal structure: no independent identity     | the entity's value                                                                                                                           | `dashboard.widgets[]`, `chart.cells[].panes[].series[]`, `watchlist.columns[]`, `watchlist.sections[]`       |
| Derived: computable from other state            | not stored                                                                                                                                   | focused cell goes into ViewState                                                                             |

Nested collections are always arrays: anything ordered or with identity is an array whose elements carry ids, and the server fills in the id on append; addressing uses indexes, and safety comes from revision. Array order is defined by JSON itself, and reordering is RFC 6902 `move`. Do not use records keyed by id: no spec defines record key order, and the stability gained by id addressing would cost three new mechanisms, which is not worth it.

To decide whether a noun is a Resource or a field, first ask: **whose writes must its writes be serialized with?** Revision exists only for `expected_revision` conflict detection; anything that must be serialized belongs in the same Resource as a field. Anything that need not be serialized can be split, but splitting costs an FK, a composed transition, or a consistency invariant; if writes are infrequent and conflicts can be resolved by re-reading and resending, do not split. Adding an indicator to cell A and changing the symbol of cell B need not be serialized, but both are discrete, infrequent writes, so cells are inline in the chart. A user adding a watchlist while the agent edits a chart are unrelated and should not collide on revision, so chart is a Resource. Dragging a drawing is unrelated to any chart write, so it is a Resource. "Does anyone find it without going through the parent", write frequency, and count are all corollaries of this one question.

This rule does not ask "does it feel like the parent changed"; it only looks at whether a field was written. Adding a cell bumps the chart's revision, not the dashboard's.

Cross-Resource FKs are declared by the referencing side, so only `schema.ts` may import another Resource's `schema.ts`; no other file may. A cycle is not a database problem but a modeling error: one of the two FKs must be derived, or be a reference that should be its own table, or the two sides are really one aggregate.

## Current backend Resource catalog

This section records existing backend contracts. Workspace registers disk directories, and the file API reads and writes artifacts through the backend.

The current catalog has ten Resources: dashboard, chart, indicator, drawing, workspace, the agent's schedule and occurrence, plus alert_rule, alert_event, and trigger (see [alert-trigger.md](alert-trigger.md)). The envelope fields `id`, `revision`, `createdAt`, and `updatedAt` are declared once by the framework at the DB schema layer, and the entity derives from the same source. Resource transitions allocate id and revision and enter the transaction through Transactor.run; SQLite generates millisecond timestamps, insert uses DB defaults, update refreshes `updatedAt` in SQL, and the write interface does not accept timestamps. Only domain fields are listed below. `⇒` is cascading ownership. Schedule has no user ownership or soft-delete state; deleting it cascades to Occurrences while keeping Runs, Sessions, and transcripts. The Occurrence-to-Run reference still uses RESTRICT.

```
dashboard        name, favorite, widgets[{id, kind, resourceId?, layout:{x,y,w,h}}]
chart            dashboardId ⇒ dashboard, preset, links[], cells[{id, resolution, session, adjustment, marketSources[{id, provider, listing}], panes[{id, series[{id, role, source}]}]}]
indicator        chartId ⇒ chart, cellId, source{workspaceId, path}, snapshot{[path]: text}, parameterOverrides
drawing          dashboardId ⇒ dashboard, provider, listing, data (geometry, style, visibility)
workspace        root (immutable canonical directory)
agent_schedule   name, target, recurrence, enabled, nextFireAt
agent_schedule_occurrence   scheduleId ⇒ agent_schedule, agentRunId → agent_run, sessionId (projected from Run), fireAt
alert_rule       name, enabled, repeat, alertable{kind:"tea",source,config{inputs,map,parameters,requests} | config{indicatorId,parameters,requests}} | {kind:"drawing",drawingId,operator,inputs}
alert_event      ruleId ⇒ alert_rule, condition, time, detail{title,message,data} (read-only)
trigger          name, enabled, event{kind:"alert",ruleId}, target{kind:"notification",message} | {kind:"agent_prompt",prompt,binding?}
```

`watchlist`'s entity is:

```
watchlist        name, columns[{id, metric:{kind:"price" | "change" | "changePercent" | "volume"}}], sections[{id, name?, items[{id, provider, listing}], sections[…]}]
```

A watchlist is independent: Dashboards place it through `widgets[].resourceId` and never own it. Columns are an ordered JSON array on the watchlist row; each stores only its stable id and basic scalar metric. `watchlist/column.ts` owns the shared column contract and the metric union discriminated by `kind`; the database schema imports its type and the entity uses its runtime validation. Sections and items are internal child tables sharing the watchlist revision. Every section shares the watchlist's columns; sections never carry their own column layout. Sections nest in the entity to any depth, so the tree is its own source of truth: cycles and missing parents cannot be expressed, and moving a row or a whole subtree is one RFC 6902 `move`. In storage each section row records its `parent_section_id` and its position among siblings; the Store converts between rows and the tree. Inside a section both `items` and `sections` are required, because a decoding default inside the recursion would stop the Agent's JSON Schema export. A listing appears at most once per watchlist across all sections, and each metric appears at most once among its columns. Column values come from Feed; widths, sort, collapsed sections, density, and decimals are frontend view state.

`alert_rule`'s Tea config stores normalized JSON: either a NodeConfig whose inputs contain only Bars, or an Indicator-following `{indicatorId,parameters,requests}`; for the latter, inputs, map, and `nodes.indicator` are generated at runtime from the Indicator and the chart cell it lives in.

Among the currently registered Resources there are ownership FKs from chart to dashboard, indicator to chart, and Occurrence to Schedule, plus a reference FK from Occurrence to Run. Domain transitions include Workspace registration, idempotent Occurrence intake, and advancing the Schedule cursor. Ordinary writes use mutable domain fields plus the intrinsic create/patch/delete: adding a cell or changing the preset is `chart.patch`, adding/removing an indicator is `resources.macro.addIndicator`/`removeIndicator`, placing an existing widget or renaming is `dashboard.patch`, and none of them touch each other's revision.

`server/resources/agent-schedule/schema.ts` owns the `agent_schedule` table and its
prompt target and recurrence definitions, uses the existing shared envelope columns and constraints, and keeps the full
next-fire cursor. The entity, full Store, and CRUD routes are wired up. When a client creates a Schedule, changes its recurrence, or re-enables it, the cursor is computed strictly later than the current time; rename, target edits, and pausing keep the cursor, and internal writes may set it explicitly. If there is no future fire, it returns ResourceStateInvalid and rolls back, without starting any scheduled execution.
`server/resources/agent-schedule-occurrence/schema.ts` owns the separate
`agent_schedule_occurrence` table and Resource envelope, links to
Schedule and Run through required FKs, and keeps the `(scheduleId, fireAt)` and `agentRunId` unique constraints.
All Occurrence fields are server-managed, and internal writes keep the full body;
the application layer only exposes get/list.
The entity's required `sessionId` is a server-managed read projection that uses the shared `SessionId`
contract; the store reads it through the Run join and does not persist it again in the Occurrence table. A sessionId explicitly provided by an internal write must match the Run, otherwise the write rolls back.
Deleting a Schedule cascades to its Occurrences; an Occurrence does not own its Run or Session, and deleting it does not
delete the Session or transcript. Occurrence history is not embedded in the Schedule; the Run keeps owning execution state,
and its changes do not require bumping the Schedule or Occurrence revision. The Occurrence's full Store,
read-only routes, and shared pagination are wired up; scheduled execution is not implemented yet. A forward migration deletes old soft-deleted Schedules and their Occurrences,
keeping live/paused Schedules, the remaining Occurrences, and all Agent execution history.

`workspace` is marked readOnly and registers fixed physical directories; root cannot change after creation. The domain register transition confirms and canonicalizes the directory in the resolve phase, and the Store rejects duplicate/overlapping roots within the transaction; the forget transition only removes the registration, and the default cannot be removed. createLocal and the internal ensureDefault transition prepare the directory in resolve and reuse register in apply; ensureDefault finds or creates the default registration in the same transaction. The framework-generated intrinsics keep their ordinary implementation; the Resource router automatically exposes the register/forget/createLocal mutations and the getDefault query; getDefault only reads the default registration ID and neither prepares a directory nor creates a record. The Agent only reads registration records. File contents and indexes do not enter the Resource; file operations go through the separate Workspace service; see [workspace.md](workspace.md) for details. The old Tea draft/version tables were removed by a forward migration; already-applied migrations stay unchanged.

`widgets[]` already carries the Chart grid. The four integer layout fields of each item are required and have no defaults;
SQLite checks for non-negative positions, positive sizes, and `x + w <= 12`, and the Dashboard entity checks for unique IDs and non-overlapping rectangles. Chart/Workspace placements must carry a Resource ID of the matching type; Chart references may repeat, and there is at most one Workspace widget. Other widget kinds stay open and may omit a reference; if a referenced object later disappears, the placement stays valid and no cascade is introduced.
Array order is still stored separately as `position` and cannot be inferred from coordinates. Existing widgets were backfilled vertically in their original order,
and existing Charts without a placement get one appended by a forward migration; mounting a page never creates user data automatically.

Creating a Chart widget uses `resources.macro.createChartWidget({dashboardId, expectedRevision, chart, layout})`,
where chart is the existing Chart create body without dashboardId. The macro composes public transitions, creates the Chart and placement within one
Transactor transaction, and returns `{dashboard, chart}`; a revision conflict or failure in any step
rolls everything back. Dragging/resizing only patches the Dashboard; changing the internal split only patches the Chart.

The application RPC `resources.macro.createDashboardWithChart()` composes Dashboard create with `createChartWidget`
to create, in one transaction, a Dashboard named `New dashboard`, a Binance `BTCUSDT` daily Chart, and
a placement that fills the desktop content area (`x=0,y=0,w=12,h=24`), returning `{dashboard, chart}`. The fixed initial configuration uses the `24h` session, `raw`
adjustment, and price/volume in the same pane, and needs no Feed access. The New Dashboard frontend entry point calls this RPC,
caches the returned Dashboard on success, and navigates to it; the ordinary Dashboard create can still create an empty Dashboard.

All of a chart's panes exist explicitly. Each cell has exactly one main market series: its source determines the main listing and the pane it is in determines the main pane, independent of array position. A series source is a tagged union of marketSourceId or indicatorId, and both carry an output that says what to draw: for market, price or volume; for indicator, its output name. main can only be price, and its target must belong to the same cell; comparisons simply use ordinary series. indicatorId references the Indicator Resource by value, with no FK; two macros add and remove bindings together with their Indicator, and chart skips bindings whose target no longer exists. links are unordered directed relationships whose endpoints belong to the same chart and differ; the same cell pair in the same direction cannot repeat; the store returns links by id.

`preset` is a fixed layout template (`1`, `2x1`, `1x2`, `2x2`, ...); a cell's array index is its slot number. Cells beyond the preset's slot count stay in the array without rendering, and come back when switching to a larger template. The inner Chart layer has no free-form grid with compaction, so it has no geometry; reordering is RFC 6902 `move`. The outer Dashboard layer uses React Grid Layout and placement geometry.

How V1 maps to OpenChart:

| V1                                                               | OpenChart                   | Action                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard` + `dashboard_links`                                  | `dashboard`                 | Internal `preset`, `cells`, and links move to Chart; Dashboard arranges everything through `widgets[]`, with layout storing the outer x/y/w/h                                                                                                     |
| `chart` + `chart_panes` + `chart_series` + `indicator_instances` | `chart`                     | In V1 one row is one cell; in OpenChart one row is the whole grid: a V1 chart row becomes an element of `cells[]`, panes and series are inlined into it, and indicator becomes a Resource owned by chartId. `dashboard_id` ownership is unchanged |
| listing scope (virtual node)                                     | `drawing.listing`           | The node becomes a key. It never changes itself, and is not even a field                                                                                                                                                                          |
| `drawing`                                                        | `drawing`                   | As is. `dashboardId` is ownership and `listing` is the coordinate system; two fields replace a tree level                                                                                                                                         |
| `annotation`                                                     | a `kind` of `drawing`       | Merged                                                                                                                                                                                                                                            |
| `indicator_definition`                                           | Workspace artifact          | Editable Tea source is stored as `.tea` files; the execution snapshot is stored in the Indicator Resource                                                                                                                                         |
| `agent_schedule`                                                 | `agent_schedule`            | As is. User-authored, so it is a Resource                                                                                                                                                                                                         |
| `agent_schedule_occurrence`                                      | `agent_schedule_occurrence` | Stays a separate Resource linked to Schedule and Run through FKs; full backend Store, get/list API, and shared pagination                                                                                                                         |
| `watchlists` + `watchlist_columns`                               | `watchlist`                 | The recursive `root` tree becomes nested `sections[].sections[]`; `lid:N` keys and the derived `securities` map become provider-scoped listings; columns stay in the aggregate without per-group layouts; `settings` stays in the frontend        |

V1 watchlist custom and semantic columns, group aggregation, basket links, sharing, and curated fields are not migrated. Newsfeed, bookmark, basket, and research are not in the first version and are not written here. Alert and Trigger are modeled as Resources; Notification has no Resource; see [alert-trigger.md](alert-trigger.md). Dashboard links to Chart and Drawing through two FKs; Occurrence links to Schedule and Run through FKs; alert_event links to alert_rule through an FK. V1's topology.ts, Resource Tree, path addressing, and virtual scope nodes have no counterpart at all.

## Agent Resource handle

Three tools derive from the single `resources[]` in `server/resources/catalog.ts`, the same source as tRPC. The Agent reads complete entities and addresses them by `(resource, id)`. The Resource name for read/mutate is validated at the Tool boundary by the catalog-derived `ResourceName`; after that, only a synchronous lookup of the validated name happens.

| Tool              | Input                                                                                                                                             | Behavior                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resource_read`   | `{resource, id?, filter?, limit?, cursor?, order?, orderBy?, include_schema?}`                                                                    | With id, reads a single entity; otherwise lists. id cannot be combined with filter/limit/cursor/order/orderBy. filter only accepts listKeys derived from the entity's listKey, using the same schema and Store as tRPC; errors return rejected and allowedKeys. list uses the shared pagination and sorting and returns items and nextCursor.                              |
| `resource_mutate` | create: `{resource, op: "create", input}`; patch: `{resource, id, op: "patch", input, expected_revision}`; delete: `{resource, id, op: "delete"}` | Exposes only create/patch/delete; no custom transitions. create parses against the derived writable schema and the server allocates the id; patch input is an RFC 6902 array and must carry the latest revision; delete removes by id. readOnly Resources cannot be written.                                                                                               |
| `resource_search` | `{query}`                                                                                                                                         | Walks all Resources page by page in catalog order, each page in its own transaction; serializes each complete entity to JSON and does a case-insensitive substring match; returns `{resource, id}` in items, preserving catalog and pagination order. No FTS, ranking, or snippets. If any page fails, returns rejected rather than partial results disguised as complete. |

Tool output is JSON text and carries `status: "ok"` on success; read and create/patch return `entity`, list/search return `items`, and delete returns `resource` and `id`. `include_schema` adds `schema: {entity, listKeys, transitions}`: entity is the JSON Schema of the complete read shape, and transitions holds only the input schemas of intrinsic mutations, empty when readOnly; the create schema is the writable body, the patch schema is JSON Patch, and the delete schema is an id object. The JSON Schema keeps references and definitions. There is no fields projection or agent facade.

`{resource, include_schema: true, limit: 0}` returns only `status`, `resource`, and `schema`; it uses the read permission check but performs no data read and opens no Resource transaction. A positive limit returns the schema plus at most that many example entities; omitting limit still defaults to 50. limit 0 requires `include_schema: true` and cannot be combined with id/filter/cursor/order/orderBy; shared Resource pagination still accepts only a positive limit.

The Resource tool boundary turns input errors, domain failures, and unexpected defects into model feedback with `status: "rejected"`; unknown internal errors are kept in server logs and the raw error is not leaked. A conflict asks the model to re-read and decide again; an internal error asks it to check current state before deciding whether to retry, and not to assume the write's outcome. The underlying Resource still rejects corrupt state inside the transaction and rolls back on failure; the tool converts errors only after transaction cleanup and never retries or swallows writes. Outer tool argument errors still go through the existing recoverable tool error channel.

Approval reuses the existing `Permission.ask`: it waits outside the transaction and continues the same tool call once approved; it does not return needs_approval, end the Run, or build a separate next-turn resume protocol. Cancel, deny, and deny-with-feedback keep Permission's existing semantics. Analyst allows read/search by default and asks for mutations by default; the tools use resource_read/resource_search/resource_mutate as the action, and the Resource name as the permission match target.

The system prompt is generated from the registered Resource list at startup. The prompt only describes implemented capabilities and keeps no description of the V1 Resource Tree, paths, TCAC, or unimplemented tools. tRPC keeps its own custom queries/mutations; Agent tools do not expose them. Cross-Resource composition stays as internal transitions; this change adds no public composition entry point.

What the Agent cannot see, and where it went:

| Not in the handle                                            | Where it goes                                                                                                                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscriptions, events                                        | Each user message carries the Host's context snapshot                                                                                                                                   |
| "Current dashboard", selected cell                           | The snapshot carries dashboardId, chartId, and the focused cell's array index, so the agent can write patch paths without reading the chart first; the handle has no concept of current |
| world data                                                   | The dataset tool, through the Hose gateway                                                                                                                                              |
| Changing the frontend (switching to candlestick, navigation) | Not implemented in the first version                                                                                                                                                    |
| The agent's own session and run                              | Not Resources; they live in `server/agent/`                                                                                                                                             |

## Decision: remove the agent facade

**What the agent sees is the entity, in exactly the same shape as the app.** The two differ only in tools (`resource_read/mutate` vs. tRPC), not in data. `include_schema` returns the entity schema directly; there is no second shape to maintain.

V1's facade had only two fields, `expose` and `narrow`, and no transformation at all (the `toAgentFacade` hook existed, but none of the sixteen Resources defined it). What it hid falls into four categories, and OpenChart fixes each one at its owner:

| Hidden by the V1 facade                                                             | OpenChart                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envelope fields: `userId`, `displayName`, `revision`, timestamps                    | The framework declares the envelope once; `displayName` was a tree label and is gone; the agent actually needs to see `revision`                                                                                                   |
| ViewState leaked into the entity: watchlist `settings`, dashboard `layout`          | Display preferences such as watchlist density, decimals, and column widths stay in the frontend; Dashboard placement geometry, Chart preset/cells, and Watchlist columns are persisted user data that the Agent can read and write |
| Machine and derived fields: `firedCount`, `indexLinksByGroupId`                     | Purely to save tokens. If something truly must be hidden, use an `agentHidden` field annotation at the same level as serverManaged, not a file                                                                                     |
| `narrow`: agent can read but not write; used only once, for alert-rule `expiration` | This is a write policy; it belongs in an approval predicate, not in the shape                                                                                                                                                      |

If we later want to give the agent a different shape, first ask which of these it is: hiding fields, translating input, or addressing by id. Each has its owner (the `agentHidden` annotation, a transition with `resolve`, a custom transition), and there is no case that is none of the three. "Projected output" is not among them: the server does not join user data with world data; both the app and the agent read the entity and then query the dataset themselves, and there is no second way to read.

## Decision: patch is RFC 6902, applier uses fast-json-patch

The input of the default `patch` transition is an RFC 6902 JSON Patch: all six ops are accepted, paths are RFC 6901 pointers, and the app and the agent send the same thing. We do not invent our own patch syntax; the agent already knows this spec and needs no teaching.

Inside the intrinsic patch transition, this step has a fixed shape:

```
parse ops → project the complete domain read shape to a writable value → apply all ops → updateSchema parse → save
```

A single JSON Patch operation that fails returns the typed failure `PatchRejected {index, op, path, reason}`, whose operation fields are never null; a final writable value that does not satisfy the `updateSchema` Schema returns `ResourceStateInvalid {resource, reason, issues}`. Neither is persisted, and both map to tRPC `BAD_REQUEST`. Persisted state that fails the read Schema is still a defect and is not converted into a business error. `createSchema` and `updateSchema` recursively exclude every `serverManaged` field from the complete entity (including the envelope and fields inside nested objects, array elements, unions, and records); both are Schemas of a complete writable value. `updateSchema` is not a partial DTO; it is the validation shape after the patch is applied. A patch starts from the writable projection produced by `resource.project`, runs all ops in order, and can save only after `updateSchema` parses the final candidate value. Real server-managed data never enters the patch document; undeclared or `serverManaged` fields that appear in the final candidate value are rejected by `updateSchema`. Client restrictions are owned by the derived schemas and the intrinsic create/patch, which submit only writable values; the internal Store's insert/save also accepts the complete domain body, so transitions can write server-managed fields explicitly. `StoreBody<Entity>` derives both inputs from the same entity. The Store saves explicitly provided managed values and keeps or generates them when omitted; storage invariants still hold, and it returns the complete read shape. The Store owns identity mapping for array elements; the framework does not merge old values by index. We have no use for `test`, since `expected_revision` already does the same job, but keeping it is harmless.

When all fields are server-managed, the writable object's type is `Readonly<Record<PropertyKey, never>>`, consistent with the existing empty-object parse constraint. The rule also applies recursively to collections, and the Store and intrinsic transitions reuse the same derived type; an incomplete backend body cannot pass as an empty writable object.

Constraints and defaults on writable leaf fields are kept. Cross-field relationships are declared in one place on the entity with `withInvariants(schema, invariant => [...])`, and each rule is written as `invariant(description, (value, {expect}) => {...}, {code})`. For example, `expect(mainSeries, {path: ['cells', index, 'panes']}).toHaveLength(1)`. `Path<T>` infers valid field paths from the writable domain type, checking field names, nesting, and array index types; actual index ranges and the current union branch are the rule's responsibility. A recursive type is typed down to where it first nests inside itself. Rules that walk recursion call `at(path)` once per level; it returns a context whose paths are relative to that nested value and typed against it, while failures still point into the whole candidate. Rules can only synchronously read the projection with serverManaged fields recursively excluded, including when reading a complete entity; the framework carries the same rule set to body/createSchema/updateSchema, runs it only on the final value, and collects every assertion failure in the declaration. `lib/resource/invariant.ts` owns the declaration, assertions, path types, the `ResourceIssue` diagnostic schema and its type, and the adapter to Effect Schema errors; business rules stay in each Resource's entity.ts.

Rules already expressed by DB constraints or field schemas need not be repeated as invariants. `withInvariants` adds writable-field relationships within the same entity that are not yet expressed; the backend owner guarantees the correctness of serverManaged fields. External facts, cross-Resource relationships, and transition conditions that depend on old state stay with the owner of the corresponding operation, not in synchronous entity checks.

Only framework-registered writable invariants can be rebound along with the container projection. If a container with serverManaged descendants carries any full-object-level check or codec, automatic projection cannot guarantee its semantics, so definition still fails immediately.

Recursive entities use `Schema.suspend` and declare their recursive types as `type` aliases, because interfaces are not assignable to the JSON object types Resources require. Write derivation follows the schema graph rather than unfolding it: recursion without serverManaged fields keeps its original schema, and recursion with them maps each source cycle to one derived cycle, with any error reported at definition. Write types follow the suspended schema's declared type. Keep codecs such as decoding defaults out of the recursive cycle: Effect cannot render the encoded side of such a cycle as JSON Schema, and the catalog-wide Agent schema test rejects it. An exception thrown by a buggy rule implementation is still a defect.

`issues[]` contains a stable `code`, an RFC 6901 `path`, and a `message`; assertion errors also carry `actual`/`expected`; ordinary field parse errors use `schema.invalid`. Paths point into the candidate result of this submission. create is parsed once at the transport boundary by the same Effect Schema through a Standard Schema adapter, with input and output types taken from the create Schema's `Encoded` and `Type` respectively, so defaulted fields stay optional; patch produces the same error structure when the final update is parsed. tRPC returns `{resource, issues}` in `data.resourceStateInvalid`, and this field is null for other errors; error types are never inferred from the message string.

The Resource router does not convert or log errors on its own. Domain errors pass unchanged to the shared tRPC boundary,
where [`server/lib/errors`](../../server/lib/errors/index.ts) decides the public code,
status, and details in one place. Unknown defects keep their local cause and are logged once; clients only receive a generic error,
and no route exposes stacks or internal exception messages, even in development.

A patch computes one complete state transition in memory: each op follows JSON Patch execution rules, and the final candidate value follows the Resource Schema. Required fields, types, the field set, and business constraints are all guaranteed by the final `updateSchema` parse; an invalid final value returns `ResourceStateInvalid` and save is not called.

The applier is fast-json-patch, living in `lib/resource/patch.ts` at about a hundred lines: the op schema is a strict discriminated union, and value is constrained by `Schema.Json`; `defineResource` requires at the type level that the domain schema's decoded result be compatible with `Schema.JsonObject`, and the applier's document input and output use `Schema.Json`; pointers pass a regex; the three segments `__proto__`, `constructor`, and `prototype` are unrepresentable at the schema level, so prototype pollution is blocked at parse time without relying on the library's own guards; the input document is first `structuredClone`d, then each op is cloned and executed with `applyOperation` with validation on, so the input is never mutated even if it shares object references; the library's `JsonPatchError` maps to our error codes, and other exceptions are still defects. The failure position comes directly from the execution loop's index, not from the index the library reports or a reverse lookup by object reference.

We do not use Effect 4's built-in `JsonPatch`. It is a diff tool: `get(old, new)` paired with `apply` for replay, with only the `add`, `remove`, and `replace` ops. It is a strict subset of RFC 6902 with no `move`, and our array reordering relies on `move`; on failure it throws a bare Error that cannot say which op failed. The two things it does well, immutable apply with structural sharing and deterministic diff output, are of no use to us: we do not generate diffs, and SSE carries only invalidation, no deltas.

## Directory structure

Each Resource's domain code lives in its own directory; `lib/resource` provides the shared mechanisms, and `db` handles the database connection and migrations. Only the main files are listed below.

```text
server/
├── resources/
│   ├── catalog.ts                    # the single resources[], shared by tRPC, Agent tools, and the prompt
│   ├── router.ts                     # aggregates resourceRouter from the shared catalog
│   ├── macros/                       # cross-Resource read/write operations; still return ordinary Transitions
│   └── <resource>/                   # e.g. dashboard, chart, workspace
│       ├── resource.ts               # the only public entry point: assembles entity, store, and transitions
│       ├── schema.ts                 # persisted definition: tables, columns, constraints, relations, JSON structure
│       ├── entity.ts                 # derives the domain shape from the DB schema, adds constraints and annotations
│       ├── store.ts                  # reads and writes tables inside a transaction, assembles the complete entity
│       ├── errors.ts                 # optional: this Resource's own typed errors
│       └── transitions/              # optional: business actions that need the before state or resolve world data
│           └── <action>.ts
├── lib/
│   ├── resource/                     # Resource framework
│   │   ├── definition.ts             # defineResource; derives read/write schemas and intrinsic transitions
│   │   ├── transition.ts             # Transition.make/from; composes resolve/apply
│   │   ├── transactor.ts             # run: resolve → tx { apply }
│   │   ├── intrinsic-transitions.ts  # intrinsic create / patch / delete
│   │   ├── entity-operations.ts      # existence, revision conflicts, complete entity parsing
│   │   ├── envelope-columns.ts       # shared envelope columns, DB constraints, SQLite timestamp expressions
│   │   ├── patch.ts                  # RFC 6902 applier
│   │   ├── errors.ts                 # typed errors shared by the framework
│   │   └── events.ts                 # assembles committed database changes into Resource events and publishes them
│   └── trpc/
│       └── resource-router.ts        # derives the tRPC router from a Resource definition
├── db/
│   ├── database.ts                   # SQLite connection, transactions, post-commit callback; upgrades at startup
│   ├── migration.ts                  # runtime upgrade and ledger validation
│   ├── migration/                    # the app-wide forward-only migration stream
│   │   └── <timestamp>_<name>.ts
│   ├── drizzle.config.ts             # collects each Resource's schema.ts
│   ├── generate.ts                   # just migration <name>; --check checks for drift
│   ├── schema.json                   # generated: snapshot baseline for the next migration diff
│   ├── schema.gen.ts                 # generated: complete schema used for an empty database
│   └── migration.gen.ts              # generated: ordered migration registry and source checksums
└── index.ts                          # mounts resources: resourceRouter
```

**Within a Resource, definitions derive upward from storage.** `schema.ts` owns the types, nullability, defaults, and relationships of persisted fields; `entity.ts` derives the domain shape with Effect Schema, composes the envelope, and adds runtime constraints and annotations. `store.ts` maps between tables and the entity, including cross-table composition. Only `schema.ts` may reference another Resource's `schema.ts`, for FKs.

**`resource.ts` is the only public entry point.** It binds the entity and store through `defineResource`; read/write schemas, listKeys, intrinsic transitions, and the API all derive from that one definition. `resources/catalog.ts` imports only this entry point from each Resource and owns the single `resources[]` shared by tRPC, Agent tools, and the prompt. `resources/router.ts` aggregates routers from the shared catalog, with final paths `trpc.resources.<resource>.<action>`. The Agent tool adapters live in `server/agent/tool/tools/resource-{read,mutate,search}.ts` and derive from the same `resources[]`. The Resource framework does not depend on tRPC or the request Context.

**Business actions run as transitions.** Ordinary writes use the intrinsic create/patch/delete; a business transition is added only when it needs to read the before state or resolve world data. Cross-Resource actions live in `resources/macros/` and still return ordinary Transitions. Both reads and writes compose a Resource's public intrinsic or custom transitions and share the transaction; macros contain no SQL and do not access Stores or table definitions. SQL and storage mapping belong to each Resource's Store, and each transition parses complete entities through `entity-operations.ts`.

Simple local-app queries that need the complete result use the internal `resource.transitions.listAll({filter?})`, and the caller does `filter/find/some` in memory. `listAll` reuses ordinary `list`'s paginated reads and entity parsing within the same tx, following the internal position directly to collect every parsed entity without a token encode/decode round trip, and keeps `(createdAt, id)` order; each Store read is still bounded, but the final array has no total cap. This intrinsic operation generates no transport procedure, and the public list keeps its existing pagination contract. The Scheduler reads Schedules through listAll in one read transaction and filters enabled, due definitions; one-off jobs read Occurrences by scheduleId through listAll and skip after an exact fireAt match. Results are sorted by `(nextFireAt, id)` and dispatched one by one after the read transaction ends, without adding a dedicated query transition or macro. All Store operations require `Tx`; Transactor only owns the execution flow, and event publishing belongs to `events.ts`.

**Table definitions belong to the Resource; upgrades belong to `db`.** An empty database uses the complete schema, and an existing database runs only the forward migrations not yet applied; applied migrations must not change. The framework defines the shared envelope columns, and internal child tables share the root Resource's revision. For example, the dashboard store reads and writes `dashboard` and `dashboard_widget` in the same transaction, with order stored in `position` and x/y/w/h mapped to the API's layout; both share the Dashboard revision.
