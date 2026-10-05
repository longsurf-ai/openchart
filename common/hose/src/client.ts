// Purpose: Client-side persistent Hose connection and logical-channel dispatch.

import { encode, ServerMsg, type ChannelErrorCode } from "./protocol";
import { firstValueFrom, Observable, throwIfEmpty } from "rxjs";
import { webSocketLink } from "./websocket";

/**
 * Current state of the underlying WebSocket connection.
 *
 * `connecting` includes time spent waiting to retry. `connected` means the
 * socket is open. `idle` means the client is not trying to stay connected.
 */
export type HoseState = "idle" | "connecting" | "connected";

/**
 * The small part of a client WebSocket that {@link HoseClient} needs.
 *
 * Applications adapt their WebSocket implementation to this interface so the
 * Hose client does not depend on a browser or server runtime.
 */
export interface Link {
  /** State of the underlying WebSocket at the moment it is read. */
  readonly state: "connecting" | "open" | "closed";

  /**
   * Sends one text message.
   *
   * The adapter should throw when it can tell the message was not accepted.
   *
   * @example
   * ```ts
   * declare const link: Link;
   * link.send('{"type":"close","id":"prices"}');
   * ```
   */
  send(msg: string): void;

  /**
   * Closes the underlying WebSocket.
   *
   * @example
   * ```ts
   * declare const link: Link;
   * link.close();
   * ```
   */
  close(): void;

  /**
   * Registers socket callbacks and returns a function that removes them.
   *
   * @example
   * ```ts
   * declare const link: Link;
   * declare const events: LinkEvents;
   * const stop = link.listen(events);
   * stop();
   * ```
   */
  listen(events: LinkEvents): () => void;
}

/** Events emitted by one underlying {@link Link}. */
export interface LinkEvents {
  /**
   * Reports that the underlying WebSocket can send messages.
   *
   * @example
   * ```ts
   * declare const events: LinkEvents;
   * events.open();
   * ```
   */
  open(): void;

  /**
   * Delivers one raw server message; Hose accepts text messages only.
   *
   * @example
   * ```ts
   * declare const events: LinkEvents;
   * events.message('{"type":"done","id":"prices"}');
   * ```
   */
  message(data: unknown): void;

  /**
   * Reports that the underlying WebSocket closed.
   *
   * @example
   * ```ts
   * declare const events: LinkEvents;
   * events.close();
   * ```
   */
  close(): void;

  /**
   * Reports a socket failure that prevents normal use; every channel on the
   * socket ends with `socket_failed`.
   *
   * @example
   * ```ts
   * declare const events: LinkEvents;
   * events.error();
   * ```
   */
  error(): void;
}

/**
 * Callbacks for one logical channel opened by {@link HoseClient}.
 *
 * These callbacks must not throw. Hose calls them directly and does not turn a
 * callback exception into a {@link HoseError}.
 */
export interface ChannelEvents {
  /**
   * Receives one application-owned value without ending the channel.
   *
   * @example
   * ```ts
   * declare const events: ChannelEvents;
   * events.data({price: 123.4});
   * ```
   */
  data(body: unknown): void;

  /**
   * Receives the failure that ends the channel.
   *
   * @example
   * ```ts
   * declare const events: ChannelEvents;
   * events.error(new HoseError('not_found'));
   * ```
   */
  error(error: HoseError): void;

  /**
   * Receives normal channel completion.
   *
   * @example
   * ```ts
   * declare const events: ChannelEvents;
   * events.done();
   * ```
   */
  done(): void;
}

/**
 * The client's handle on one logical channel opened by
 * {@link HoseClient.openChannel}.
 *
 * Server values and the final outcome arrive through {@link ChannelEvents}; this
 * handle carries the other direction and local cancellation.
 */
export interface ClientChannel {
  /**
   * Sends one application-owned value to the channel's server handler.
   *
   * A value sent before the socket has delivered this channel's `open` message
   * is queued behind it, in order. Hose never replays sent values: a socket
   * drop ends the channel with an error and its owner starts a new session.
   *
   * @throws If `body` is `undefined` or not serializable by `JSON.stringify()`,
   * or the channel has ended: server done or error, {@link ClientChannel.close},
   * a socket drop, or disconnect.
   *
   * @example
   * ```ts
   * declare const channel: ClientChannel;
   * channel.send({jsonrpc: '2.0', id: 1, method: 'initialize'});
   * ```
   */
  send(body: unknown): void;

