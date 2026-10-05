// Purpose: Server-side Hose channel lifecycle over one caller-owned WebSocket.

import {
  ClientMsg,
  encode,
  type ChannelErrorCode,
  type ServerMsg,
} from "./protocol";
import type { HoseRouter } from "./router";
import { HoseWriter, type Socket, type WriteFailure } from "./writer";

/**
 * Sends values and a final outcome on one logical channel.
 *
 * A logical channel is one independent flow inside the shared WebSocket. It
 * stays open for any number of {@link Channel.data} calls and ends with either
 * {@link Channel.error} or {@link Channel.done}. After it ends, calling any of
 * those three throws. Data values must be serializable by `JSON.stringify()`.
 * A duplex handler also receives client values through {@link Channel.onData}.
 */
export interface Channel {
  /** Identifier chosen by the client when it opened this channel. */
  readonly id: string;

  /**
   * Queues one application-owned value without ending the channel.
   *
   * @throws If `body` is `undefined` or the channel has already ended.
   *
   * @example
   * ```ts
   * declare const channel: Channel;
   * channel.data({price: 123.4});
   * ```
   */
  data(body: unknown): void;

  /**
   * Queues a failure and ends the channel; later calls throw. `failed` carries
   * the owner's opaque `body`, which its client decodes like a data body; a
   * {@link ChannelErrorCode} reports a Hose-level failure and carries no body.
   *
   * @throws If a `failed` body is `undefined` or the channel has already ended.
   *
   * @example
   * ```ts
   * declare const channel: Channel;
   * channel.error('failed', encodedFailure);
   * channel.error('internal');
   * ```
   */
  error(code: "failed", body: unknown): void;
  error(code: ChannelErrorCode): void;

  /**
   * Queues normal completion and ends the channel. Later calls throw.
   *
   * @example
   * ```ts
   * declare const channel: Channel;
   * channel.done();
   * ```
   */
  done(): void;

  /**
   * Receives the values a client sends on this channel after opening it.
   *
   * The channel holds one listener; a later call replaces it. Register it
   * synchronously while the handler opens the channel: Hose keeps no inbound
   * queue, so a value that arrives without a listener is dropped. The listener
   * runs synchronously in arrival order, never after the channel ended, and
   * owns parsing `body`. If it throws while the channel is open, only this
   * channel fails, with `internal`, and the exception is not exposed.
   *
   * @example
   * ```ts
   * declare const channel: Channel;
   * channel.onData(body => channel.data(body));
   * ```
   */
  onData(listener: (body: unknown) => void): void;
}

/** State needed to finish one channel and release its application work. */
type Active = {
  readonly channel: Channel;
  listener?: (body: unknown) => void;
  teardown?: () => void;
  closed: boolean;
};

/**
 * Runs many logical channels over one caller-owned WebSocket.
 *
 * The caller forwards incoming text to {@link HoseConnection.receive}, notifies
 * {@link HoseConnection.drain} when pending socket bytes have been written, and
 * calls {@link HoseConnection.dispose} when the connection closes.
 *
 * @example
 * ```ts
 * declare const socket: Socket;
 * declare const router: HoseRouter;
 * const connection = new HoseConnection(socket, router, undefined);
 * ```
 */
export class HoseConnection<C = void> {
  private readonly channels = new Map<string, Active>();
  private readonly writer: HoseWriter;
  private closed = false;

  /**
   * Creates the channel manager for one underlying WebSocket.
   *
   * @param socket - Socket used for all channel responses.
   * @param router - Shared route definitions; never copied into the connection.
   * @param context - Values supplied by the owning server for this connection.
   * @param fail - Optional notice that delivery stopped permanently.
   *
   * @example
   * ```ts
   * declare const socket: Socket;
   * declare const router: HoseRouter;
   * const connection = new HoseConnection(socket, router, undefined);
   * ```
   */
  constructor(
    private readonly socket: Socket,
    private readonly router: HoseRouter<C>,
    private readonly context: C,
    fail: (failure: WriteFailure) => void = () => {},
  ) {
    this.writer = new HoseWriter(socket, (failure) => {
      try {
        fail(failure);
      } finally {
        this.dispose();
      }
    });
  }

