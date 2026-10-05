# Feeds and the real-data demo

```text
React Query / useBars -> Promise + Observable client -> tRPC / Hose
                                                           |
                                                     Feed
                                                           |
                                           Provider route / search merge
                                                           |
                                                Effect Dataset access
                                                           |
                                              Binance / Yahoo Finance
```

Use Node 24 LTS for the complete test suite. The optional `sean_demo/` directory
is ignored by Git and excluded from workspace checks; fresh checkouts do not
include it. If you have a local copy, run from `v2`:

```sh
just install
just feed-demo
```

Open http://127.0.0.1:3100. The backend listens on loopback port 3101; Vite proxies
`/trpc` and `/hose`. The demo uses an isolated in-memory application database,
public market data, and no OpenChart login or Python. Both processes stop together.

Provider availability comes from the `providers` namespace in `sean_demo/settings.json` when
launched by this command. For example:

```json
{
  "providers": {
    "binance": { "enabled": true },
    "yfinance": { "enabled": true }
  }
}
```

Without enabled flags, sources start enabled. Each Provider watches its own
settings, publishes ready datasets and retires them when disabled or config fails.
Catalog aggregates the sets; one permanent Feed Layer observes Catalog and
replaces a Ref containing its last successful service snapshot. Provisioners
return Effects of plain services and acquire no resources. The old runtime
Feed-selection API and demo toggles have been removed.

## Ownership

- `common/feed` owns consumer contracts. `server/data/dataset` owns Dataset
  declarations, derived codecs and ready access; `server/data` owns Catalog.
- `server/data/providers/<name>` owns each source's declarations, I/O, configuration,
  lifetimes and Feed adapters. Native access lives in `datasets/`, adapters in
  `feed/`, and shared I/O in `client.ts`. `providers/index.ts` registers services
  and bindings once.
- `server/feed/bar` owns Bars service, shared history reads, provisioning and hose-handler.
  `symbology` owns its service, merged-search provisioner and router;
  its RPC path is `feed.symbology.search`. `logo` provisions Provider bindings;
  `calendar` currently owns its service contract and unavailable implementation.
- The Feed root owns whole-Feed service/layer/router composition, version
  coordination and shared events/errors. It contains no business implementation
  registry or combined provisioner. Bars has no unused tRPC router.
- `HoseRouter` in `common/hose/src/router.ts` dispatches by `open.body.type`.
  The application declares `hoseRouter` at module scope, registering `barsChannel`.
  Every `createServer()` mounts that same router; handlers receive the host's
  runtime through context. Unknown operations
  affect only their channel; duplicate names fail during registration.
  See [Hose routing](hose.md) for registration and the two `type` fields.
- `app/src/lib/feed/transport.ts` wires typed tRPC/Hose operations and version
  observation. `bars.ts` owns window observations, snapshot/update ordering, bounded replay and live view sharing. Native
  WebSocket wiring and cancellable Observable/request channels belong to
  `common/hose`; app hooks own React lifecycle.
- `packages/react` wraps the unchanged V1 core. It accepts structural bar data and
  a subscription; it has no provider, Feed, React Query, or Effect dependency.
- `sean_demo` is the sole OpenChart composition point allowed to import the V1 wrapper.

## Consumer behavior

A search result contains `{provider, listing}`; capabilities use the same pair.
Bars add resolution/session/adjustment and required `from`, `to`, `countBack`.
Times are Unix milliseconds. Numeric `to` is an exclusive fixed-window end;
`to: 'now'` prepares continuous updates before the server chooses a snapshot cutoff.
There is no separate live switch. Future bounds never become claimed history:
the cutoff is capped at server time, and from must precede that effective cutoff.

The Bars adapter reads the full interval without a count limit and, concurrently,
up to countBack + 1 observations before from. It retains only enough earlier bars
to meet the minimum; the excluded look-behind proves hasMoreBefore. Parallel
admission avoids a new read starting only after accepted work finishes during
Provider retirement, at the cost of bounded extra history. Empty/closed periods
are not automatically history exhaustion. Provider-native count semantics and
DataFrames remain unchanged. Native correction metadata covers backfilled bars.

