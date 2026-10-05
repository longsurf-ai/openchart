# Unified Data Access Layer

## Background

When it comes to trading and market, data are very heterogeneous in many ways:

- sources: data can come from exchanges, regulatory bodies, companies, web, ect
- volume: some data are extremely dense and large (e.g., quotes), some are extremely sparse (e.g., earning transcripts)
- modality: a lot are numerical, but some are textual
- latency: some data require extremely low latency gurantees (e.g., trades), some only comes every quarter (e.g., earnings)
- regularity: some data are going to be generated regularly (e.g., ohlcv), some data gets generated adhoc-ly (e.g., 8-k, symbology, corp acts)
- cardinality: some data are low cardinality (e.g., exchange calendar), some are high cardinality (e.g., option pricing with company x listing x strike x expiration), and for some cardinalities are not even properly defined (e.g., all of the web and news data)

As a result, it would be imprudent to define a "unified data layer" that claims to work for all kinds of data, because:

- Data with different volume, modality, latency, cardinality requires different storage solutions, and thus require different query languages
- Data with different latency, cardinality, volume require different accessing patterns (e.g., push vs. pull)

What we can do, however, is to define **a set of unified data access operations** for different kinds of data, so that we have a limited number of ways to access different data.

Broadly speaking, we categorize data based on the best ways to access them into 3 categories that are fundamentally different:

- **Streaming access**: data update at producer should be pushed to consumer
- **Selection access**: consumer pulls a chunk of data, knowing certain structural properties of the data.
- **Search access**: consumer searches for data, knowing certain semantic properties of the data

Note that sometimes consumer wants to access data with a combination of both streaming and selection (e.g., charting), or with a combination of both search + selection + streaming (e.g., newsfeed).

We do not put restrictions on the storage solution for the data.

## The access layer

### DatasetDefinition and ready Dataset

A DatasetDefinition declares a **name**, **keys**, observation **schema**,
**layout**, and enabled **access modes**. Keys describe how to address subsets;
the observation schema describes returned data. They are independent even when
both contain `time`. Both use native Effect Schema.

`defineDataset` derives the operation input/output codecs from this declaration.
The returned definition retains keys, schema and layout for inspection; its
`access` contains the generated codecs used by Providers and wire boundaries.
Callers never author those codecs independently. Migrating schema libraries or
Provider lifecycles must preserve this Dataset-level contract.

```ts
import { Schema } from "effect";
import { defineDataset, k, Layout } from "@openchart/server/data/dataset";

const Article = Schema.Struct({ title: Schema.String, source: Schema.String });
const news = defineDataset({
  name: "news.foobar",
  keys: Schema.Struct({ source: k.eq(Schema.String) }),
  schema: Article,
  layout: Layout.Row,
  access: { select: true, stream: true, search: true },
});
```

- `k.eq(schema)` declares equality addressing; `k.range(schema)` declares range
  addressing. Apply optional/schema modifiers before the key helper. Select
  derives equality values and `{from?, to?}` ranges plus an optional positive
  `count`; stream includes equality keys only. Search uses `{query, limit?}`.
  Count and limit are reserved and cannot be key names.
- `Layout.Row` selects row arrays and streams individual observations. Search
  returns observations with an optional numeric score; score is reserved in
  searchable observation schemas.
- `Layout.Timeseries` selects and streams the canonical `@openchart/timeseries`
  DataFrame. It requires a numeric observation time and exactly one required
  numeric range key named time. The builder removes time from the observation
  fields and retains `defineDataFrame(fields, time)` as its `frame` factory,
  sharing that factory's codec between both operations.
  Other columns are required number/string/boolean schemas. Timeseries search
  is not supported.

Timeseries owns time ordering, column lengths and Arrow IPC encoding; null and
NaN remain distinct.
Dataset does not duplicate those checks or its codec. Definitions open no clients.

`Dataset<D>` is a ready runtime object. Its exact methods and query/result types
derive from D. Finite methods return Effects; stream acquisition returns a scoped
Effect of Stream and establishes upstream buffering before historical selection.
The erased Dataset type exposes only the declaration: callers resolve a concrete
Definition or use its registered adapter before invoking operations.

