// Purpose: Mount Hose on Node HTTP and own WebSocket adaptation and connection cleanup.

import type { IncomingMessage, Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { HoseConnection } from "./connection";
import type { HoseRouter } from "./router";

/**
 * Largest inbound WebSocket message. `ws` enforces it while reading the frame
 * header and closes the offending socket with 1009 before buffering the body.
 */
const MAX_INBOUND_BYTES = 1024 * 1024;

/** A Node mount with application-owned routes and per-connection context. */
export interface HoseServerOptions<C> {
  /** Caller-owned HTTP server; Hose never listens on or closes its HTTP port. */
  readonly server: Server;
  /** WebSocket upgrade path, for example `/hose`. */
  readonly path: string;
  /** Shared route definitions; each connection receives this same router. */
  readonly router: HoseRouter<C>;
  /**
   * Creates context synchronously once per accepted connection. Failures close
   * that socket with 1011 without exposing the thrown error.
   * @example createContext: request => ({authorization: request.headers.authorization})
   */
  readonly createContext: (request: IncomingMessage) => C;
  /**
   * Accepts or rejects one upgrade request before any socket exists. `false`
   * answers 401 and never reaches {@link HoseServerOptions.createContext}.
   * Absent accepts every upgrade; the host owns the policy, Hose only applies it.
   * @example authorize: request => request.headers.authorization === expected
   */
  readonly authorize?: (request: IncomingMessage) => boolean;
}

/**
 * Attaches Hose to a caller-owned Node HTTP server.
 * The application supplies routes and context; this adapter owns all `ws`
 * listeners, protocol connections, and socket cleanup. Dispose before closing
 * HTTP so upgraded sockets cannot keep HTTP shutdown waiting. An inbound message
 * larger than 1 MiB closes its socket with 1009 and releases its channels.
 *
 * @example
 * const hose = new HoseServer({server, path: '/hose', router, createContext: () => ({runtime})});
 * // During shutdown, before server.close():
 * hose.dispose();
 */
export class HoseServer<C> {
  private readonly sockets: WebSocketServer;
  private readonly connections = new Map<WebSocket, HoseConnection<C>>();
  private closed = false;

  /**
   * Mounts the upgrade endpoint without starting the supplied HTTP server.
   * @example
   * const hose = new HoseServer({server, path: '/hose', router, createContext: () => ({runtime})});
   */
  constructor(private readonly options: HoseServerOptions<C>) {
    const { authorize } = options;
    this.sockets = new WebSocketServer({
      server: options.server,
      path: options.path,
      maxPayload: MAX_INBOUND_BYTES,
      verifyClient:
        authorize && (({ req }: { req: IncomingMessage }) => authorize(req)),
    });
    this.sockets.on("connection", (socket, request) =>
      this.connect(socket, request),
    );
    options.server.once("close", this.dispose);
  }

  /**
   * Detaches the mount and ends all channels and sockets, leaving HTTP caller-owned.
   * Idempotent. Every connection is released even if a teardown throws; the first
   * failure propagates after cleanup. It is safe to dispose before HTTP listens.
   * @example
   * hose.dispose();
   * server.close();
   */
  readonly dispose = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.options.server.off("close", this.dispose);
    this.sockets.close();
    const failures: unknown[] = [];
    for (const [socket, connection] of this.connections) {
      this.connections.delete(socket);
      try {
        connection.dispose();
      } catch (error) {
        failures.push(error);
      } finally {
        socket.terminate();
      }
    }
    // Context creation can reject a socket before it has a protocol connection.
    for (const socket of this.sockets.clients) socket.terminate();
    if (failures.length > 0) throw failures[0];
  };

  /** Creates one protocol connection and wires the concrete socket exactly once. */
  private connect(socket: WebSocket, request: IncomingMessage): void {
    // `ws` answers an oversize message with a 1009 close frame and destroys the
    // socket itself if the peer never finishes closing; terminating drops that frame.
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH")
        socket.terminate();
    });
    if (this.closed) {
      socket.terminate();
      return;
    }
    let context: C;
    try {
      context = this.options.createContext(request);
    } catch {
      socket.close(1011, "context_failed");
      return;
    }
    const connection = new HoseConnection(
      {
        send: (message) => {
          if (socket.readyState !== WebSocket.OPEN) return false;
          socket.send(message, (error) => {
            if (error) socket.terminate();
            else connection.drain();
          });
          return true;
        },
        get bufferedAmount() {
          return socket.bufferedAmount;
        },
        close: (code, reason) => socket.close(code, reason),
      },
      this.options.router,
      context,
    );
    this.connections.set(socket, connection);
    socket.on("message", (message, binary) => {
      if (binary) {
        try {
          connection.dispose();
        } finally {
          socket.close(1002, "protocol_error");
        }
        return;
      }
      connection.receive(message.toString());
    });
    socket.once("close", () => {
      this.connections.delete(socket);
      connection.dispose();
    });
  }
}