The local backend shares complete historical spans across price charts and Tea.
`server/feed/bar/history-cache.ts` owns range/count reuse; each Provider creates
one cache per ready Bars Dataset and installs its select behind Dataset admission.
All native series keys participate in identity. Separate windows stay separate;
overlapping or touching coverage merges, including successfully inspected empty
intervals. Only missing intervals are fetched. Backward limits count actual rows
within contiguous coverage, never across an unqueried gap.

Effect Cache bounds retention to 64 series and five minutes; a series exceeding
10,000 rows or 32 spans is evicted without truncating its response.
SynchronizedRef serializes fills per series and commits only successful reads.
Providers supply available-history bounds and recent correction windows; open
bars and recent tails remain source reads. TTL bounds older corrections and
corporate-action changes. Cache access follows Dataset admission: retired Datasets
reject new reads, accepted reads may finish, and replacements start empty.
OpenChart account reset triggers Dataset replacement; explicit live
resynchronization invalidates coverage before catch-up. This cache lives in the
App backend and does not require Cloud changes or cache-aware callers.

Feed preserves Dataset layout: snapshots and updates carry the source's native
DataFrame, including all columns, labels, and missing values. Adapters select rows
to discard stale corrections but never convert frames to Bar objects or remove
native metadata. Every Bars frame must also include the market `BarColumns`
vocabulary (`open`, `high`, `low`, `close`, `volume`) from `common/market`: the
column is required, a cell may be missing. The `BarsSnapshot` type makes a Dataset
without these columns fail to compile in Provider Bars adapters, and the shared codec
rejects such a frame at the wire. Consumers read these names, never
provider-specific ones. History concatenates columns with timeseries helpers.
`BarsMessage` composes the existing `dataFrameCodec`; the Hose handler encodes it
and the browser transport decodes it. NaN/null conversion stays in timeseries.

Snapshots contain `range`, DataFrame `data`, and `hasMoreBefore`. range is
actually inspected coverage, including any backwards expansion. The wire operation
remains bars.open; the browser exposes client.bars.observe(request). Subscribing
opens one logical channel or joins a shared one (below). It emits one BarsView carrying
its request and snapshot; later batches go only to view.updates. Rows in update frames
replace matching timestamps, including source-provided corrections.

Closing a channel completes its updates. A retained
view still replays accepted batches after the original snapshot, then completes:
it displays the last accepted state without keeping the old source alive. Errors
retain accepted replay followed by the error. Buffers remain bounded, overflow
fails explicitly, and neither the view nor its replay can reopen a stopped channel.
Subscribing to view.updates opens no additional channel.

The client shares open live views. A request joins the newest open view with the
same series and end when that view starts no later and asks for at least as many
bars; replayed updates cover the time in between. That view stays open for 5
minutes after its last subscriber leaves, so a chart that remounts (for example
after switching Dashboards) reattaches without reloading. A view replaced by a
wider request closes as soon as it is unwatched. Failed and finished views,
including every historical window, are never reused.

`useBars(request, {loadingBehavior: 'keep' | 'clear'})` uses RxJS switchMap and
observable-hooks. A changed request or retry unsubscribes the previous observation
before starting another. keep (the default) retains the stopped previous view;
clear hides it during loading and failure before a new snapshot. This applies to
all changes, including ticker, resolution and client changes. Display-policy
changes do not restart requests. Preserved data carries its original request;
consumers must not label it as the pending target's data.

A valid new snapshot replaces current. Errors are caught inside each request so
retry and later requests remain usable. If a stream fails after its snapshot,
its accepted view is preserved with error status. Normal completion retains ready
data. There is one active window observation per hook, no two-session handoff,
Promise session, manual Registry or multi-window history cache in the browser;
browser reuse is limited to the shared live views above. Historical spans are
reused by the backend Dataset cache independently of consumer observations.

React observes only loading/ready/error and new views via useObservableState.
Renderer bindings use view.updates (for example with useSubscription) to paint
without rendering React per batch. Request inputs are deduplicated by
Schema.toEquivalence(BarsRequest); retries are events rather than a counter.
Local view/result/options schemas stay in app/src/lib/feed/contracts.ts. The
client library and hooks remain in app/src/lib/feed and app/src/hooks, exposed
through the app's public entry points, without application bootstrap dependencies.