Providers embed their clients/credentials in Dataset method closures. No pending
credential dependency or public acquire Effect remains in a published Dataset.
Provider methods fail with `DatasetFailure`: a closed `Dataset.*` reason plus a
server-only upstream cause. `makeDataset` locates every failure, including
stream elements, as `DatasetError { dataset, operation, reason, cause }`; methods
that do not match the declaration are a defect. See [errors](errors.md).
`makeDataset` uses the Provider scope only for admission: retired handles reject
new operations with `Dataset.Retired`. Accepted finite operations run to
completion in their own Scope, including pagination/enrichment; explicit caller
cancellation still aborts I/O. Each acquired stream owns a child of the caller
session Scope, even before consumption. Acquisition failure, stream
completion/failure/cancellation, or caller Scope closure releases that
subscription's resources. Renewing within the same session cannot retain the
previous subscription's sockets, tasks or health checks.
Provider retirement stops stream producers and drains accepted updates before
normal completion. A closed subscription cannot be consumed again. Typed internal
requests are trusted; unknown transport/source payloads are parsed at boundaries.
Concrete Providers own their count/limit pagination and completeness semantics.

### DatasetProvider and Catalog

The Dataset framework and ready handles live under `server/data/dataset`; there
is no browser Dataset package. Each concrete Provider owns its declarations,
I/O, configuration and Feed adapters under `server/data/providers/<name>`.
Multi-Dataset Providers group pure declarations in `datasets/definitions/`,
native access in `datasets/`, and consumer adapters in `feed/`. Shared I/O lives
in `client.ts`; the directory-named entry point owns Provider activation.
`providers/index.ts` registers Provider Layers and their Feed bindings together.
Their Layers
express static service dependencies. `watch(): Stream<readonly Dataset[]>`
publishes the Provider's complete current ready set. Missing credentials,
disabled settings or pending construction produce []; the observer survives so
configuration changes can restore access. Providers retire old instances before
publishing replacements or withdrawals. Retirement closes admission and signals
subscriptions; it does not interrupt accepted finite operations. Runtime request errors such as rate
limits do not by themselves withdraw a whole Provider.

Binance and Yahoo need no API key. Each owns `providers.<name>.enabled`, default
true, observes native configuration reloads and manages its Dataset scope.
Each owns a client created once per Provider Layer, retaining quota and cooldown
state across activations. Binance owns request weights, advertised quotas and
usage headers; each client selects its retry statuses. The shared HTTP helper
only runs concurrency, cancellation and Retry-After cooldown/retry mechanics.
Binance also picks its host on every activation. Requests start on
`data-api.binance.vision` while `/api/v3/ping` races it against
`api.binance.com` (behind CloudFront, so distant clients connect far faster)
through that client. The first success, with its paired stream host, serves
later requests until it is refused (403, or 451 for a restricted location),
unreachable or failing. That restores the default and races again, so a pick
that recovers comes back; request errors and rate limits keep the pick. An
explicit `restUrl` or `websocketUrl` skips the race.
Access-checked Providers expose `checkAccess` and `refresh` independently of ready
Datasets. Access is either granted or requires subscribing or managing an
existing subscription; failed checks remain errors. Binance and Yahoo always grant
access without network I/O. Settings renders the same contract for every Provider,
without rewriting the enabled preference. Its retry and confirmed subscription
status changes refresh activation; account writes also invalidate OpenChart work.

Their shared configured-provider helper checks access before acquiring Datasets and
uses Stream switching to cancel stale acquisition. Access requirements and
`Dataset.AccessDenied` failures wait for reactivation; other construction failures
(not defects) retry while enabled. It releases old activation scopes on
invalid/disabled config. The acquisition callback
receives a native Deferred retirement signal. Binance stops socket ingestion and
ends its Queue so accepted messages drain; Yahoo finishes an active poll and
starts no further polls. Request/session scopes own the I/O resources. Captured
credentials and immutable data remain usable; shared closable clients must be
borrowed for the complete operation if a future Provider introduces them. OAuth sources can implement the same
watch contract while owning their credential refresh independently.

