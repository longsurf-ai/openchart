// Purpose: Define reusable channel routes and dispatch with connection-local context.

import { z } from "zod";
import type { Channel } from "./connection";

/**
 * Opens a channel using the original request and the server-provided context.
 * The returned teardown belongs to HoseConnection and runs once when the
 * channel ends, including synchronous completion before the handler returns.
 *
 * @example
 * const echo: ChannelHandler<{prefix: string}> = (body, channel, ctx) => {
 *   channel.data({prefix: ctx.prefix, request: body});
 *   channel.done();
 * };
 */
export type ChannelHandler<C = void> = (
  body: unknown,
  channel: Channel,
  context: C,
) => void | (() => void);

const Operation = z.object({ type: z.string().min(1) });

/**
 * Application-created route definitions reusable across server instances.
 * Routes own no runtime or connection state; handlers receive context at dispatch.
 * `open.body.type` selects a handler, while outer `message.type` selects a wire
 * operation. All other request fields and response values stay application-owned.
 *
 * @example
 * const router = new HoseRouter<{prefix: string}>();
 * router.route('echo', (body, channel, ctx) => {
 *   channel.data({prefix: ctx.prefix, request: body});
 *   channel.done();
 * });
 */
export class HoseRouter<C = void> {
  private readonly routes = new Map<string, ChannelHandler<C>>();

  /**
   * Composes existing routers without modifying them. Later additions to a
   * source router do not change this router. Duplicate types throw immediately.
   * @example
   * declare const bars: HoseRouter;
   * declare const news: HoseRouter;
   * const router = new HoseRouter(bars, news);
   */
  constructor(...routers: readonly HoseRouter<C>[]) {
    for (const router of routers) {
      for (const [type, handler] of router.routes) this.route(type, handler);
    }
  }

  /**
   * Registers an exact, non-empty `open.body.type` and returns this router.
   * Register before mounting a server. Existing handlers cannot be replaced.
   * @throws If the type is empty or already registered.
   * @example
   * const router = new HoseRouter();
   * router.route('echo', (body, channel) => channel.data(body));
   */
  route(type: string, handler: ChannelHandler<C>): this {
    if (!type) throw new Error("Channel operation must not be empty");
    if (this.routes.has(type))
      throw new Error(`Duplicate channel operation ${type}`);
    this.routes.set(type, handler);
    return this;
  }

  /**
   * Parses only `body.type`, then forwards the original body and exact context.
   * Invalid requests receive `invalid_request`; unknown types receive `not_found`.
   * Both end only this channel. Handler exceptions propagate, and HoseConnection
   * owns the returned teardown.
   * @example
   * declare const router: HoseRouter<{prefix: string}>;
   * declare const channel: Channel;
   * router.handle({type: 'echo', text: 'hello'}, channel, {prefix: 'demo'});
   */
  handle(
    body: unknown,
    channel: Channel,
    context: C,
  ): ReturnType<ChannelHandler<C>> {
    const parsed = Operation.safeParse(body);
    if (!parsed.success) {
      channel.error("invalid_request");
      return;
    }
    const handler = this.routes.get(parsed.data.type);
    if (!handler) {
      channel.error("not_found");
      return;
    }
    return handler(body, channel, context);
  }
}
