// Purpose: Carry standard JSON-RPC messages over a Hose channel without stream framing.
import {
  Emitter,
  Event,
  type DataCallback,
  type Message,
  type MessageReader,
  type MessageWriter,
} from "vscode-jsonrpc";
import { z } from "zod";

const MessageEnvelope = z.object({ jsonrpc: z.literal("2.0") }).passthrough();

/**
 * Adapts decoded Hose bodies to the standard JSON-RPC reader/writer interfaces.
 * The caller owns its channel; disposing this adapter only releases listeners.
 * JSON-RPC owns request IDs, cancellation and protocol dispatch.
 *
 * @example
 * const transport = new JsonRpcTransport(body => channel.data(body));
 * channel.onData(body => transport.receive(body));
 * // Pass transport.reader and transport.writer to the protocol library.
 */
export class JsonRpcTransport {
  private readonly errors = new Emitter<Error>();
  private readonly writeErrors = new Emitter<
    [Error, Message | undefined, number | undefined]
  >();
  private readonly closed = new Emitter<void>();
  private callback?: DataCallback;
  private ended = false;
  /** Supplies whole decoded messages to a standard JSON-RPC connection. */
  readonly reader: MessageReader;
  /** Sends one JSON-RPC object per Hose data body, without Content-Length framing. */
  readonly writer: MessageWriter;

  /** Creates transport adapters; `send` must deliver messages in call order. @example new JsonRpcTransport(body => channel.send(body)); */
  constructor(send: (message: Message) => void) {
    this.reader = {
      onError: this.errors.event,
      onClose: this.closed.event,
      onPartialMessage: Event.None,
      listen: (callback) => {
        this.callback = callback;
        return {
          dispose: () => {
            this.callback = undefined;
          },
        };
      },
      dispose: () => {
        this.callback = undefined;
      },
    };
    this.writer = {
      onError: this.writeErrors.event,
      onClose: this.closed.event,
      write: async (message) => {
        try {
          if (this.ended) throw new Error("JSON-RPC channel is closed");
          send(message);
        } catch (cause) {
          const error =
            cause instanceof Error ? cause : new Error(String(cause));
          this.writeErrors.fire([error, message, undefined]);
          throw error;
        }
      },
      // Like JSON-RPC's BrowserMessageWriter, ending writes does not announce
      // an inbound disconnect. The caller closes its Hose channel after the
      // protocol's graceful shutdown and connection disposal finish.
      end: () => {},
      dispose: () => {},
    };
  }

  /** Parses a Hose body once before JSON-RPC dispatch. Invalid envelopes throw to the channel owner. @example transport.receive(body); */
  receive(body: unknown): void {
    if (!this.ended) this.callback?.(MessageEnvelope.parse(body));
  }

  /** Notifies JSON-RPC that this channel ended; pending requests fail. Does not disconnect Hose. @example transport.close(error); */
  close(error?: Error): void {
    if (this.ended) return;
    this.ended = true;
    if (error) this.errors.fire(error);
    this.closed.fire();
  }

  /** Releases callbacks after the protocol connection has been disposed. Idempotent. @example transport.dispose(); */
  dispose(): void {
    this.ended = true;
    this.callback = undefined;
    this.errors.dispose();
    this.writeErrors.dispose();
    this.closed.dispose();
  }
}