Query keys include version and the complete request. A new version moves finite
query consumers to a new cache entry; already-started queries finish in their
original entry. Hooks intentionally do not consume the Query cancellation signal.
The Feed client, Hose connection and existing Bars sessions remain unchanged.
Feed publishes `feed.version.changed` through the same Events service used by
Resource invalidations, after committing the replacement. The generic
`/trpc/events.subscribe` SSE transport carries these notifications; there is no
separate Feed SSE endpoint. Notification and data-session lifetimes are independent.

The SSE adapter emits a `ready` frame after establishing its PubSub subscription.
Feed waits for that frame; the tRPC `onStarted` acknowledgement is insufficient. On initial connection, reconnection, and each Feed invalidation, the
client reads the current version through the finite `feed.version` query. It
cancels superseded reads and ignores their late responses. This recovers changes
missed during disconnection without requiring event replay. Notifications remain
invalidations; the Feed service owns the current version and service instances.
Business requests carry no version. `Feed.get()` reads the current service set
once at request entry. Replacement does not cancel accepted operations.
Provider retirement closes admission to old Datasets; finite request resources
live in their own Scope until completion or explicit caller cancellation.
Binance stops ingestion and drains accepted updates; Yahoo finishes an active
poll and stops polling. Normal stream completion becomes Hose done and
Observable.complete, without closing the client socket. Notification errors also
leave existing sessions mounted. A consumer may explicitly open a fresh session.

Provisioning fails only on wiring defects, such as two Datasets routing one
provider. The defect is logged and the previous version and complete services
stay, with another attempt on a later relevant Catalog snapshot.
Retired Dataset handles reject new operations. A terminal Catalog
observation failure is logged and leaves the last snapshot readable. Feed has no
separate failure state or `feed.failed` event.

Feed failures are `FeedError { reason }` with a public Feed reason (see
[Error model](errors.md)). Provider adapters map Dataset failures through the one
exhaustive `datasetFailure(providerId)` table in `server/feed/errors.ts`. Feed's
own failures are `Feed.SourceUnavailable` (no ready source, naming the requested
provider when there is one) and `Feed.InvalidRequest` (a window that does not
start before its cutoff, or an index request the provider cannot accept). A
source declared live that returns no updates is a defect. A symbol index storage
failure is the server-only `SymbolIndexUnavailable`, which the boundary reports
as `internal`; a failed index job then carries no reason.

## Sources and capabilities

### Saved symbology

`feed.symbology.search` requires `indexed`. With `true`, matching saved listings
from currently available sources return immediately; zero local matches query all
participating providers. With `false`, each server request queries providers.
Both live paths upsert successful source observations before the global limit;
any participating source failure still fails the merged response. Indexed hits
do not promise complete cross-provider coverage. The picker automatically queries providers for each search and shows saved
index matches while waiting. Saved matches only accelerate display; provider
results determine the completed search, including an empty result or failure.

The read-only `symbology` Resource owns one listing table. Generic public writes
are hidden; backend-only transitions upsert observations or atomically replace a
complete provider/filter scope. IDs and revisions stay unchanged for identical
listings. Listing identity is `(provider, symbol, venue-or-null)`; counts derive
from committed rows and survive provider disablement and backend restarts.

`feed.symbology.index({providerId: 'binance', filter: {quoteAsset: 'USDT'}})`
accepts a backend-owned job and returns its run ID; use `filter: {}` for all
active Spot pairs. Binance's Dataset select enumerates the complete scope. Yahoo
remains search-only and its successful searches populate the same Resource.
The permanent SymbologyIndex service owns per-provider serialization of indexing
and live-search writes. Navigation and Feed replacement do not cancel jobs;
shutdown does. No partial snapshot commits or persistent run history exist.

`indexStatus` exposes static capability, current availability, and the latest
runtime job. Settings polls while visible and uses an indeterminate progress bar
because finite Dataset selects do not report intermediate totals. Its cards
compose shared collapsibles; each header retains saved counts and its independent
enable switch. Index controls request the full catalog without a scope input. HTTP quotas,
weighted admission, concurrency, Retry-After, and bounded retries belong to the
Provider's shared request owner and survive Provider reactivation.

