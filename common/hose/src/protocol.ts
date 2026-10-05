// Purpose: Canonical payload-agnostic Hose wire messages.

import { z } from "zod";

/** Requires every logical channel to have a non-empty identifier. */
const id = z.string().min(1);

/**
 * Starts one logical channel on an existing WebSocket connection.
 *
 * A logical channel is one independent flow identified by `id`. Its `body`
 * stays unknown at the wire boundary. HoseRouter parses `body.type` to select
 * a handler; that handler owns the rest of the request schema. An invalid
 * routing field fails its channel without becoming a connection protocol error.
 */
export const OpenMsg = z
  .object({ type: z.literal("open"), id, body: z.unknown().nonoptional() })
  .strict();

/**
 * Carries one application-owned value on a logical channel, in either
 * direction: servers answer with it and clients send it on an open channel.
 *
 * Hose leaves `body` unknown so the receiving application can parse it with
 * the schema that owns that channel.
 */
export const DataMsg = z
  .object({ type: z.literal("data"), id, body: z.unknown().nonoptional() })
  .strict();

/** Stops the logical channel identified by `id`. */
export const CloseMsg = z.object({ type: z.literal("close"), id }).strict();

/**
 * Accepts every message a client may send to a Hose server.
 *
 * The schema is strict, so unexpected fields are rejected.
 */
export const ClientMsg = z.discriminatedUnion("type", [
  OpenMsg,
  DataMsg,
  CloseMsg,
]);

/** Hose's own channel failures; they carry nothing for an owner to decode. */
export const ChannelErrorCode = z.enum([
  "invalid_request",
  "not_found",
  "internal",
]);

/** One Hose channel failure code. */
export type ChannelErrorCode = z.infer<typeof ChannelErrorCode>;

/**
 * Ends a logical channel with a failure. `failed` means the channel owner
 * failed and says why in `body`, which the owner's client decodes like a data
 * body; Hose never reads it. A {@link ChannelErrorCode} means Hose itself could
 * not run the channel and carries no body. There is no text field.
 */
export const ErrorMsg = z.discriminatedUnion("code", [
  z
    .object({
      type: z.literal("error"),
      id,
      code: z.literal("failed"),
      body: z.unknown().nonoptional(),
    })
    .strict(),
  z.object({ type: z.literal("error"), id, code: ChannelErrorCode }).strict(),
]);

/** Ends a logical channel normally. */
export const DoneMsg = z.object({ type: z.literal("done"), id }).strict();

/**
 * Accepts every message a Hose server may send to a client.
 *
 * `error` and `done` end their logical channel. The schema is strict, so
 * unexpected fields are rejected.
 */
export const ServerMsg = z.discriminatedUnion("type", [
  DataMsg,
  ErrorMsg,
  DoneMsg,
]);

/** A valid client message returned by {@link parseClient}. */
export type ClientMsg = z.infer<typeof ClientMsg>;

/** A valid server message returned by {@link parseServer}. */
export type ServerMsg = z.infer<typeof ServerMsg>;

/**
 * Converts a Hose message to JSON text without parsing it first.
 *
 * Normal `JSON.stringify()` rules apply to the body. Values such as `bigint`
 * and circular objects throw instead of producing a message.
 *
 * @param msg - A client or server message that already matches the protocol.
 * @returns The JSON text sent through the WebSocket.
 * @throws When `JSON.stringify()` cannot serialize the message.
 *
 * @example
 * ```ts
 * const text = encode({type: 'close', id: 'prices'});
 * ```
 */
export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

/**
 * Parses an unknown JSON value as a client message.
 *
 * @param input - The decoded JSON value received from a client.
 * @returns A checked `open`, `data`, or `close` message.
 * @throws A Zod error when the value does not match the client message schema.
 *
 * @example
 * ```ts
 * const msg = parseClient({type: 'close', id: 'prices'});
 * ```
 */
export function parseClient(input: unknown): ClientMsg {
  return ClientMsg.parse(input);
}

/**
 * Parses an unknown JSON value as a server message.
 *
 * @param input - The decoded JSON value received from a server.
 * @returns A checked `data`, `error`, or `done` message.
 * @throws A Zod error when the value does not match the server message schema.
 *
 * @example
 * ```ts
 * const msg = parseServer({type: 'done', id: 'prices'});
 * ```
 */
export function parseServer(input: unknown): ServerMsg {
  return ServerMsg.parse(input);
}