OpenChart is the third Provider (`openchart`). Its `client.ts` owns one
account-scoped OpenChart API client; runtime injects its reset callback into Auth.
`contract.ts` owns typed requests/results. Client exposes capabilities, listing search,
single bar pages and acquired live activity; it owns endpoint paths, serialization,
JSON/Arrow validation, unit conversion and response identity checks. Datasets consume
decoded values and own complete pagination, DataFrames and liveness monitoring.
OpenChart access checks cloud admission before publishing ready Datasets. The app
requires sign-in, so missing or rejected credentials remain errors; a 403 queries
Billing to explain the required action. A failed
billing lookup or a denial for an active/trialing subscription remains an error,
never a Subscribe offer. Billing summaries cannot grant data access. Account reset cancels private
work and re-evaluates readiness; ordinary provider-disable drains accepted updates.
Search preserves native numeric IDs and supports the API's bounded 200-result
search, with Feed-owned class filtering and global limits; it is not indexable.
Historical Arrow responses paginate using half-open millisecond bounds, decode
nanoseconds/fixed-point prices once, and reject incomplete IPC. Each OpenChart client
owns at most one Cloud WebSocket. `live.ts` multiplexes subscriptions over it,
sharing identical `(listing, resolution, session, adjustment)` selections across
charts and alerts. New consumers receive the current open bar, never a cached
finalized bar. Each consumer has a bounded queue; overflow fails that consumer.
The last consumer releases its subscription; the last subscription closes the
socket. Replacement waits for the previous physical connection to close.
Subscriptions acknowledge and buffer before history acquisition. History supplies finalized bars; live supplies the
current open bar, without revising the snapshot's closed tail. Subsequent updates
cannot regress timestamps, revisions or finality. Heartbeats
are liveness only. Per-subscription errors resubscribe only the affected series.
Server-requested renewal (1012/1013) reacquires authorization,
buffers the new socket, then fills closed bars since the last observation before
draining live; already committed bars remain immutable. Failed admission and
ordinary failures propagate instead of retrying indefinitely.
OpenChart session coverage is explicitly `regular`, `extended` (pre + regular + post),
or `24h` (all available hours). Session participates in Dataset identity and is
forwarded unchanged to history and live. Every advertised resolution and price
basis supports history and live. The renderer and alerts consume the ordinary
Feed contract.

Catalog is a long-lived Effect service. It subscribes once per Provider and
publishes a complete ready-set snapshot through SubscriptionRef. Identical
instance sets retain the snapshot. A stopped/failed Provider watch is reported
and removes only that Provider's contribution. Duplicate implementations and
undeclared Definition identities are wiring defects: `list()` and `watch()` die
rather than overwrite valid bindings. Catalog has no `get`; consumers find a
Dataset by exact Definition identity, as Feed adapters do.

Catalog owns observation and aggregation. It never reads Provider config,
executes acquisition, stores unavailable placeholders or disposes Dataset
instances. Definitions remain separately discoverable while unavailable.

### Feed provisioning and versions

`Feed` consumes Catalog and shared Events. It adapts available Datasets through
Provider-owned exact-Definition bindings; unrelated definitions do not participate.
Feed provisioners never import concrete source implementations.
The Bars and Symbology provisioners return Effects of plain services from ready
instances. They acquire no resources and have no credential or Scope requirements;
Bars session acquisition remains scoped to the caller.

One private Ref stores the last successful `{version, datasets, services}` snapshot.
A scoped Catalog observer processes relevant snapshots sequentially. A commit
installs the complete snapshot before publishing `feed.version.changed` through
the shared Events service. Identical relevant Dataset instance sets keep the
version. `Feed.get()` selects current services at request entry; requests carry
no version precondition. Returned services and accepted work survive later Feed
replacements and Provider retirement. Caller cancellation still aborts its own I/O. Feed owns no per-version Layer or resource scope.

Failed provisioning is logged, leaves the complete previous snapshot in place and
keeps observing Catalog for recovery. Dataset handles in that snapshot still fail
when starting a new operation after their Provider retires them. A terminal Catalog observation failure is
logged and retains the snapshot; there is no separate Feed failure state or event.
There is no FeedSelection, public FeedGeneration or Provider activation controller
inside Feed. The Feed Layer stays static; its scoped subscription updates the Ref.

### Consumer Feed contracts

`common/market` owns the shared market vocabulary (ProviderId, Listing,
SessionType, TradingDay) as Effect Schema. `common/feed` composes it into
consumer-facing Effect Schema request/response contracts, Unix-millisecond timestamps,
provider-scoped listings, public failures, and the minimal Bars transport envelope.
The browser imports no Dataset access or Effect runtime. See
[Feed behavior and the runnable demo](feeds.md) for request/session examples.

