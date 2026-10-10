# Code organization

OpenChart OpenChart separates the platform-independent application, the server,
platform entry points, reusable packages, and first-party vendored source.
Resource and transition ownership follows [resource.md](resource.md). Dashboard
composition and widget interfaces follow [widget-architecture.md](widget-architecture.md).

## Repository

```text
openchart/
  justfile
  package.json
  bun.lock
  app/
    src/
  common/
    agent/                    shared composer Part constraints and directive syntax
    feed/                     consumer schemas, provider provenance, FeedVersion, failures
    hose/                     world-data transport; Resource invalidation uses tRPC SSE
    identifier/               branded ID schemas and monotonic generation using Web Crypto
    timeseries/
    chart-core/               migrated V1 renderer, OpenChart provider/listing identity
    models/                   standalone Node model providers and their unchanged stream protocol
    utils/                    lowest-level shared helpers; no model or application dependencies
  server/
    index.ts                  composition root: resourceRouter, providers[], agent mount
    runtime.ts                one Effect Layer and ManagedRuntime for application services
    context.ts                application context shared by tRPC and Hose handlers
    contract.ts
    config/                   settings.json ownership, public reads/writes and native config source
    models/                   scoped model registry supplied to Agent LLM
    db/                       open SQLite, the one migration stream, checksum ledger; owns no Resource table
    events/                   typed process-local notifications + generic tRPC SSE adapter; no event log
    lib/resource/             defineResource, Transition.make/from, Transactor.run; no business nouns
    lib/trpc/                 shared context and router builder; reusable tRPC adapters
    resources/catalog.ts     resources[] shared by HTTP, Agent tools, and prompts
    resources/router.ts      aggregate resourceRouter
    resources/<name>/         user data: resource.ts, entity, errors, schema, store, optional transitions/
    data/                     observable Catalog and Provider contracts
    data/dataset/             declarations, derived codecs and ready Effect access
    data/providers/           source declarations, I/O, configuration and Feed adapters
    feed/                     whole-Feed service/layer/router assembly, versions and shared events
      bar/                    service, provisioner, Hose handler
      symbology/              service, provisioner, business RPC router
      calendar/               service contract, provider routing and router
      logo/                   service contract and Provider binding provisioning
      series/                 finite reads of declared timeseries, such as Workspace Datasets
    agent/                    durable run admission and process-local execution orchestration
      contracts/              pure Message/Part and prompt input contracts
      link-preview/           optional public-page title/description reads; no cache or browser
    scheduler/                scheduled dispatch and scoped background Layer
    collection/               runs Workspace Dataset collections: Agent prompts or uv scripts
    bus/                      backend-only process-local events between services; ids only, no transport
    alert/                    observes enabled alert rules through Tea, records alert events, publishes to bus
    trigger/                  subscribes to bus events, renders templates, invokes notification or agent targets
    notification/             host-supplied notify capability; no Resource and no state
    proactive/                offers before the user asks (prompt suggestions); not Agent-specific
    access/                   account and provider access services
      router.ts               aggregate accessRouter mounted under access
      auth/                   local account login and session
      billing/                subscription queries and hosted billing links
      integration/            external provider registration and credential resolution
      credential/             durable credential storage
  demo/
    agent/                    tracked Agent demo
    access/                   minimal Access demo
  platform/
    desktop/
  vendor/
    tea/
  docs/
    architecture/
```

Dataset declarations and source-specific Feed adapters live beside each Provider
under `server/data/providers/<name>/`. `server/data/dataset` owns the generic
framework; `providers/index.ts` registers services and bindings once.
Multi-Dataset Providers group native declarations and access under `datasets/`
and consumer adapters under `feed/`. Their directory-named service entry point
composes these groups; `client.ts`, `config.ts` and `errors.ts` own shared I/O.
The OpenChart client lives in `server/data/providers/openchart/client.ts`; Access owns
credentials and receives connection cleanup through runtime composition.
Browser consumers use `common/feed` through ordinary app hooks.

`common/chart-core` is the independent OpenChart copy of the V1 renderer. Its market
records use OpenChart ProviderListing; it no longer exports the V1 DataSource or
InstrumentView facade. `app/src/features/chart` binds it to `useBars` and owns
DataFrame-to-renderer projection, React lifecycle, theme, and resize. Automated
tests exercise the Feed bindings; the Calendar Feed supplies session tags for
extended-hours shading. There are no V1 workspace imports.

Commands are owned by the repository-root `justfile` and `package.json`.
The workspace owns dependencies and configuration. The complete check runs
schema drift validation, lint, formatting, workspace typechecks, and tests.
One ESLint flat config uses the recommended JavaScript/TypeScript presets,
typed Promise checks, framework checks, and dependency boundaries. Prettier
owns formatting, with its Tailwind plugin ordering classes.
`just format` checks formatting; `just fix` applies lint fixes and formatting.
Historical migration source is excluded from formatting because its exact bytes
are recorded in the database checksum ledger.
Core lint releases compiler caches between common packages and source groups
by using separate processes, preserving all typed rules within the CI heap limit.