Catalog commits do not change FeedVersion. Resource publication yields between
64-event batches so bulk commits can drain through bounded SSE. Resource and
indexed-query invalidations coalesce row bursts and refresh on ready/reconnect;
live queries do not refetch in response to their own writes.

Binance Spot uses public REST klines and exchangeInfo plus kline WebSocket
streams. It requires no API key and currently supports raw 24h crypto bars.
The adapter compares trade counts and observation metadata when joining buffered
WebSocket bars to REST history. [Binance public endpoints](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only).

The `yfinance` Provider uses TypeScript fetch against Yahoo chart/search. It
polls complete OHLCV bars every 15 seconds and supplies delayed continuous delivery.
It filters off-grid tail quotes and associates source period updates correctly;
it never invents minute OHLCV from last-price quotes or cumulative day volume.
Yahoo intraday retention and missing data remain source constraints. Exchange
latency varies; VOD.L is a useful delayed example during London trading hours.
The UI labels delayed polling and displays the source bar time, not a fabricated
uniform delay. [Yahoo exchange delays](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html).

Capabilities report only the supported resolution/session/adjustment combinations.
Logos resolve through the bundled `openchart.logos` Dataset. Its Provider owns
canonical IDs, names, explicit aliases, verified listing evidence and image bytes.
Canonical IDs cannot be shadowed by aliases; otherwise exact normalized aliases
take precedence. Crypto pairs and stock/exchange-qualified identifiers live in
the catalog. Alert inputs qualify known stock/crypto classes to avoid ticker
collisions. Fuzzy
name matching accepts prefixes or one edit from five characters onward, retaining
all candidates so the Feed returns a logo only for a unique match. Unknown,
weak or ambiguous identifiers return null; unavailable sources and read errors
remain Feed failures. Logo Dataset changes participate in Feed versioning.

`useLogo(identifier)` uses React Query and `feed.logos.get` to resolve a symbol,
company name or domain. Results cache by identifier and Feed version. Missing
identifiers disable the query; the alert feature still suppresses logos for
multi-market rules. The frontend contains no alias or image-path logic. The
Provider reads individual bundled images as data URLs, with no external requests.
The asset catalog's README records its scope and coverage.

Consumer Calendar retains its contract but currently returns unavailable.
Provider settings control availability; neither Catalog nor Feed writes configuration.
The two public Providers do not demonstrate OAuth; fixture tests cover retirement,
completion, explicit cancellation, restoration, and stale acquisition rejection.

## Continuity limits

Push stream acquisition establishes upstream buffering before history selection.
Polling reads are sequential. The same Hose channel carries snapshot and updates.
Neither stage silently truncates its queue. Overflow and source disconnect
produce an error; Reconnect opens a new snapshot. Intentional Provider retirement
completes normally after accepted updates drain, retaining client replay for
late subscribers. Disposal/Scope interruption is not translated to completion.
Client replay is bounded to 50,000 update points per observation; reaching the limit
requires reopening. There is no durable reconnect replay or guarantee about
updates that upstream never delivered.

Silence is also a failure. Binance klines arrive only on trades and at bucket
open, but its server pings every 20 seconds; 45 seconds without any frame fails
the stream. Every Yahoo request times out after 30 seconds. Each stream reports a
Monitoring check to whoever bound one (alerts do; charts do not). Binance is
healthy from its first frame and degraded while klines from the last 15 seconds
trail the local clock by over 10 seconds. Yahoo is degraded when
`regularMarketTime` has not advanced for 60 seconds inside Yahoo's reported
regular trading period; delayed exchanges still advance. Local `asOf` never
proves freshness.

## Verification

Run `just check` in `v2`; run the React package's typecheck/tests from
`packages/react`. Browser acceptance exercises merged BTC search, Binance 500-bar
live chart, VOD.L 500-bar delayed chart, Provider configuration changes, count/time windows,
resolution switching, pan/zoom, and fresh snapshots after reconnect. Closed
markets cannot establish that live data is being delivered; verify Yahoo updates
during an active venue session. See test files beside backend owners and app
`__tests__` for deterministic cancellation, ordering and generation races.