  /**
   * Parses and handles one client text message.
   *
   * An invalid message or a repeated live channel id closes the whole socket
   * with status code 1002. An invalid or unknown `open.body.type` fails only
   * that channel with `invalid_request` or `not_found`. If its handler throws
   * before ending its channel, the channel receives `internal`. Teardown errors propagate
   * after the channel has been removed. An error thrown after the handler has
   * already ended its channel also propagates unchanged.
   *
   * A `data` message runs its channel's {@link Channel.onData} listener under
   * the same exception rule, also with `internal`. Data for a channel without a
   * listener is dropped. Data for an unknown or finished id is ignored: the
   * channel may have just ended while the client's message was in flight.
   *
   * @example
   * ```ts
   * declare const server: HoseConnection;
   * server.receive('{"type":"close","id":"prices"}');
   * ```
   */
  receive(raw: string): void {
    if (this.closed) return;
    let input: unknown;
    try {
      input = JSON.parse(raw) as unknown;
    } catch {
      this.invalid();
      return;
    }
    const parsed = ClientMsg.safeParse(input);
    if (!parsed.success) {
      this.invalid();
      return;
    }
    const msg = parsed.data;
    if (msg.type === "close") {
      this.finish(msg.id);
      return;
    }
    if (msg.type === "data") {
      const active = this.channels.get(msg.id);
      if (!active?.listener) return;
      try {
        active.listener(msg.body);
      } catch (error) {
        if (active.closed) throw error;
        // The client sees only `internal`; the cause stays in the server log.
        console.error("Hose channel data handler failed", error);
        active.channel.error("internal");
      }
      return;
    }
    if (this.channels.has(msg.id)) {
      this.invalid();
      return;
    }

    const active = this.create(msg.id);
    this.channels.set(msg.id, active);
    try {
      const teardown = this.router.handle(
        msg.body,
        active.channel,
        this.context,
      );
      if (active.closed) teardown?.();
      else if (teardown) active.teardown = teardown;
    } catch (error) {
      if (active.closed) throw error;
      console.error("Hose channel open failed", error);
      active.channel.error("internal");
    }
  }

  /**
   * Resumes queued writes after the WebSocket becomes writable.
   *
   * @example
   * ```ts
   * declare const server: HoseConnection;
   * server.drain();
   * ```
   */
  drain(): void {
    this.writer.drain();
  }

  /**
   * Ends every channel and releases all queued work for this connection.
   *
   * Every channel is given a chance to run its teardown. If teardowns fail,
   * cleanup continues and the first failure is thrown afterward. This method
   * does not close the caller-owned WebSocket.
   *
   * @example
   * ```ts
   * declare const server: HoseConnection;
   * server.dispose();
   * ```
   */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const failures: unknown[] = [];
    for (const id of [...this.channels.keys()]) {
      try {
        this.finish(id);
      } catch (error) {
        failures.push(error);
      }
    }
    this.writer.dispose();
    if (failures.length > 0) throw failures[0];
  }

  /**
   * Builds callbacks whose `error()` and `done()` close their own channel.
   *
   * The separate `active` object lets `error()` or `done()` run safely while
   * the application handler is still opening the channel.
   */
  private create(id: string): Active {
    const active: Active = {
      closed: false,
      channel: {
        id,
        data: (body) => {
          // @agent invariant: JSON.stringify removes an undefined body, so
          // reject it before it can become an invalid DataMsg on the wire.
          if (body === undefined) {
            throw new Error("Hose channel data requires a body");
          }
          this.write(active, { type: "data", id, body });
        },
        error: (code: "failed" | ChannelErrorCode, body?: unknown) => {
          if (code === "failed" && body === undefined) {
            throw new Error("Hose channel failures require a body");
          }
          const msg: ServerMsg =
            code === "failed"
              ? { type: "error", id, code, body }
              : { type: "error", id, code };
          if (!this.write(active, msg)) return;
          this.finish(id, false);
        },
        done: () => {
          if (!this.write(active, { type: "done", id })) return;
          this.finish(id, false);
        },
        onData: (listener) => {
          active.listener = listener;
        },
      },
    };
    return active;
  }

  /** Refuses writes after completion and otherwise queues the encoded message. */
  private write(active: Active, msg: ServerMsg): boolean {
    if (active.closed) throw new Error(`Hose channel "${msg.id}" is closed`);
    return this.writer.send(msg.id, encode(msg));
  }

  /**
   * Marks a channel closed before running its teardown.
   *
   * `cancel` is false after an error or done message was queued, so every message
   * through that final message remains deliverable. A client-requested close
   * uses the default `true` and drops that channel's unsent messages.
   */
  private finish(id: string, cancel = true): void {
    const active = this.channels.get(id);
    if (!active || active.closed) return;
    active.closed = true;
    this.channels.delete(id);
    if (cancel) this.writer.cancel(id);
    active.teardown?.();
  }

  /** Releases every channel, then closes the socket as a protocol error. */
  private invalid(): void {
    try {
      this.dispose();
    } finally {
      this.socket.close(1002, "protocol_error");
    }
  }
}