Just runs the static, typecheck, and test lanes in parallel and requires all
three to succeed; `npm run check` runs them sequentially. TypeScript keeps
worktree-local incremental build info for repeat runs. Dependency installation
remains a separate step.

Every workspace's `tsconfig.json` extends `tsconfig.json` directly. The root
owns compiler strictness, language/module settings, React JSX, and the app
aliases needed by both the app and its hosts. Package configs only select local
files, environment libraries/ambient types, and package-private aliases. They
do not repeat or weaken shared checks. Models needs ES2023 library declarations
for its array APIs; this does not require a different compilation target.
Vite's build and test path resolvers read the root config directly, keeping
alias resolution consistent with TypeScript.

`platform/desktop` is the only application host. It owns Electron startup,
preload, packaging, native operations and the server process. The app requires
these operations through `AppHost`, keeping Electron imports in Desktop. App
injects them once through `AppHostProvider`; consumers read `useAppHost()`.

The [desktop package](desktop.md) hosts the full application server in an
Electron utility process: one SQLite runtime per application, a per-run token
guarding the loopback API, and a safeStorage-protected credential key handed to
the backend. The shared app requires a host-supplied Clerk provider and opens the workspace
signed in or out; Desktop owns the native Clerk bridge.
[Access](access.md) owns account state and durable credentials; OpenChartClient obtains keys through Integration. `server/runtime.ts`
composes one OpenChart Provider client and injects its reset callback into Auth.
Auth owns account credential writes and the subsequent cleanup, within its serialized,
uninterruptible operation. Both HTTP and backend callers use Auth; routers only
parse input and invoke services. Generic Integration routes reject first-party
credential writes. `connection.disconnect(integrationID)` clears that integration's
current credentials directly, without looking up credential IDs or reading secrets.
OpenChartClient does not subscribe to credential events. OpenChart connection settings
default to the production endpoint; missing credentials keep the Provider
unavailable, and invalid supplied connection settings fail startup.

```text
platform/desktop ─────> app

app ──────────────────> common
server ───────────────> common
platform/* ───────────> common
server ───────────────> vendor/tea
app - - - - - - - - -> server          (AppRouter types only)
```

The AppRouter edge goes through `@openchart/server/contract`, a `types`-only
export that runtime code cannot load, and is erased from browser JavaScript. It
exists only in `app/src/lib/transport/transport.ts`; app widgets and other runtime
modules cannot import server. If the client is later published independently,
this edge must be replaced by a generated wire contract.

The navbar and chat live in the shared app. `app/src/lib/transport/transport.ts`
owns the single tRPC/SSE connection, reused by Agent, Resource invalidation and
Feed transport. `lib/agent/use-agent.ts` is the app's Agent entry point:
mount it once per transport and share its `Agent` through `AgentProvider`.
It owns Agent clients, directory invalidation, and observation cleanup; callers use
`agent.sessions`, `agent.modelProviders`, `agent.createSession`, `agent.forkSession`,
`agent.submitPrompt`, and `agent.getSession(id)`. Query owns all command mutation status;
submission requires an existing Session ID and retains its model and draft.
`lib/agent/session-progress.ts` derives active Run progress from
the shared Session snapshot. Consumers own display limits and clock
conversion; progress adds no Session state or execution lifecycle.
Query owns the complete Session directory and model list.
`app/src/lib/agent` owns Agent requests, event parsing, queries, Session actions,
model resolution and observation. Its SessionStore retains native AG-UI
message/state reduction. `useBoundSession` reads a binding and observes its existing
Session without creating or submitting one. Features consume Layout's shared
Agent directly; widgets need no Agent-specific wrapper or prop forwarding.
`app/src/features/agent` owns chat presentation and assistant-ui adapters.
Composer and Transcript share an assistant-ui runtime;
AgentLayout arranges them, and AgentView composes the surface. `app/agent/`
keys AgentView by Session ID: model choice stays local to that conversation and
restores from its latest User.model; only empty conversations use the global default.
Unsent choices are not persisted, and Session has no separate model preference.
`app/agent/` reads the Session ID from URL and navigates locally after creation or
forking, selecting new Sessions before submitting. Layout owns sidebar navigation,
rename-dialog visibility, shortcuts and connection lifetime. AppRouteContext shares
transport; native operations come from AppHostProvider. Sidebar components receive
navigation callbacks through props.
Submission retries use the URL-selected
Session; AgentView derives status and failed input from Agent's matching mutation.
Agent presentation lives in `app/src/features/agent/components`; shared
controls live in `app/src/components/ui`. Optional live client verification lives in `app/e2e/tests/agent-live.ts`.