  /**
   * Cancels the channel locally and asks the server to stop it if its `open`
   * message was sent. Calls no channel callback, drops values still queued
   * behind an unsent `open`, and does nothing once the channel has ended.
   *
   * @example
   * ```ts
   * declare const channel: ClientChannel;
   * channel.close();
   * ```
   */
  close(): void;
}

/**
 * Every code a channel failure can carry, by layer:
 * - `failed`: the owner failed; decode `body` with the owner's schema.
 * - {@link ChannelErrorCode}: Hose could not run the channel.
 * - `empty_response`: `request()` saw the channel end without data.
 * - `socket_failed`, `socket_closed`, `protocol_error`, `disconnected`: the
 *   connection ended, and with it every channel.
 */
export type HoseErrorCode =
  | "failed"
  | ChannelErrorCode
  | "empty_response"
  | "socket_failed"
  | "socket_closed"
  | "protocol_error"
  | "disconnected";

/**
 * A Hose channel failure. `body` is present only for `failed` and only the
 * channel owner decodes it; `message` is `Hose <code>`, for logs only.
 *
 * @example
 * ```ts
 * const error = new HoseError('protocol_error');
 * ```
 */
export class HoseError extends Error {
  /** Which layer failed and how; see {@link HoseErrorCode}. */
  readonly code: HoseErrorCode;
  /** The owner's opaque failure; present only when `code` is `failed`. */
  readonly body?: unknown;

  /**
   * Creates a Hose failure; only `failed` takes the owner's body.
   *
   * @example
   * ```ts
   * const failed = new HoseError('failed', {reason: 'unavailable'});
   * const lost = new HoseError('socket_closed');
   * ```
   */
  constructor(code: "failed", body: unknown);
  constructor(code: Exclude<HoseErrorCode, "failed">);
  constructor(code: HoseErrorCode, body?: unknown) {
    super(`Hose ${code}`);
    this.name = "HoseError";
    this.code = code;
    if (code === "failed") this.body = body;
  }
}

/** An open request kept only until its logical channel ends. */
type Pending = {
  readonly id: string;
  readonly events: ChannelEvents;
  /**
   * Encoded messages not yet handed to the socket, the open message first. It
   * is empty exactly when the server has been told about this channel.
   */
  readonly queued: string[];
};

/** Encodes one client message now, so a bad body throws to its sender. */
function encodeBody(type: "open" | "data", id: string, body: unknown): string {
  // @agent invariant: JSON.stringify removes an undefined body, so reject it
  // before it can become an invalid message on the wire.
  if (body === undefined) {
    throw new Error(`Hose channel ${type} requires a body`);
  }
  return encode({ type, id, body });
}

/**
 * Shares one persistent WebSocket across independent logical channels.
 *
 * A logical channel is one flow identified by its own id. If the underlying
 * socket fails, existing channels are removed and their error callbacks run in
 * insertion order. Channel callbacks must not throw. The client may reconnect
 * the socket, but it never replays old channels.
 *
 * @example
 * ```ts
 * declare const client: HoseClient;
 *
 * const channel = client.openChannel(
 *   {type: 'prices'},
 *   {
 *     data: value => console.log(value),
 *     error: error => console.error(error),
 *     done: () => console.log('done'),
 *   },
 * );
 * channel.close();
 * client.disconnect();
 * ```
 */
export class HoseClient {
  private socket?: Link;
  private unlisten?: () => void;
  private channels = new Map<string, Pending>();
  private listeners = new Set<(state: HoseState) => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private desired = false;
  private attempt = 0;
  private next = 0;
  private current: HoseState = "idle";

  /**
   * Creates a client without opening its underlying WebSocket.
   *
   * @param create - A WebSocket URL, or a factory for an authenticated/custom Link.
   * @param retry - Converts a zero-based failure count to a delay in
   * milliseconds.
   *
   * @example
   * ```ts
   * declare const createLink: () => Link;
   * const client = new HoseClient(createLink);
   * ```
   */
  constructor(
    private readonly create: string | (() => Link),
    private readonly retry: (attempt: number) => number = (attempt) =>
      Math.min(100 * 2 ** attempt, 5_000),
  ) {}

