# Hose routing

`common/hose` owns the wire protocol, handler registry, and logical-channel
lifecycle. `server/lib/hose` adapts Effect Streams and applies the server's
domain error policy. Each feature owns its request schema and response values.

## Registration and context

The application declares a `HoseRouter<Context>` at module scope. It owns route
names and handlers, with no runtime or connection state:

```ts
import { HoseRouter } from "@openchart/hose";

export const hoseRouter = new HoseRouter<Context>()
  .route("bars.open", barsChannel)
  .route("bars.capabilities", barsChannel);
```

The Node host mounts it through a separate Node-only export:

```ts
import { HoseServer } from "@openchart/hose/node";

const hose = new HoseServer({
  server,
  path: "/hose",
  router: hoseRouter,
  createContext: () => ({ runtime }),
});
```

`HoseServer` owns WebSocket adaptation, event listeners, and connection cleanup.
It calls `createContext(request)` synchronously once for each accepted socket.
Every handler on that connection receives the same context as its third argument.
A context failure closes only that socket with 1011 and a safe `context_failed`
reason. It does not expose the thrown error or call a business handler.

An optional `authorize(request)` runs before the upgrade completes: `false`
answers 401 and creates neither context nor connection. Hose carries no auth
policy of its own; the host supplies the predicate (the application's
`createServer` does when its `access` option is set, see
[desktop runtime](desktop.md)).

`server/context.ts` owns the application's shared tRPC/Hose Context. The
module-level `barsChannel` executes through `ctx.runtime`; independent servers
reuse the same router while supplying their own runtime instances.

Register application operations on the module-level router:

```ts
hoseRouter.route("news.stream", newsHandler);
```

`createServer` always mounts this router. Its options configure the application
runtime only; individual server instances cannot replace the application's routes.

Empty or duplicate names throw immediately, including across composed routers.
Composition copies route definitions; subsequent additions to source routers do
not change the result. Connections use their supplied router directly without
copying registrations. Configure routers before mounting them.

`HoseConnection<C>` owns one socket's protocol state, channels, and writer.
It accepts the shared router and a context value. Its low-level API is useful for
other socket adapters and protocol tests; application hosts use HoseServer.
The root `@openchart/hose` export does not load `ws` or Node HTTP code.

## Shutdown

`HoseServer.dispose()` detaches its upgrade endpoint, ends every channel and
terminates its sockets. Cleanup continues after a teardown failure and then
throws the first failure. It is idempotent and does not close caller-owned HTTP.

Dispose Hose before closing HTTP: Node's HTTP close callback waits for active
upgraded sockets. The application returned by `createServer()` exposes
`await server.shutdown()` to dispose Hose, close HTTP connections, and await
runtime disposal, even when a prior step fails. The real-data demo uses this
method for SIGINT/SIGTERM. Native HTTP `close()` alone is not application shutdown.

## The two `type` fields

```json
{
  "type": "open",
  "id": "news-1",
  "body": { "type": "news.stream", "topic": "markets" }
}
```

- `message.type` selects a wire operation: clients send `open`, `data`, or
  `close`; servers send `data`, `done`, or `error`.
- `open.body.type` selects the registered handler by exact string equality.
  It has no prefix matching, fallback handler, or relationship to channel `id`.
- `id` identifies one channel on that socket. Many channels can use the same
  handler. Responses and close messages use `id` and do not repeat the route.

The router parses only the non-empty `body.type` string, then forwards the
original body unchanged. The handler parses its own remaining fields.
Response bodies have no required routing field. OpenChartClient uses
`{type: 'dataset.stream', dataset, query}` for its stream requests.

Malformed wire envelopes close the socket. A missing, invalid or unregistered
`body.type`, or a handler that throws before completing, fails only its own
channel and never exposes the exception. The `error` message, its codes and the
error layers are specified in the [Hose README](../../common/hose/README.md).

Handlers may return a teardown. HoseConnection runs it exactly once on completion,
error, cancellation, or disconnect, including synchronous completion before
the handler returns. Reusing handlers does not share channel lifetimes.

## Duplex channels

After `open`, a client may send `data` messages on the same `id`. The wire shape
is the server's `DataMsg`, so both directions are symmetric. Hose still never
interprets a body: pairing requests with responses belongs to the protocol
carried inside, for example JSON-RPC for the
[Tea language server](tea-language-server.md).

```ts
hoseRouter.route("tea.lsp", (body, channel, ctx) => {
  const session = startSession((message) => channel.data(message));
  channel.onData((message) => session.receive(message));
  return () => session.dispose();
});

const channel = hose.openChannel({ type: "tea.lsp" }, events);
channel.send(message);
channel.close();
```

- `channel.onData` holds one listener. A handler registers it synchronously
  while opening; inbound data without a listener is dropped. Handlers that never
  call it keep today's request-then-stream behavior.
- Inbound `data` for an unknown `id` is ignored, not a protocol error: the
  server may have just sent `done` or `error` while the client's message was in
  flight.
- Outbound bytes stay bounded by HoseWriter. Inbound frames have a fixed size
  limit of 1 MiB; a larger frame closes the socket with `1009`. HoseServer
  enforces it through the WebSocket library's `maxPayload`; another socket
  adapter that drives HoseConnection directly owns its own limit. Hose adds no inbound
  queue: listeners run synchronously in arrival order.
- A listener that throws fails only its channel, as a throwing handler does.
- `openChannel` returns a `ClientChannel`, `{ send, close }`. A body that cannot be
  encoded throws to its caller, from `openChannel` and from `send` alike, and
  touches no other channel. `send` before the socket has
  delivered `open` is queued behind it; `send` after the channel ended throws.
- A socket drop ends every channel with an error. Hose does not replay sent
  data or reopen duplex channels; the owner re-establishes its own session.

`observe` and `request` remain receive-only facades over `openChannel`.

## Client consumption

The app's `AppTransport` owns one HoseClient per backend connection. Feed and Tea
share it and cancel only their own channels. App connection cleanup disconnects
the socket when the connection is replaced or the app unmounts.

```ts
const hose = new HoseClient("wss://example.com/hose");
const result = await hose.request({ type: "search", query: "BTC" }, { signal });
const subscription = hose.observe({ type: "prices" }, { signal }).subscribe({
  next: (value) => consume(value),
  error: (error) => report(error),
  complete: () => finished(),
});
subscription.unsubscribe(); // closes this channel, keeps the shared socket
hose.disconnect(); // shuts down the owning connection
```

The URL constructor supplies the standard WebSocket adapter. Authenticated or
custom transports continue supplying a Link factory. Native callback wiring
belongs to Hose, not a business Feed.

`observe` is a cold RxJS Observable. Each subscriber opens an independent logical
channel; all channels share the connection. AbortSignal errors with its reason;
unsubscribe silently cancels the channel; server done completes it. Listeners
and channel teardowns are released even for synchronous responses. A pre-aborted
request does not open a connection. Socket failure remains an error, with no
implicit channel replay. `request` resolves the first response and closes its
channel; completion without a response fails.

Both APIs return unknown payloads, and a channel failure is a `HoseError` (see
the [Hose README](../../common/hose/README.md)). Feed transport decodes its shared
contracts and a `failed` body, and its Bars session module owns first-snapshot
ordering and bounded replay.
Hose never interprets a first response as a snapshot or stores application data.
The callback-based `openChannel` remains available for native Effect/queue adapters.