Assistant Markdown renders `:resource[Name]{name=alert_rule/alr_...}` with
the existing DirectiveChip. This presentation is limited to Assistant replies;
user messages and the composer retain their existing directive rendering.
The standard directive parser owns syntax; invalid,
incomplete and unsupported directives remain literal. Labels are reply snapshots,
and rendering never fetches a Resource. Code and escaped directives stay literal.
`app/resource-navigation.tsx` derives canonical destinations from the complete
static route tree's `handle.resource: {name, idParam}` annotations, including
unvisited lazy pages. The router only declares routes; the peripheral resolver
owns lookup and URL generation. `lib/resource/navigation.ts` exposes the injected
destination function to presentation. References without a detail route stay
noninteractive. Normal Links preserve navigation, keyboard behavior and the
shell's unsaved-draft guard. Feed references share the same destinations; their
existing reads still own labels and Chart-to-Dashboard resolution.

Local application development uses `just desktop`, with renderer HMR inside
Electron. Interactive debugging and verification use Computer Use in the Desktop
window. There is no standalone browser entry or Vite backend proxy. Desktop
supplies the Clerk provider; sign-in uses Clerk's modal.

`server/index.ts` owns HTTP/Hose composition and the root router. It mounts
`resources`, `feed`, `access`, `events`, `agent`, `config`, `models`, and `workspace`.
`models.list` exposes model choices; `agent` consumes the model service for execution.
`access/router.ts` aggregates
child routers, currently exposing `access.integration`. Resource routes derive
from the shared `resources/catalog.ts`; macros compose Resource transitions.
`resources/macro-router.ts` exposes `resources.macro.createChartWidget`, which creates a Chart
and its placement atomically through `resources/macros/create-chart-widget.ts`.
The same router exposes `resources.macro.createDashboardWithChart`, which
creates a Dashboard with its initial Binance BTCUSDT Chart and placement, and
`resources.macro.addIndicator`/`removeIndicator`, which pair an Indicator with
its Chart bindings the same way.
`await createServer(options)` initializes the runtime and background services,
then returns an unbound server. Missing Dataset providers do not block startup.
HTTP-only hosts use `createRequestHandler(runtime)` and initialize/dispose their
own runtime. The common Hose adapter owns socket wiring and shutdown.

tRPC is the typed HTTP boundary, not the application runtime. A procedure
parses wire input and performs one `ManagedRuntime.runPromise` call; the
program behind that call is an Effect whose dependencies come from the single
application Layer in `server/runtime.ts`. One server instance owns
one runtime, so Layer services are built once, shared across requests, and
disposed by the application's `shutdown()`. Shutdown releases Hose channels
before closing HTTP and awaiting runtime disposal. Effect values never enter
the tRPC contract. Top-level tRPC and Hose route definitions share the Context
contract in `server/context.ts`; each host injects its own runtime.
Each service owns its background Layer, such as `scheduler/background.ts`.
`runtime.ts` composes those Layers and awaits their cleanup during shutdown.

Server-owned contracts use Effect Schema, as do `server/data/dataset`, `common/feed`
and `common/market` (ESLint-enforced). Other common packages may still own Zod
schemas; backend and frontend consume shared contracts directly without
duplicating types or generating another schema representation. ESLint forbids
direct Zod imports in server production code, except the two immutable historical migration
parsers whose recorded source checksums must remain unchanged. Tests can exercise
both parser types through the common transport boundary.

`server/events/` supplies typed live publication and one scoped, bounded
subscription API (`allBounded`) inside that runtime. Observers filter by event
type when needed. Its tRPC adapter exposes `/trpc/events.subscribe`: a `ready`
frame after observer registration, followed by `event` frames with generic
envelopes. It does not import or define a business event. Agent and Resource
consumers share this connection. Agent's `requestSnapshot` mutation publishes a
request-correlated native snapshot under the existing publication barrier;
the requesting observer consumes subsequent session deltas on this same stream.
The Resource framework owns its invalidation payload
`{resource, id, revision}`. Database detects committed root changes, and
`lib/resource/events.ts` maps and publishes them after commit. Resource folders,
transitions, the Transactor, and transport handlers do not declare or publish
Resource events. Resource database rows remain canonical, and
subscribers refetch them. Resource notifications are live-only invalidations;
they carry no Resource snapshots or deltas, and reconnect triggers a full query invalidation. Hose
carries world data and does not carry Resource invalidation.

## One mental model

Resource, dataset, and widget folders identify their owners, with one
composition root per process. A Chart grid is one widget kind within a Dashboard.

| Noun     | What it is                                | Declared in                     | Implemented in           | Consumed through                                        |
| -------- | ----------------------------------------- | ------------------------------- | ------------------------ | ------------------------------------------------------- |
| resource | user data and its pure state transitions  | `server/resources/<name>/`      | same folder              | tRPC resource client and derived agent tools            |
| dataset  | world data (market, news, reference)      | `server/data/providers/<name>/` | `server/data/providers/` | Feed hooks in the app, Dataset access on the server     |
| widget   | a mounted `dashboard.widgets[]` placement | `app/src/features/<kind>/`      | same folder              | `app/src/features/dashboard/components/widget-host.tsx` |