  /**
   * Requests a connection and does nothing if one is active or scheduled.
   *
   * @example
   * ```ts
   * declare const client: HoseClient;
   * client.connect();
   * ```
   */
  connect(): void {
    this.desired = true;
    this.open();
  }

  /**
   * Stops reconnecting, closes the WebSocket, and fails every channel.
   *
   * Existing channels receive a `disconnected` {@link HoseError}.
   *
   * @example
   * ```ts
   * declare const client: HoseClient;
   * client.disconnect();
   * ```
   */
  disconnect(): void {
    this.desired = false;
    this.clear();
    this.end(new HoseError("disconnected"));
    this.unlisten?.();
    this.unlisten = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.setState("idle");
  }

  /**
   * Opens one logical channel now or when the WebSocket becomes ready.
   *
   * The server routes by the non-empty string `body.type`; all other fields
   * belong to that handler. The client forwards `body` without inspecting it.
   * The returned {@link ClientChannel} sends values to the server handler and
   * closes the channel; a receive-only caller uses only `close`. The caller owns
   * closing it. A socket drop ends it with an error; Hose never reopens it or
   * replays sent values.
   *
   * @throws When `body` is undefined or `JSON.stringify()` cannot encode it. No
   *   channel is created and no other channel is affected.
   *
   * @example
   * ```ts
   * declare const client: HoseClient;
   * declare const events: ChannelEvents;
   * const channel = client.openChannel({type: 'tea.lsp'}, events);
   * channel.send({jsonrpc: '2.0', id: 1, method: 'initialize'});
   * channel.close();
   * ```
   */
  openChannel(body: unknown, events: ChannelEvents): ClientChannel {
    const id = `hose-${this.next + 1}`;
    const channel: Pending = {
      id,
      events,
      queued: [encodeBody("open", id, body)],
    };
    this.next += 1;
    this.channels.set(channel.id, channel);
    this.connect();
    this.flush(channel);
    return {
      send: (data) => this.sendData(channel, data),
      close: () => this.closeChannel(channel.id),
    };
  }

  /** Subscribe to one channel; abort fails, server done completes, unsubscribe cancels only it.
   * Every subscriber opens a separate channel; the socket is shared and payloads stay unknown.
   * @example hose.observe({type: 'prices'}, {signal}).subscribe({next: console.log});
   */
  observe(
    body: unknown,
    options: { readonly signal?: AbortSignal } = {},
  ): Observable<unknown> {
    const { signal } = options;
    return new Observable((observer) => {
      if (signal) {
        const abort = () => observer.error(signal.reason);
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        observer.add(() => signal.removeEventListener("abort", abort));
      }
      // add() also runs teardown when a synchronous response already closed the observer.
      observer.add(
        this.openChannel(body, {
          data: (value) => observer.next(value),
          error: (error) => observer.error(error),
          done: () => observer.complete(),
        }).close,
      );
    });
  }