### Verified on 2026-09-11

- Browser: merged BTC search included Binance and Yahoo listings; Binance opened
  500 bars and received more than 40 live batches.
- Yahoo VOD.L opened 500 bars; its delayed tail advanced from 17:12 to 17:16
  Asia/Shanghai and its close changed from 128.75 to 128.8500061.
- Disabling Yahoo removed its capabilities and chart; enabling it opened a new
  snapshot. Switching to five-minute bars and a fixed historical window worked.
- Native HTTP and Hose integration tests cover cancellation, snapshot buffering,
  new generations, stale keys, and safe malformed-input errors.
- The same WebSocket carries Bars and an independently registered search handler
  with different payloads. Completion, cancellation, malformed requests and
  unknown operations on the other handler do not interrupt Bars updates.
- Full `just check` passed under Node 24 with Vitest workers bounded to four.
  OpenChart suite: 1052 passed, one opt-in integration test skipped.
  Under Node 24, app tests: 50 existing + 11 Feed + 16 lint-tooling checks passed.
  The React package's two tests passed. The demo production bundle contains no
  Effect or server runtime modules. V1 core has no changes.
- Run app tests under Node 24 to avoid Node 25's native Web Storage
  interfering with the existing jsdom harness.

### Refactor verified on 2026-09-12

- Provider watch now publishes ready Dataset arrays; Catalog owns aggregation,
  Feed owns only provisioning/version replacement. The old ProviderState,
  DatasetEntry and FeedSelection protocols are removed.
- Shared consumer schemas remain the single contract/type source; there is
  no generated alternate Feed schema package. `common/market`, `common/feed`,
  Dataset operations and DataFrame codecs all use native Effect Schema; the
  browser transport decodes with `Schema.is`/`Schema.decodeUnknown*`.
- `just check` passed: 1058 backend/common tests, one opt-in smoke test skipped;
  50 app tests, 12 Feed/hook tests and the lint-tooling checks passed. Demo
  production build passed. V1 core has no modifications.
- At http://127.0.0.1:3100, public Binance opened 500 bars and delivered more than
  20 update batches. Disabling Binance through its Provider settings changed the
  Feed version, removed its search results and closed the chart; restoring the
  original settings opened a fresh 500-bar chart and resumed updates.
- Yahoo VOD.L opened 500 bars with the Delayed/polling label. Its last source
  timestamp was 2026-09-11 23:30 Asia/Shanghai; this Saturday verification does
  not claim new exchange observations while the venue is closed.

### Feed business directories and RPC routing

Each Feed owns its service, provisioning and handlers under its business
directory. Root `service.ts`, `layer.ts` and `router.ts` compose those services
and coordinate versions. Search uses `feed.symbology.search`; `feed.version`
remains global. Bars continues through `bar/hose-handler.ts` and has no empty
RPC router. Existing cancellation, old-version rejection and snapshot/live tests
pass after the move. The complete `just check` and browser search/live-chart
verification also passed on 2026-09-12.

### Graceful retirement

- `makeDataset` checks admission only, runs finite methods in request scopes and
  leaves stream resources in their caller's scope. It no longer races requests
  against Provider revocation or guards every emitted value.
- Provider retirement, resource disposal and client transport shutdown are distinct.
  Current public Providers use per-request resources; no reference-counted shared
  client or custom lease framework is needed. A future shared closable client
  must be borrowed for the full operation and outlive its borrowers.
- Version changes isolate finite-query caches while preserving client/session
  identity. Explicit unmount/request cancellation and transport failures still
  release their resources.
- Deterministic tests cover retirement during finite work, Binance queue drain
  before first consumption, Yahoo retirement during a poll, real Hose completion
  with an unchanged socket, and old Query results settling in their old cache entry.

OpenChart exposes history and live for every supported bar resolution and
price basis (`raw`, `split`, `split_dividend`). MarketFeed owns adjustment; App
passes the same selection to both reads and stitches finalized history with live
bars. Unsupported sessions and unavailable adjustment factors fail explicitly.
History windows intersect OpenChart's Unix-epoch lower bound, so zooming out before
1970 returns the available history without sending negative timestamps upstream.