Reading rules:

1. `server/resources/` owns user data, `server/data/providers/` owns world
   observations, and `app/src/features/` owns frontend feature behavior.
2. Every Resource has `resource.ts`, `entity.ts`, and `schema.ts`. `errors.ts`
   exists only when the Resource owns typed failures beyond the framework's
   not-found, revision-conflict, and patch-rejected. The store is the
   persistence seam: each Resource's `store.ts` maps its DB tables to the
   framework's typed write and unparsed read contract, including entities
   spanning multiple tables.
   Explicit actions go in `transitions/<action>.ts` only when intrinsic CRUD is
   insufficient. There is no separate Domain owner, Resource event
   definition, or read-projection folder.
3. `server/index.ts` assembles Resource definitions through each folder's
   `resource.ts`; `app/src/app/widgets/widget-registry.ts` assembles widget definitions.
   Resources do not import sibling implementations. Only `schema.ts` may
   import another Resource's `schema.ts`, solely to declare an FK. Cross-Resource
   operations belong in `resources/macros/`. Both reads and writes compose
   intrinsic or custom transitions; macros never access SQL, stores, or table schemas.
4. Widget components consume their own Query and Feed hooks. `WidgetContext`
   supplies placement identity, the shared transport, and card interaction; it
   is not a Resource/data facade. Features do not import one another. Resources
   depend on the framework and database; providers depend on Dataset declarations.
   Agent tools use the same Resource definitions and Dataset services.
5. To find where X changes, open its owner: chart DB fields are in
   `resources/chart/schema.ts`, their runtime shape in `entity.ts`, optional chart actions in
   `resources/chart/transitions/`, widget rendering in `app/src/features/chart/`,
   and bars access in `server/feed/bar/`.

## Server

```text
server/
  index.ts
  runtime.ts                ApplicationLive Layer + server-lifetime ManagedRuntime
  contract.ts
  db/
    database.ts             open SQLite, run pending migrations at startup
    migration.ts            sole runtime runner; fresh schema or unapplied forward suffix, with ledger validation
    drizzle.config.ts       collect Resource tables from resources/**/schema.ts
    generate.ts             just migration <name>; --check detects schema and generated-artifact drift
    migration/              one ordered stream for every Resource: <timestamp>_<name>.ts = {id, up(tx)}
    migration.gen.ts        generated ordered registry with filenames and source checksums
    schema.gen.ts           generated full schema; a fresh database runs this and marks every migration done
    schema.json             generated snapshot the next migration is diffed against
  events/
    event.ts                typed definition, identifier, and payload schema
    events.ts               process-local publish, subscribe, all, bounded all
    router.ts               generic Effect Stream to tRPC SSE adapter
  lib/
    resource/               defineResource, transitions, envelope, intrinsic CRUD
      transactor.ts         run only: resolve -> db.transaction(tx => apply(tx, resolved))
      transition.ts         input-bound resolve/apply contract; make and from constructors
      intrinsic-transitions.ts shared CRUD and writable patching
      entity-operations.ts    shared existence/revision checks and complete stored-entity decoding
      patch.ts              RFC 6902 applier using fast-json-patch
      envelope-columns.ts   shared envelope columns and checks; Resource schemas declare their own tables
      store.ts              Row and Store<StoreBody<Entity>> contracts; no physical table layout
    trpc/
      trpc.ts               shared Context and tRPC router builder
      resource-router.ts    derives get, list, create, patch, delete tRPC procedures per Resource
  resources/
    catalog.ts              shared resources[] registry
    router.ts               aggregate resourceRouter mounted under resources
    macro-router.ts         cross-Resource APIs mounted under resources.macro
    macros/
      AGENTS.md             cross-Resource Transition ownership rules
    dashboard/
      resource.ts           sole public entry; defineResource({name, entity, store})
      entity.ts             domain-field Effect Schema derived from DB columns; runtime refinements and annotations
      errors.ts             optional Resource-owned typed failures through Effect's error channel
      schema.ts             explicit dashboard and dashboard_widget tables, constraints, and relationships
      store.ts              maps metadata and ordered widget rows inside the Transactor's transaction
      transitions/          optional <action>.ts; none needed in the first version
    chart/
    drawing/
    workspace/
    agent-schedule/
      schema.ts             Schedule table, prompt target, and recurrence; runtime adapters pending
    agent-schedule-occurrence/
      schema.ts             Occurrence table with Schedule and Run FKs; runtime adapters pending
  provider/
    quotes.ts
    news-articles.ts
  agent/
```

`@openchart/identifier` in `common/identifier` owns `defineId`, `IdSchema`, and
monotonic suffix generation using Web Crypto. Each domain declares its own
prefix and brand; Resource and Session operations call that schema's `.create()`.
Schema declaration generates no identifier, and callers retain creation timing.

