// Purpose: Multiplex one account's live series over one authenticated Cloud socket.
import {
  Cause,
  Deferred,
  Effect,
  Option,
  Queue,
  Redacted,
  Schema,
  Stream,
  SynchronizedRef,
} from "effect";
import WebSocket from "ws";
import {
  OpenChartResolution,
  openchartBar,
  type BarsSubscription,
  type LiveEvent,
} from "./contract";
import {
  CredentialUnavailable,
  OpenChartInvalidResponse,
  OpenChartLiveError,
  OpenChartRejected,
  OpenChartResyncRequired,
  OpenChartUnavailable,
  type OpenChartError,
} from "./errors";

const decodeWireEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal("heartbeat") }),
      Schema.Struct({ type: Schema.Literal("subscribed"), id: Schema.String }),
      Schema.Struct({
        type: Schema.Literal("unsubscribed"),
        id: Schema.String,
      }),
      Schema.Struct({
        type: Schema.Literal("error"),
        id: Schema.String,
        code: OpenChartLiveError.fields.code,
      }),
      Schema.Struct({
        type: Schema.Literal("bar"),
        id: Schema.String,
        listing: Schema.Int,
        resolution: OpenChartResolution,
        bar: openchartBar,
      }),
    ]),
  ),
);
type Consumer = Queue.Queue<LiveEvent, OpenChartError | Cause.Done>;
interface Subscription {
  readonly id: string;
  readonly key: string;
  readonly query: BarsSubscription;
  readonly ready: Deferred.Deferred<void, OpenChartError>;
  readonly consumers: Set<Consumer>;
  latest?: LiveEvent & { type: "bar" };
}
interface Connection {
  readonly socket: WebSocket;
  readonly owner: AbortSignal;
  readonly closed: Deferred.Deferred<void>;
  readonly subscriptions: Map<string, Subscription>;
  failure?: OpenChartError;
}

const accountChanged = () => new CredentialUnavailable({ reason: "changed" });

// Commands before the handshake are dropped; the open handler subscribes every pending series.
const send = (connection: Connection, command: object) => {
  if (connection.socket.readyState === WebSocket.OPEN)
    connection.socket.send(JSON.stringify(command));
};
const sendSubscribe = (connection: Connection, entry: Subscription) =>
  send(connection, { type: "subscribe", id: entry.id, series: entry.query });

const failSubscription = (
  connection: Connection,
  entry: Subscription,
  error: OpenChartError,
) => {
  connection.subscriptions.delete(entry.key);
  // Waking a consumer can immediately resubscribe; retire the identity first.
  Deferred.doneUnsafe(entry.ready, Effect.fail(error));
  for (const queue of entry.consumers)
    Queue.failCauseUnsafe(queue, Cause.fail(error));
};

/** Fail the socket and every series on it; only the first failure counts. */
const failConnection = (connection: Connection, error: OpenChartError) => {
  if (connection.failure) return;
  connection.failure = error;
  for (const entry of connection.subscriptions.values())
    failSubscription(connection, entry, error);
  connection.socket.terminate();
};

const closeIfIdle = (connection: Connection) => {
  if (!connection.subscriptions.size)
    failConnection(connection, new OpenChartUnavailable({}));
};

/** The last consumer unsubscribes its series; the last series closes the socket. */
const leave = (
  connection: Connection,
  entry: Subscription,
  queue: Consumer,
) => {
  entry.consumers.delete(queue);
  if (entry.consumers.size || connection.subscriptions.get(entry.key) !== entry)
    return;
  connection.subscriptions.delete(entry.key);
  send(connection, { type: "unsubscribe", id: entry.id });
  closeIfIdle(connection);
};

/** Overflow fails only the slow consumer. */
const broadcast = (
  connection: Connection,
  entry: Subscription,
  value: LiveEvent,
) => {
  for (const queue of entry.consumers) {
    if (Queue.offerUnsafe(queue, value)) continue;
    Queue.failCauseUnsafe(queue, Cause.fail(new OpenChartUnavailable({})));
    leave(connection, entry, queue);
  }
};

/** Route one server frame to its series; protocol violations fail the socket. */
const dispatch = (connection: Connection, data: WebSocket.RawData) => {
  const decoded = decodeWireEvent(data.toString());
  if (Option.isNone(decoded)) {
    failConnection(connection, new OpenChartInvalidResponse({}));
    return;
  }
  const event = decoded.value;
  if (event.type === "heartbeat") {
    for (const entry of connection.subscriptions.values())
      broadcast(connection, entry, event);
    return;
  }
  const entry = Array.from(connection.subscriptions.values()).find(
    (entry) => entry.id === event.id,
  );
  if (!entry) return; // An already-unsubscribed ID can still have in-flight frames.
  if (event.type === "subscribed") {
    Deferred.doneUnsafe(entry.ready, Effect.void);
  } else if (event.type === "error") {
    failSubscription(
      connection,
      entry,
      new OpenChartLiveError({ code: event.code }),
    );
    closeIfIdle(connection);
  } else if (
    // A cancellation acknowledgement can only belong to an already-retired ID.
    event.type === "unsubscribed" ||
    event.listing !== entry.query.listing ||
    event.resolution !== entry.query.resolution
  ) {
    failConnection(connection, new OpenChartInvalidResponse({}));
  } else {
    const value = { type: "bar", bar: event.bar } as const;
    entry.latest = event.bar.final ? undefined : value;
    broadcast(connection, entry, value);
  }
};

