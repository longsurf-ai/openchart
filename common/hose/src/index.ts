// Purpose: Public surface of @openchart/hose.

/**
 * A WebSocket transport that carries many independent data flows over one
 * connection.
 *
 * Each flow is a logical channel identified by a string. Hose opens, closes,
 * and schedules those channels. Opening requests select a registered handler
 * by `body.type`; the rest of each body remains application-owned. The server
 * takes turns sending one message from each ready
 * channel. A channel is duplex: after opening it, the client may send values
 * that the handler receives through `Channel.onData`. Existing channels end
 * when the socket disconnects; reconnecting does not replay them.
 *
 * @packageDocumentation
 */

export { HoseClient, HoseError } from "./client";
export type {
  ChannelEvents,
  ClientChannel,
  HoseErrorCode,
  HoseState,
  Link,
  LinkEvents,
} from "./client";
export { ChannelErrorCode } from "./protocol";
export { HoseConnection } from "./connection";
export type { Channel } from "./connection";
export { HoseRouter } from "./router";
export type { ChannelHandler } from "./router";
export { QueueBytes } from "./writer";
export type { Socket, WriteFailure } from "./writer";