A Resource owns essential user state, starting from its DB schema. The
`envelope-columns.ts` helpers declare `id`, `revision`, `createdAt`,
`updatedAt`, and their checks once. Resource transitions assign identifiers and
revisions; SQLite generates timestamp values. Insert uses SQL defaults, and
the envelope's Drizzle update callback injects a SQL clock expression for
`updatedAt`. Store write inputs carry no timestamps. `entity.ts` derives the
domain fields from DB columns and combines them with `envelopeFields(Id)`
to export the complete runtime entity. `defineResource({entity, ...})` preserves
that schema as `resource.entity`, extracts its ID constructor, and derives
the full domain read shape by omitting the envelope. `write-schema.ts` derives
`createSchema` and `updateSchema` by recursively excluding `serverManaged` fields, including
the envelope. Intrinsic create/patch supply writable fields; internal transitions
can supply the complete domain body through the same Store insert/save methods.
`StoreBody` derives both forms from the entity. Stores persist explicit managed
values, preserve or generate omitted managed data, and return the complete read
shape. Storage invariants still apply. Child identity mapping stays with each
Store; the framework never merges array members by index. Dashboard's store maps its metadata and widget tables
to that entity. A forward migration converts historical JSON-value rows while
preserving their envelope and widget order.

`defineResource` binds shared operations as `resource.transitions`:
`get/list/create/patch/remove`. Input schemas remain `resource.createSchema/updateSchema/listSchema`.
The operation factories accept parsed input and construct transitions without
IO or identifier generation. `Transition.from(tx => effect)` supplies an empty
resolver for these intrinsic operations. Stores keep their load/list/insert/save/remove
SQL interface; intrinsic transitions own existence checks, identifiers, revisions,
writable projection, JSON Patch, and stored-entity decoding.

`Transactor.run` only executes `resolve -> db.transaction(tx => apply(tx, resolved))`.
Resolve finishes before the transaction and supplies typed facts to apply.
Resolve failure opens no transaction; apply failures, defects, and interruption
roll back the writes. Database detects actual changes and calls its injected
callback after commit; the Resource event adapter owns publication.

Intrinsic create and patch decode the complete stored entity inside the write
transaction, before commit. A decoding defect rolls back parent and child writes,
including revision and timestamps, and publishes no event. After commit, they
return the already-parsed entity without decoding it again.

A transition is an input-bound `{resolve, apply}` program. `Transition.make`
preserves the resolver-output/apply-input type relationship. `apply(tx, resolved)`
requires no additional Effect services, while the resolver retains its service
and failure types. This is not a sandbox against direct IO or captured capabilities.
External facts belong in resolve; consistent Resource state is read through the
supplied transaction inside apply.

Composing transitions produces another transition, including cross-Resource
operations. The composition orchestrates child resolve and apply phases; callers
run the resulting transition once. Apply never calls `Transactor.run` or opens
another transaction. Resolver dependencies must finish before apply; a resolver
that needs an earlier apply result requires a different phase boundary.
Macros live in `resources/macros/` and use this same execution contract.
Simple local-app queries use ordinary Resource lists and filter in their caller.
Scheduler reads Schedule pages and lists Occurrences by scheduleId in one read
transaction, filters exact fire eligibility, and sorts the result in memory.
It follows each original nextCursor and closes the read transaction before
admission; this needs no dedicated query transition or macro.
A Resource registers custom
declarations through `defineResource({transitions: {promote}, ...})`; keys own
operation names. `Transition.make({input, resolve, apply})` links the declaration's
schema and phases, and `Transition.bind` derives input-bound factories. Those factories
and transport adapters reuse `Transition.bindInput` to bind one declaration lazily. The generic
adapter derives custom tRPC queries for `kind: "query"` and mutations otherwise, preserving input,
result, and runtime-service types. Custom declaration names cannot shadow intrinsic names; a domain may compose its public intrinsic transition with `Transition.make` while retaining the typed Resource contract.
Custom declarations use the static `transitions: {name: declaration}` map and
may call their own Resource's Store directly, reusing shared entity checks and
assigning identifiers and revisions for their writes. They need no Resource
back-reference. Cross-Resource macros compose public transitions; SQL remains in
each Resource's Store.
Workspace registration reuses the same Resource schemas and CRUD transport. Its
register transition resolves the canonical existing directory before the database
transaction; the Store rejects overlapping roots and changes to a registered root.
Its forget transition protects the default workspace and forgets only the row.
createLocal and the internal ensureDefault transition prepare directories in
resolve and reuse register in apply; startup executes ensureDefault before requests.
The getDefault query reads the default ID from registry pages without filesystem work.
The file service in `server/workspace` owns Chokidar, scoped Effect instances,
fresh reads, hash comparisons and metadata snapshots. See [workspace](workspace.md).

`patch` uses all six RFC 6902 operations and RFC 6901 pointers through
`lib/resource/patch.ts` and `fast-json-patch`. Both app and agent must supply
`expected_revision`. The framework parses operations, checks protected fields,
applies to a clone, parses the complete resulting entity, and saves only on
success. Operation failures are typed `PatchRejected` values with a required
operation index, op, and path. An invalid final writable value raises
`ResourceStateInvalid {resource, reason}`; invalid persisted state remains a
defect. Nested collections are
arrays, element IDs are assigned by the server on append, and reordering uses
`move`; revision checks protect index-based writes.

