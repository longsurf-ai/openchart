// Purpose: Fair byte-bounded outbound scheduling for one Hose WebSocket.

/**
 * Default size limit for one new message plus bytes already waiting in Hose.
 *
 * It does not count bytes already accepted by the WebSocket. A message over
 * the limit is rejected even when the Hose queue is empty. Exceeding the limit
 * closes the connection with status code 1013.
 */
export const QueueBytes = 16 * 1024 * 1024;

/** Milliseconds between fallback checks while a WebSocket remains busy. */
export const DrainDelay = 50;

/**
 * The WebSocket operations needed by Hose's server-side writer.
 *
 * A socket applies backpressure when it has accepted a message but still has
 * bytes waiting to be written. `bufferedAmount` exposes that condition so the
 * writer can pause instead of letting its own queue grow without bound.
 */
export interface Socket {
  // @agent invariant: true means accepted, including native backpressure;
  // false means dropped and must never be retried.
  /**
   * Accepts one text message for delivery.
   *
   * `true` means the message was accepted, even if the socket became busy.
   * `false` means the message was dropped and must not be retried.
   *
   * @example
   * ```ts
   * declare const socket: Socket;
   * const accepted = socket.send('hello');
   * ```
   */
  send(msg: string): boolean;

  /** Bytes accepted by the WebSocket but not yet written to the network. */
  readonly bufferedAmount: number;

  /**
   * Closes the underlying WebSocket connection.
   *
   * @example
   * ```ts
   * declare const socket: Socket;
   * socket.close(1000, 'complete');
   * ```
   */
  close(code?: number, reason?: string): void;
}

/** Reasons the server-side writer permanently stops its connection. */
export type WriteFailure = "send_failed" | "slow_client";

/** A first-in, first-out queue for one logical channel. */
type Lane = {
  readonly id: string;
  readonly msgs: string[];
};

/**
 * Takes turns sending messages from logical channels without unbounded memory
 * growth.
 *
 * A logical channel is one independent flow identified by `id`. The writer
 * sends at most one message from a channel before giving another ready channel
 * a turn. This is round-robin by message, not by byte size. When the WebSocket
 * is busy, the writer pauses and resumes from the following channel.
 *
 * @example
 * ```ts
 * declare const socket: Socket;
 * const writer = new HoseWriter(socket, failure => console.error(failure));
 * ```
 */
export class HoseWriter {
  private readonly lanes = new Map<string, Lane>();
  private order: string[] = [];
  private cursor = 0;
  private bytes = 0;
  private state: "open" | "blocked" | "closed" = "open";
  private flushing = false;
  private blocked?: string;
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * Creates a writer for one WebSocket.
   *
   * @param socket - Socket that accepts encoded Hose messages.
   * @param fail - Called once when socket delivery fails or the queue exceeds
   * its limit.
   * @param limit - Maximum queued bytes plus the size of the new message being
   * accepted.
   * @param delay - Fallback delay before checking a busy socket again.
   *
   * @example
   * ```ts
   * declare const socket: Socket;
   * const writer = new HoseWriter(socket, failure => console.error(failure));
   * ```
   */
  constructor(
    private readonly socket: Socket,
    private readonly fail: (failure: WriteFailure) => void,
    private readonly limit = QueueBytes,
    private readonly delay = DrainDelay,
  ) {}

  /**
   * Queues a text message for one logical channel and sends ready work.
   *
   * @returns `true` when the message was accepted by the writer or socket;
   * `false` when the writer is closed or the message was dropped.
   *
   * @example
   * ```ts
   * declare const writer: HoseWriter;
   * writer.send('prices', 'hello');
   * ```
   */
  send(id: string, msg: string): boolean {
    if (this.state === "closed") return false;
    const size = Buffer.byteLength(msg, "utf8");
    if (this.bytes + size > this.limit) {
      this.stop("slow_client");
      return false;
    }
    const lane = this.lanes.get(id) ?? { id, msgs: [] };
    if (!this.lanes.has(id)) {
      this.lanes.set(id, lane);
      this.order.push(id);
    }
    lane.msgs.push(msg);
    this.bytes += size;
    return this.flush();
  }

