// Purpose: Compose the V2 runtime, tRPC, and Hose server.

import { timingSafeEqual } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
} from "node:http";
import { HoseRouter } from "@openchart/hose";
import { HoseServer } from "@openchart/hose/node";
import { agentRouter } from "@openchart/server/agent";
import { feedRouter } from "@openchart/server/feed/router";
import { providersRouter } from "@openchart/server/data/providers/router";
import { faviconRouter } from "@openchart/server/favicon/router";
import { barsChannel } from "@openchart/server/feed/bar/hose-handler";
import { indicatorsRouter } from "@openchart/server/indicators/router";
import { teaRouter } from "@openchart/server/tea/router";
import { teaChannel } from "@openchart/server/tea/hose-handler";
import { teaLanguageServer } from "@openchart/server/tea/lsp";
import { eventsRouter } from "@openchart/server/events";
import { trpc } from "@openchart/server/lib/trpc";
import { accessRouter } from "@openchart/server/access/router";
import { resourceRouter } from "@openchart/server/resources/router";
import { workspaceRouter } from "@openchart/server/workspace/router";
import { modelsRouter } from "@openchart/server/models/router";
import { configRouter } from "@openchart/server/config/router";
import { schedulerRouter } from "@openchart/server/scheduler/router";
import { collectionRouter } from "@openchart/server/collection/router";
import { monitoringRouter } from "@openchart/server/monitoring/router";
import { proactiveRouter } from "@openchart/server/proactive/router";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { Schema } from "effect";
import type { Context } from "./context";

import {
  echo,
  makeRuntime,
  type RuntimeOptions,
  type Runtime,
} from "./runtime";

/** Root tRPC routes. Do not create raw routes here, echo is the only exception for debugging purpose. */
export const router = trpc.router({
  feed: feedRouter,
  providers: providersRouter,
  favicon: faviconRouter,
  tea: teaRouter,
  indicators: indicatorsRouter,
  access: accessRouter,
  events: eventsRouter,
  agent: agentRouter,
  resources: resourceRouter,
  config: configRouter,
  scheduler: schedulerRouter,
  collection: collectionRouter,
  monitoring: monitoringRouter,
  proactive: proactiveRouter,
  models: modelsRouter,
  workspace: workspaceRouter,
  echo: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(Schema.Struct({ message: Schema.String }), {
        parseOptions: { onExcessProperty: "error" },
      }),
    )
    .query(({ ctx, input }) => ctx.runtime.runPromise(echo(input.message))),
});

/** tRPC client contract. */
export type AppRouter = typeof router;

/** Shared Hose routes; runtime comes from context. */
export const hoseRouter = new HoseRouter<Context>()
  .route("bars.open", barsChannel)
  .route("bars.capabilities", barsChannel)
  .route("tea.open", teaChannel)
  .route("tea.lsp", teaLanguageServer);

/** Build an HTTP handler over a caller-owned runtime; the host awaits runtime.context() before listening.
 * @example const server = createHttpServer(createRequestHandler(runtime));
 */
export function createRequestHandler(runtime: Runtime) {
  return createHTTPHandler({
    allowMethodOverride: true,
    basePath: "/trpc/",
    router,
    createContext: () => ({ runtime }),
    // tRPC replaces Node's Vary header; appending here is the only way to keep it.
    responseMeta: () => ({ headers: new Headers({ vary: "Origin" }) }),
  });
}

/** Local API access policy: one trusted renderer origin and one per-run secret. */
export interface LocalAccess {
  /** Every request presents it as `Authorization: Bearer <token>` or `?token=<token>`. */
  readonly token: string;
  /** The only Origin allowed to call the API; CORS answers apply to it alone. */
  readonly origin: string;
}

/** How the host process exposes the runtime; {@link RuntimeOptions} configures the runtime itself. */
export interface ServerOptions {
  /** Guards every request and upgrade; absent leaves the loopback API open (browser development, tests). */
  readonly access?: LocalAccess;
}

/**
 * One predicate for HTTP requests and WebSocket upgrades: Host must be the bound
 * `127.0.0.1:<port>` (defeats DNS rebinding), Origin must be the trusted renderer,
 * and the token must match. Preflight cannot carry credentials, so OPTIONS
 * passes on Host and Origin alone.
 */
function localAccess(server: Server, access: LocalAccess) {
  const secret = Buffer.from(access.token);
  const authorized = (request: IncomingMessage): boolean => {
    const address = server.address();
    if (typeof address !== "object" || address === null) return false;
    if (request.headers.host !== `127.0.0.1:${address.port}`) return false;
    if (request.headers.origin !== access.origin) return false;
    const url = URL.parse(request.url ?? "/", "http://localhost");
    if (!url) return false;
    if (request.method === "OPTIONS") return true;
    const bearer = request.headers.authorization;
    const presented = Buffer.from(
      bearer?.startsWith("Bearer ")
        ? bearer.slice("Bearer ".length)
        : (url.searchParams.get("token") ?? ""),
    );
    return (
      presented.length === secret.length && timingSafeEqual(presented, secret)
    );
  };
  return { origin: access.origin, authorized };
}

/**
 * Initialize application services and create an unbound host. Use shutdown() to release all owned resources.
 * With `host.access`, every request and Hose upgrade must present the bound Host, the
 * trusted Origin, and the token; failures answer 401 before any routing happens.
 * @example
 * const server = await createServer({home: '/tmp/openchart'}, {access: {token, origin: 'openchart://app'}});
 * server.listen(0, '127.0.0.1');
 */
export async function createServer(
  options: RuntimeOptions,
  host: ServerOptions = {},
) {
  const runtime = makeRuntime(options);
  try {
    await runtime.context();
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
  const handle = createRequestHandler(runtime);
  const server = createHttpServer();
  const access = host.access && localAccess(server, host.access);
  server.on("request", (request, response) => {
    if (access) {
      if (!access.authorized(request)) {
        response.writeHead(401).end();
        return;
      }
      response.setHeader("Access-Control-Allow-Origin", access.origin);
      response.setHeader("Vary", "Origin");
      if (request.method === "OPTIONS") {
        response
          .writeHead(204, {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, content-type",
            Vary: "Origin",
          })
          .end();
        return;
      }
    }
    const url = URL.parse(request.url ?? "/", "http://localhost");
    if (!url) {
      response.writeHead(400).end();
      return;
    }
    if (url.pathname.startsWith("/trpc/")) {
      handle(request, response);
      return;
    }
    response.writeHead(404).end();
  });
  const hose = new HoseServer({
    server,
    path: "/hose",
    router: hoseRouter,
    createContext: () => ({ runtime }),
    authorize: access?.authorized,
  });
  return Object.assign(server, {
    /**
     * Closes Hose, HTTP, and runtime, continuing cleanup after failures.
     * @example await server.shutdown();
     */
    async shutdown(): Promise<void> {
      try {
        hose.dispose();
      } finally {
        try {
          const closed = server.listening
            ? new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
              })
            : Promise.resolve();
          server.closeAllConnections();
          await closed;
        } finally {
          await runtime.dispose();
        }
      }
    },
  });
}