  /** Receive the first value and close that channel; completion without a value fails.
   * @example const result = await hose.request({type: 'search', query: 'BTC'}, {signal});
   */
  request(
    body: unknown,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<unknown> {
    return firstValueFrom(
      this.observe(body, options).pipe(
        throwIfEmpty(() => new HoseError("empty_response")),
      ),
    );
  }

  /**
   * Observes the underlying WebSocket state.
   *
   * The listener receives the current state immediately. The returned
   * function stops later notifications. Listeners must not throw.
   *
   * @example
   * ```ts
   * declare const client: HoseClient;
   * const stop = client.onState(state => console.log(state));
   * stop();
   * ```
   */
  onState(listener: (state: HoseState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /**
   * Starts one WebSocket connection attempt and installs all callbacks.
   *
   * Synchronous failures from link creation or listener setup enter the same
   * retry path as later socket failures.
   */
  private open(): void {
    if (!this.desired || this.socket || this.timer) return;
    this.setState("connecting");
    let socket: Link;
    try {
      socket =
        typeof this.create === "string"
          ? webSocketLink(this.create)
          : this.create();
    } catch {
      this.retryLater(new HoseError("socket_failed"));
      return;
    }
    this.socket = socket;
    try {
      this.unlisten = socket.listen({
        open: () => {
          if (this.socket !== socket) return;
          this.attempt = 0;
          this.setState("connected");
          for (const channel of this.channels.values()) this.flush(channel);
        },
        message: (data) => this.receive(socket, data),
        close: () => this.failed(socket, new HoseError("socket_closed")),
        error: () => this.failed(socket, new HoseError("socket_failed")),
      });
    } catch {
      this.socket = undefined;
      socket.close();
      this.retryLater(new HoseError("socket_failed"));
      return;
    }
    if (socket.state === "open") {
      this.attempt = 0;
      this.setState("connected");
      for (const channel of this.channels.values()) this.flush(channel);
    }
  }

  /**
   * Parses one server message and sends it to the matching logical channel.
   *
   * Invalid text fails the WebSocket connection. Messages for a channel that
   * has already ended are ignored because they can be late in flight.
   */
  private receive(socket: Link, raw: unknown): void {
    if (this.socket !== socket || typeof raw !== "string") {
      this.failed(socket, new HoseError("protocol_error"));
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(raw) as unknown;
    } catch {
      this.failed(socket, new HoseError("protocol_error"));
      return;
    }
    const parsed = ServerMsg.safeParse(input);
    if (!parsed.success) {
      this.failed(socket, new HoseError("protocol_error"));
      return;
    }
    const msg = parsed.data;
    const channel = this.channels.get(msg.id);
    if (!channel) return;
    if (msg.type === "data") {
      channel.events.data(msg.body);
      return;
    }
    this.channels.delete(msg.id);
    if (msg.type === "error") {
      channel.events.error(
        msg.code === "failed"
          ? new HoseError("failed", msg.body)
          : new HoseError(msg.code),
      );
      return;
    }
    channel.events.done();
  }

  /**
   * Hands a channel's queued messages to an open socket, in order. The queue
   * is emptied first, so a Link that sends again from inside `send` cannot
   * make a message go out twice. A failed send follows the socket failure
   * path, which ends every channel.
   */
  private flush(channel: Pending): void {
    const socket = this.socket;
    if (socket?.state !== "open") return;
    try {
      for (const msg of channel.queued.splice(0)) socket.send(msg);
    } catch {
      this.failed(socket, new HoseError("socket_failed"));
    }
  }

  /** Encodes one client value now, so a bad body throws to its sender. */
  private sendData(channel: Pending, body: unknown): void {
    if (!this.channels.has(channel.id)) {
      throw new Error(`Hose channel "${channel.id}" is closed`);
    }
    channel.queued.push(encodeBody("data", channel.id, body));
    this.flush(channel);
  }

  /**
   * Removes one channel locally, then asks the server to stop it when needed.
   *
   * If the close message cannot be sent, the WebSocket follows its
   * normal failure path so the remaining channels cannot appear healthy.
   */
  private closeChannel(id: string): void {
    const channel = this.channels.get(id);
    if (!channel) return;
    this.channels.delete(id);
    if (channel.queued.length === 0 && this.socket?.state === "open") {
      const socket = this.socket;
      try {
        socket.send(encode({ type: "close", id }));
      } catch {
        this.failed(socket, new HoseError("socket_failed"));
      }
    }
  }

  /** Ignores stale sockets; otherwise closes this one and starts retry logic. */
  private failed(socket: Link, error: HoseError): void {
    if (this.socket !== socket) return;
    this.unlisten?.();
    this.unlisten = undefined;
    this.socket = undefined;
    socket.close();
    this.retryLater(error);
  }

  /**
   * Fails current channels and schedules a fresh WebSocket connection.
   *
   * No retry is scheduled after {@link HoseClient.disconnect} or while an
   * existing retry timer is active.
   */
  private retryLater(error: HoseError): void {
    this.end(error);
    this.setState(this.desired ? "connecting" : "idle");
    if (!this.desired || this.timer) return;
    const delay = this.retry(this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.open();
    }, delay);
    this.timer.unref?.();
  }

  /**
   * Removes all current channels and reports the same final error to each.
   *
   * Channel error callbacks run in insertion order and must not throw.
   */
  private end(error: HoseError): void {
    const channels = [...this.channels.values()];
    this.channels.clear();
    for (const channel of channels) channel.events.error(error);
  }

  /** Stores a changed connection state and notifies every state listener. */
  private setState(state: HoseState): void {
    if (this.current === state) return;
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }

  /** Cancels the pending reconnect timer, if one exists. */
  private clear(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