  /**
   * Drops every unsent message for one logical channel.
   *
   * @example
   * ```ts
   * declare const writer: HoseWriter;
   * writer.cancel('prices');
   * ```
   */
  cancel(id: string): void {
    const lane = this.lanes.get(id);
    if (!lane) return;
    for (const msg of lane.msgs) {
      this.bytes -= Buffer.byteLength(msg, "utf8");
    }
    this.remove(lane);
  }

  /**
   * Resumes fair delivery after the WebSocket has written its pending bytes.
   *
   * A socket adapter may call this as soon as it becomes writable. The writer
   * also checks again after its configured delay as a fallback.
   *
   * @example
   * ```ts
   * declare const writer: HoseWriter;
   * writer.drain();
   * ```
   */
  drain(): void {
    if (this.state !== "blocked") return;
    this.clear();
    if (this.socket.bufferedAmount > 0) {
      this.schedule();
      return;
    }
    if (this.blocked && this.order.length > 0) {
      const index = this.order.indexOf(this.blocked);
      this.cursor = index < 0 ? 0 : (index + 1) % this.order.length;
    }
    this.blocked = undefined;
    this.state = "open";
    this.flush();
  }

  /**
   * Stops this writer and drops all messages still waiting in Hose.
   *
   * This does not close the socket; the connection owner decides when to do
   * that.
   *
   * @example
   * ```ts
   * declare const writer: HoseWriter;
   * writer.dispose();
   * ```
   */
  dispose(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.clear();
    this.lanes.clear();
    this.order = [];
    this.cursor = 0;
    this.bytes = 0;
    this.blocked = undefined;
  }

  /** Reports one permanent failure, then closes the socket with code 1013. */
  private stop(failure: WriteFailure): void {
    if (this.state === "closed") return;
    this.dispose();
    try {
      this.fail(failure);
    } finally {
      this.socket.close(1013, failure);
    }
  }

  /** Removes an empty lane without skipping the next channel's turn. */
  private remove(lane: Lane): void {
    this.lanes.delete(lane.id);
    const index = this.order.indexOf(lane.id);
    if (index < 0) return;
    this.order.splice(index, 1);
    if (this.order.length === 0) {
      this.cursor = 0;
      return;
    }
    if (index < this.cursor) this.cursor -= 1;
    this.cursor %= this.order.length;
  }

  /** Cancels the fallback check for a busy socket. */
  private clear(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Schedules one fallback check while the WebSocket remains busy. */
  private schedule(): void {
    if (this.timer || this.state !== "blocked") return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.drain();
    }, this.delay);
    this.timer.unref?.();
  }

  /**
   * Sends one message per ready channel until the socket becomes busy.
   *
   * A message that the socket rejects is never retried because the adapter has
   * already reported it as dropped.
   */
  private flush(): boolean {
    if (this.flushing || this.state !== "open") {
      return this.state !== "closed";
    }
    this.flushing = true;
    try {
      while (this.state === "open" && this.order.length > 0) {
        if (this.socket.bufferedAmount > 0) {
          this.state = "blocked";
          this.schedule();
          return true;
        }
        const id = this.order[this.cursor % this.order.length];
        const lane = id ? this.lanes.get(id) : undefined;
        if (!lane) {
          if (id) this.order = this.order.filter((value) => value !== id);
          this.cursor = 0;
          continue;
        }
        const msg = lane.msgs.shift();
        if (!msg) {
          this.remove(lane);
          continue;
        }
        this.bytes -= Buffer.byteLength(msg, "utf8");
        let sent: boolean;
        try {
          sent = this.socket.send(msg);
        } catch {
          this.stop("send_failed");
          return false;
        }
        if (!sent) {
          this.stop("send_failed");
          return false;
        }
        const empty = lane.msgs.length === 0;
        if (empty) this.remove(lane);
        if (this.socket.bufferedAmount > 0) {
          this.blocked = lane.id;
          this.state = "blocked";
          this.schedule();
          return true;
        }
        if (!empty && this.order.length > 0) {
          this.cursor = (this.cursor + 1) % this.order.length;
        }
      }
    } finally {
      this.flushing = false;
    }
    return true;
  }
}