Bars requests choose a provider and require from/to/countBack. Numeric to is an
exclusive history bound; 'now' opens a buffered continuation before resolving the
cutoff. Bars Feed returns the complete range plus enough earlier observations to
satisfy countBack, with inspected range and proven hasMoreBefore metadata. It does
not change Dataset's native count limit. The browser hook owns one active continuous-window observation; new inputs
unsubscribe it immediately. Loading may retain its stopped data or clear it;
see the Feed document for display, retry and cleanup rules. Search preserves provider identities without
cross-provider listing mapping or deduplication.

`provisionBars(datasets)` and `provisionSymbology(datasets)` return Effects of
plain service objects, without building a dependency Context.
Provider adapters explicitly recognize supported Definitions and translate their
source-specific queries/results. A matching shape alone never proves semantic
compatibility. Bars route to the requested provider. Search runs participating
sources concurrently, uses stable ordering, then applies the global limit.
A participating source failure fails the search rather than presenting partial
results as complete. Empty source sets produce unavailable services, not empty
successful data; Bars capabilities are empty.

### Transport and frontend lifecycle

The Node host mounts finite `feed.symbology.search` and `feed.version` queries at
`/trpc/`. Feed notifications share `/trpc/events.subscribe` with Resource invalidations. All Bars operations, including finite history and capabilities,
use `/hose`. Application dispatch reads only the operation name in `body.type`
and selects an explicitly registered handler. The application declares a top-level
`hoseRouter` with `barsChannel`; additional application handlers register there.
Every host mounts that same router. Handlers execute through the host-provided
`Context`, shared with tRPC. `@openchart/hose/node` owns WebSocket adaptation and
connection cleanup. Unknown operations fail their channel, and duplicate types
fail during registration. No global business-schema union governs Hose.

A Bars channel emits exactly one snapshot followed by updates;
its scope remains open throughout consumption. The shared server error boundary
exposes the encoded `FeedError` (its Feed reason) at tRPC `data.error` and as
the Hose error `body`; causes stay on the server ([errors](errors.md)).
Cancellation reaches the Effect fiber and Provider I/O. Hose itself remains
payload-agnostic and has no replay semantics.

The ordinary `app/src/lib/feed` client and its Hose connection remain stable for
one application lifetime. Version observation is independent: on initial
connection/reconnection and Feed invalidation it queries the current version,
ignoring superseded responses. The server emits an application `ready` frame after subscribing to the bus.
Feed queries only after that frame, avoiding an initial subscription gap.

Finite query keys include the observed version and full request. Hooks do not
consume TanStack Query's cancellation signal: already-started requests finish
in their original cache entries after observers move to the new version. A late
old result cannot overwrite the new entry. Direct callers may still explicitly
cancel through RequestOptions. Versions describe availability changes, not
cross-request snapshot isolation or market-data revisions.

useBars does not subscribe to version changes. It uses observable-hooks to bind
request inputs and low-frequency window states, and switchMap to unsubscribe old
observations before new ones start. loadingBehavior controls keep/clear equally
across time windows and series identities; keeping data never keeps the old stream
running. Current views retain their original request and replayable updates.
Provider retirement completes normally; disconnect/overflow produces an error.
A notification error does not close the client or unmount existing observations.

Feed keeps each Dataset's layout. BarsSnapshot.data and each update are native
DataFrames with all source columns, labels and gaps. History/window operations
select and concatenate columns; they do not create Bar object arrays. The shared
timeseries codec handles wire encoding and decoding, while the renderer consumes
the columns it needs.

The browser lib exposes cold Observable<BarsView>, with subscription-owned channel
cleanup and no Promise<BarsSession>. Each view emits its live batches separately
from React state. React Query remains responsible for finite search/capability
requests, and is not part of the Bars request pipeline.

Server and client buffers are bounded. Each observer replays from its paired
snapshot; overflow requires a fresh session. There is no durable replay across
disconnections or guarantee for exchange events the upstream never supplied.

### Local calendar Dataset

The existing calendar implementation moved to
`server/data/providers/local/market/calendar`. Its tables and scheduling
rules are unchanged. Composition supplies a separate read-only Drizzle connection;
activation loads a consistent snapshot of the small calendar tables. The Provider
does not write, migrate, or close that connection. These schemas remain outside
the application's SQLite migration ledger. Calendar-ID selection remains distinct
from consumer listing-to-calendar resolution, whose Feed implementation is deferred.