`server/resources/catalog.ts` registers `resources[]` through each Resource's
`resource.ts`; `server/index.ts` mounts the aggregate `resourceRouter`.
`resources/router.ts` also mounts `macroRouter` at `resources.macro`.
Alert authoring and event Session queries are registered as `kind: "query"`
transitions on their Resources, so the same adapter derives their APIs.
Saving Alert rules continues to use the existing macro and validation policy.
`server/lib/trpc/resource-router.ts` derives tRPC resource routers from that
array using `lib/resource` and the shared `server/lib/trpc/trpc.ts`. Resource
core files never import tRPC or request `Context`, and their public entry point never
exports transport adapters. `server/agent/tool/tools/resource-{read,mutate,search}.ts` derives the generic agent tools
`resource_read`, `resource_mutate`, and `resource_search` from the same array;
Generic Agent mutations expose only create/patch/delete and reject read-only Resources. Dedicated tools may call Resource transitions; `save_alert_rule` uses Alert Rule `save`. tRPC retains declared custom queries and mutations. Read filters come
from the same declared `listKeys` and store methods. Agent and app receive the
same entity shape, with no separate agent facade. The server does not compose
user data with world data into read projections: clients read entities and
query datasets separately. `resources.macro.createChartWidget({dashboardId, expectedRevision,
widgets, layout, chart?})` is an application RPC over an ordinary macro, not an extension
to generic Resource CRUD. Its Chart creation and all placement geometry changes share one
Transactor transaction and return `{dashboard, chart}`. Omitting `chart` creates
the fixed Binance BTCUSDT daily starter without Feed access.

The current backend exposes six Resources:

| Resource                    | Owned domain state                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `dashboard`                 | `name`, `favorite`, `widgets[{id, kind, resourceId?, layout: {x,y,w,h}}]`                                                   |
| `chart`                     | `dashboardId`, `preset`, `links[]`, `cells[{id, resolution, session, adjustment, marketSources[], indicators[], panes[]}]`  |
| `drawing`                   | `dashboardId`, `provider`, `listing`, `data` (core geometry, style, visibility)                                             |
| `workspace`                 | immutable canonical `root`; artifact bytes stay on disk                                                                     |
| `agent_schedule`            | `name`, `prompt`, `cron`, `enabled`                                                                                         |
| `agent_schedule_occurrence` | `scheduleId`, `agentRunId`, `fireAt`; scheduler-owned acceptance provenance, with envelope `createdAt` recording acceptance |

Resources are addressed by `(resource, id)`, without a Resource Tree or path
resolver. Chart and drawing each belong to a dashboard through a
`dashboardId` FK with cascade. References such as `widgets[].resourceId` and
`indicator.scriptId` are values without FK ownership or cascade; consumers
handle a missing target. Chart, cells, panes, and indicators share the chart's
revision, while dashboard and drawing writes have their own revisions. Writes
that must serialize belong in one Resource; independent, infrequent writes
may still share one to avoid extra ownership and consistency machinery.

`dashboard.widgets[]` now includes `kind: "chart"` placements whose `resourceId`
references a Chart. Dashboard owns their required integer geometry in a
12-column grid and their reading order; its entity rejects duplicate IDs and
overlapping rectangles. Chart separately owns its inner `preset`, cells, links,
and revision. Moving a widget patches Dashboard; changing its internal split
patches Chart. Removing a placement does not delete the Chart. Existing Charts
and placements are backfilled by a forward migration, never on page mount.

Resource tables belong to Resources; migrations do not. Each Resource's `schema.ts`
declares its tables and the Drizzle config globs them into one schema. A
migration is one ordered change to the whole database: `just migration <name>`
diffs the schema union against `db/schema.json`, writes one
`db/migration/<timestamp>_<name>.ts`, and regenerates `migration.gen.ts` and
`schema.gen.ts`. A change that spans Resources is therefore one file, and two
branches that both add a migration conflict on the snapshot and the registry,
so ordering is resolved at merge. `just check` fails when the schema has an
ungenerated migration or either generated file is stale. Hand-written data
steps (backfills, JSON shape changes) go in the same migration file after the
DDL. The ledger records each migration id with its checksum, as in V1.

