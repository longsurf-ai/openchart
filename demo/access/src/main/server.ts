// Purpose: Run the real V2 demo backend and SQLite inside an Electron utility process.

import { once } from "node:events";
import { createServer } from "node:http";
import { createRequestHandler } from "@openchart/server";
import { makeRuntime } from "@openchart/server/runtime";
import { z } from "zod";
import { OPENCHART_CLOUD } from "@openchart/server/access/integration/openchart-cloud";
import { hostRequest } from "./host-client";

const [home, rendererOrigin, billingUrl] = z
  .tuple([z.string().min(1), z.string().min(1), z.string()])
  .parse(process.argv.slice(2));

const runtime = makeRuntime({
  billing: billingUrl ? { baseUrl: billingUrl } : undefined,
  credentialEncryption: {
    encrypt: (value) => hostRequest("encrypt", value),
    decrypt: (value) => hostRequest("decrypt", value),
  },
  integrations: {
    integrations: [{ id: OPENCHART_CLOUD.integrationID, name: "OpenChart" }],
    methods: [OPENCHART_CLOUD],
  },
  auth: { integrationID: OPENCHART_CLOUD.integrationID },
  home,
  models: {
    fetchEnabled: false,
    userAgent: "OpenChart/V2 Access demo",
  },
  profiles: {
    agents: {
      analyst: {
        permission: [
          { action: "echo", resource: "*", decision: "ask" },
          { action: "workflow", resource: "*", decision: "ask" },
        ],
      },
    },
  },
});
const handle = createRequestHandler(runtime);
const server = createServer((request, response) => {
  if (request.headers.origin && request.headers.origin !== rendererOrigin) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader("Access-Control-Allow-Origin", rendererOrigin);
  response.setHeader("Vary", "Origin");
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.writeHead(204).end();
    return;
  }
  handle(request, response);
});

try {
  await runtime.context();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Demo server did not bind a TCP port");
  process.parentPort.postMessage(address.port);
  await new Promise<void>((resolve) => {
    process.parentPort.on("message", ({ data }: { data: unknown }) => {
      if (data === "shutdown") resolve();
    });
  });
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
process.exit(0);