const openConnection = (
  url: URL,
  token: Redacted.Redacted<string>,
  owner: AbortSignal,
): Connection => {
  const socket = new WebSocket(url, {
    headers: { Authorization: `Bearer ${Redacted.value(token)}` },
    followRedirects: false,
  });
  const connection: Connection = {
    socket,
    owner,
    closed: Deferred.makeUnsafe<void>(),
    subscriptions: new Map(),
  };
  const abort = () => failConnection(connection, accountChanged());
  socket.on("open", () => {
    for (const entry of connection.subscriptions.values())
      sendSubscribe(connection, entry);
  });
  socket.on("message", (data) => dispatch(connection, data));
  socket.on("error", () =>
    failConnection(connection, new OpenChartUnavailable({})),
  );
  socket.on("unexpected-response", (_, response) => {
    response.resume();
    failConnection(
      connection,
      new OpenChartRejected({ status: response.statusCode ?? 503 }),
    );
  });
  socket.on("close", (code) => {
    owner.removeEventListener("abort", abort);
    failConnection(
      connection,
      code === 1012 || code === 1013
        ? new OpenChartResyncRequired({})
        : new OpenChartUnavailable({}),
    );
    Deferred.doneUnsafe(connection.closed, Effect.void);
  });
  owner.addEventListener("abort", abort, { once: true });
  if (owner.aborted) abort();
  return connection;
};

/** Own a shared socket until the last consumer leaves or the account changes. @example const live = yield* makeLive(url, credential, owner); */
export const makeLive = Effect.fn("OpenChart.makeLive")(function* (
  url: URL,
  credential: () => Effect.Effect<Redacted.Redacted<string>, OpenChartError>,
  owner: () => AbortSignal,
) {
  const current = yield* SynchronizedRef.make<Connection | undefined>(
    undefined,
  );
  let sequence = 0;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      const connection = SynchronizedRef.getUnsafe(current);
      if (connection) failConnection(connection, accountChanged());
    }),
  );
  const connect = Effect.fn("OpenChart.live.connect")(function* (
    previous: Connection | undefined,
  ) {
    if (previous && !previous.failure) return previous;
    // Wait for the previous physical socket to close before opening its replacement.
    if (previous) yield* Deferred.await(previous.closed);
    const signal = owner();
    const token = yield* credential();
    if (signal.aborted) return yield* accountChanged();
    return yield* Effect.acquireRelease(
      Effect.sync(() => openConnection(url, token, signal)),
      // An opener interrupted before joining must not strand an idle socket.
      (connection) => Effect.sync(() => closeIfIdle(connection)),
    );
  });
  const join = (
    connection: Connection,
    query: BarsSubscription,
    queue: Consumer,
  ) => {
    const key = JSON.stringify([
      query.listing,
      query.resolution,
      query.session,
      query.adjustment,
    ]);
    let entry = connection.subscriptions.get(key);
    if (!entry) {
      entry = {
        id: String(++sequence),
        key,
        query,
        ready: Deferred.makeUnsafe<void, OpenChartError>(),
        consumers: new Set(),
      };
      connection.subscriptions.set(key, entry);
      sendSubscribe(connection, entry);
    }
    entry.consumers.add(queue);
    if (entry.latest) Queue.offerUnsafe(queue, entry.latest);
    return entry;
  };
  return Effect.fn("OpenChart.live.subscribe")(function* (
    query: BarsSubscription,
    retired?: Deferred.Deferred<void>,
  ) {
    const queue = yield* Queue.make<LiveEvent, OpenChartError | Cause.Done>({
      capacity: 256,
    });
    yield* Effect.addFinalizer(() => Queue.shutdown(queue));
    const connection = yield* SynchronizedRef.modifyEffect(
      current,
      (previous) =>
        Effect.map(connect(previous), (next) => [next, next] as const),
    );
    const entry = yield* Effect.acquireRelease(
      Effect.sync(() => join(connection, query, queue)),
      (entry) => Effect.sync(() => leave(connection, entry, queue)),
    );
    // Series acknowledge independently; a delayed one blocks only its own consumers.
    yield* Deferred.await(entry.ready);
    if (retired)
      yield* Deferred.await(retired).pipe(
        Effect.andThen(
          Effect.sync(() => {
            leave(connection, entry, queue);
            Queue.endUnsafe(queue);
          }),
        ),
        Effect.forkScoped,
      );
    // Values buffered before an account change must not reach the next account.
    return Stream.fromQueue(queue).pipe(
      Stream.mapEffect((value) =>
        connection.owner.aborted
          ? Effect.fail(accountChanged())
          : Effect.succeed(value),
      ),
    );
  });
});