Agent run lifecycle remains runtime state. Schedule and Occurrence are separate
Resources; Occurrence records acceptance provenance and references Run.
`server/agent/schema.ts` owns the seven runtime SQL tables.
`server/resources/agent-schedule/schema.ts` owns Schedule, its prompt target, and
recurrence schemas. `server/resources/agent-schedule-occurrence/schema.ts` owns
Occurrence with required FKs to Schedule and Run and an independent envelope.
Binding slots use one globally unique
key in this single-user app, with no user or surface dimension. Features construct
stable keys; Agent storage and Schedule targets treat them as opaque strings.
`server/agent/contracts/message.ts` owns message roles, serialized errors, LLM requests,
and the message-with-parts aggregate. It depends on `server/agent/contracts/part.ts`,
the sole Part aggregation entry point and union owner. Each variant and its
nested content live in a separate `parts/*-part.ts` file. `parts/part-base.ts` owns shared
identity fields and Origin. JSON payloads use native Effect `Schema.Json` and
`Schema.JsonObject` with readonly recursive types.
`server/agent/contracts/session.ts` owns the complete Session value with flat OpenChart field
names and explicit nulls. Parent sessions own anchors; transcripts stay linked
by session ID, and the coordinator owns execution state. The top-level contracts are Session, Message, Part, session anchor, and Agent
prompt input; concrete Parts stay in the internal `parts/` directory. Outside consumers use
`@openchart/server/agent/contracts/part`; ESLint rejects imports of individual Part modules.
Part modules import schema primitives and directly needed Part modules, never
the aggregator, messages, or prompt input; ESLint enforces this boundary.
`server/agent/contracts/agent-prompt-input.ts` derives canonical input variants directly
from those Parts. Agent execution and Resources import
these contracts through `@openchart/server/agent/contracts/*`. The contracts import only Effect schema primitives,
shared identifiers, and sibling contracts; OpenChart ESLint enforces that boundary and rejects Resource
imports of Agent execution modules, allowing the SQL schema solely for FKs.
`server/agent/session/message/data.ts` derives SQL payload projections from the shared
schemas; message storage and execution stay server-owned. The app infers procedure
types from `AppRouter` through `@openchart/server/contract`. That type-only surface
also re-exports `AgentSessionState`, owned by `server/agent/publisher/agui/state.ts` and
derived from its snapshot projection, for SSE consumers. Native transcript types
belong to AG-UI. The shared Agent contracts serve backend consumers directly;
the app still derives its procedure types without importing server runtime schemas.

The coordinator serializes execution per session while
different sessions remain concurrent. The current runner claims an `agent_run`
row and calls `Prompt.Service.execute`. `server/agent/prompt/` owns this injectable
boundary and the inner engine; Runner retains claim and terminal Run writes.
Prompt owns input materialization and model-loop decisions, composing the
existing model, message, tool, permission, and Processor owners. See the
[agent orchestration architecture](agent.md).

## Source documentation

The [OpenChart documentation rules](../../AGENTS.md#documentation) are authoritative.
Every public callable has self-contained TSDoc and a small example. Package
entry points use `@packageDocumentation` so generated documentation begins with
a readable package introduction.

## Application

```text
app/src/
  app/
    router.tsx                route registration
    layout.tsx                persistent shell, FeedProvider and Agent/Copilot composition
    connection/               shared transport/reconnect/subscription lifecycle
    agent/                    FullPageAgent and Copilot placement
    dashboard/
      dashboard-page.tsx      route ID/transport, chart selection, registry and header wiring
      dashboard-header.tsx    PageHeader + Chart symbol + add-chart composition
      add-chart-button.tsx    Chart picker/body builder -> Dashboard creation control
      widget-registry.ts      cross-feature definitions assembled only here
      use-dashboard-actions.ts sidebar/shortcut creation, dialog navigation
  features/
    dashboard/
      dashboard-action-dialog.tsx rename/delete forms
      components/dashboard-view.tsx queries, layout save/retry/discard and status UI
      components/create-chart-widget-button.tsx placement creation lifecycle
      components/             grid, widget host/card, add-chart and settings forms
      api/queries.ts          directory reads and mutations
      utils/layout.ts         geometry using RGL's algorithms
    chart/
      components/widget.tsx   placement adapter and controls/content definition
      components/selection-provider.tsx mount-private chart/cell selection
      components/             ChartGrid, ChartCell, legends, menus and symbol picker
      api/queries.ts          Chart Resource queries and mutations
    agent/                    Chat views, editor APIs and assistant-ui adapters
  lib/
    agent/                    shared Agent client, Query, SessionStore, Provider and hooks
    widget.tsx                shared widget identity/context and definition contracts
    resource/dashboard.ts     shared identity query options for widget adapters
    chart/                    renderer integration, runtime and display preferences
    feed/                     Feed consumer and transport
  hooks/                      reusable hooks with no feature/app imports
```

Dashboard renders every placement through the app registry and `WidgetHost`.
The host owns the common card, error boundary and toolbar visibility. Its React
Context supplies `{placementId, dashboardId, transport, holdControls}`. Feature
components read their own Query data and own renderer/Feed effects through
hooks; the host does not execute all feature effects or distribute snapshots.
`WidgetDefinition` declares Content, optional Controls/Provider, icon and sizes.
Adding a frontend kind requires registry composition, not a backend enum change.

Transient component state uses React state; persistent view preferences use
feature-owned Zustand stores. This migration preserves Chart's existing cell
preference and grid-proportion keys. No generic ViewState store/facade is added.
Server data stays in React Query. Shared Query keys deduplicate reads, and
Resource invalidation refreshes consumers after writes. World observations use
Feed hooks independently. Widget composition does not turn disk data into a new Resource type.

React Grid Layout owns outer dragging/resizing and its temporary interaction
state. Stop commits the layout once against the starting Dashboard revision;
there is no optimistic Query cache. Conflicts and failures expose retry/discard
instead of overwriting a newer revision. Narrow screens render a single column
without persisting a second layout. Inner ChartGrid still uses its existing CSS
Grid; changing that preset patches Chart, not Dashboard.

The app-composed symbol control shares only target Chart/cell IDs with widgets and
reads/writes Chart through Query. `ChartGridProvider` stays inside the Card for
controls and cells that need runtime handles. Drawing tools remain floating and
always available; Auto/Log and vertical-axis settings stay on each axis. Interval,
session, timezone and internal grid layout belong to the widget's floating
controls. Cross-widget ticker linking beyond this page selection is not introduced.

## Vendored Tea

Tea is OpenChart's purpose-built programming language for quantitative analysis
and trading. `vendor/tea` is a Git submodule of the independent
public `longsurf-ai/tea` repository. OpenChart records an exact Tea commit in its
Git tree; updating Tea's remote branch does not change that pin.
OpenChart-specific market-data, chart-output, and alert integration belongs in
`server`, not in the language implementation.

From the repository root, initialize or restore the recorded version with:

```sh
git submodule update --init -- vendor/tea
```

The Tea repository is public, so checkouts and CI need no credentials for it.
Initialize the pinned submodule with the command above.

Tea is not a OpenChart workspace package. It retains its own dependencies, lockfile,
build, and checks; OpenChart's test and formatting commands exclude `vendor/`.
This first step brings in source only: server package imports and runtime
integration are not wired yet.

To develop Tea in place, create a branch in the submodule before editing:

```sh
git -C vendor/tea switch -c my-tea-change
```

Follow Tea's own `AGENTS.md` and development commands. Commit and push language
changes to `tea` first, then stage `vendor/tea` in OpenChart and commit the
new pin with any corresponding product changes. A separate sibling `tea`
checkout does not automatically share its working changes with this checkout.
Running `submodule update` restores the OpenChart pin, so do not use it to
refresh an in-progress Tea branch.

## Model providers

`common/models` is the standalone, Node-only `@openchart/models` package
transplanted from V1. It owns the AI SDK adapters, model metadata, transforms,
MCP outcome restoration, and provider-neutral delegate stream protocol. The
migration preserves `protocol.md` byte-for-byte. It imports neither V1 code nor
Effect; see the [model-layer boundary](models.md).

`server/models` directly composes the native bindings and supplies model discovery
and SDK access to Agent LLM. It owns selection, caching, refresh, and scoped cleanup;
common/models has no registry facade. Runtime supplies catalog/cache options,
Profile registry and Integration startup registrations.
Credential stores Integration secrets; public Dataset Providers continue to own
their enabled settings through native ConfigProvider. Connecting their credential
resolution to Integration is separate from this composition.

## Configuration and storage

`server/config/provider.ts` owns the settings.json file, atomic merge-patch writes,
polling and native ConfigProvider updates. Domain schemas own defaults and
validation; `config/router.ts` statically composes public Appearance, Models and
Data Provider settings. The old empty Config fixture and desktop KeyValueStore
have been removed. Credentials remain with Integration/Credential.

`runtime.ts` installs file configuration before its consumers. Explicit native
providers remain available to tests and embedding, with file mutations disabled.
Models replaces its ScopedRef registry on configuration changes and disposes the
old instance; Data Providers retain their Dataset retirement rules. App uses one
Query config mirror and an independent invalidation observer on the shared SSE.
See the [configuration contract](configuration.md).

### Bars window bindings

`app/src/lib/feed` remains the reusable frontend Feed library: transport owns
wire decoding and tRPC/Hose calls, bars owns ordered session delivery, and
contracts owns Schema-derived local view/result shapes. `app/src/hooks/use-bars.ts`
binds request/status Observables with observable-hooks; RxJS switchMap owns
replacement cancellation, while loadingBehavior owns only placeholder display. These modules are exported
through the app package and do not depend on widget, renderer, routing or styling
code. No separate common client/hooks package is introduced. Only wire data
contracts belong in common/feed; runtime capabilities stay local.

AppLayout owns one FeedProvider per backend connection, above all application
routes. Its connection scope also owns one TeaClient, injected through
TeaClientContext. Only the Tea hooks in `hooks/use-tea.ts` borrow that client. Connection teardown
awaits Tea shutdown, including pending compilations and server-node disposal,
before disconnecting the old transport. Navigating releases each consumer's channels, not the shared client/Hose.
Initial version reads do not gate the application shell; finite Feed queries
wait for a known version. Replacing the backend connection or unmounting the
application disposes the client.
