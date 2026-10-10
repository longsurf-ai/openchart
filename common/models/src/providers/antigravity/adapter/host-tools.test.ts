// Purpose: Exercises real MCP TCP disconnects and preserves tool outcomes after a relay resets its connection.
import { once } from "node:events";
import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  RELAY_PORT,
  RELAY_TOKEN,
  startHostToolServer,
  type HostToolServer,
} from "./host-tools";

const servers: HostToolServer[] = [];
const clients: Socket[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.destroy();
  for (const server of servers.splice(0)) server.close();
});

async function connect(host: HostToolServer) {
  const client = createConnection({
    host: "127.0.0.1",
    port: Number(host.env[RELAY_PORT]),
  });
  clients.push(client);
  await once(client, "connect");
  client.write(host.env[RELAY_TOKEN] + "\n");
  return client;
}

async function ping(host: HostToolServer) {
  const client = await connect(host);
  const input = createInterface({ input: client, crlfDelay: Infinity });
  try {
    const response = once(input, "line");
    client.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n",
    );
    const [line] = (await response) as [string];
    expect(JSON.parse(line)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
  } finally {
    input.close();
  }
  return client;
}

it("contains an abrupt relay TCP reset and continues accepting authenticated connections", async () => {
  const host = await startHostToolServer({}, undefined, {
    started: vi.fn(),
    finished: vi.fn(),
  });
  servers.push(host);
  const client = await ping(host);
  const closed = once(client, "close");
  // Send a real RST, rather than a clean FIN: readline forwards this input error independently.
  client.resetAndDestroy();
  await closed;
  await ping(host);
});

it.each([false, true])(
  "preserves an in-flight tool outcome after the client resets (tool fails: %s)",
  async (fails) => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = { answer: "fixture outcome", hidden: true };
    const calls = { started: vi.fn(), finished: vi.fn() };
    const host = await startHostToolServer(
      {
        fixture: {
          description:
            "Returns the fixture outcome after the test releases it.",
          inputSchema: z.object({}),
          execute: async () => {
            await ready;
            if (fails) throw new Error("fixture tool failure");
            return result;
          },
          toModelOutput: () => "fixture outcome",
        },
      },
      undefined,
      calls,
    );
    servers.push(host);
    const client = await connect(host);
    client.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "fixture", arguments: {} },
      }) + "\n",
    );
    await vi.waitFor(() => expect(calls.started).toHaveBeenCalledOnce());
    const closed = once(client, "close");
    client.resetAndDestroy();
    await closed;
    release();
    await vi.waitFor(() => expect(calls.finished).toHaveBeenCalledOnce());
    expect(calls.finished).toHaveBeenCalledWith(
      expect.any(String),
      "fixture",
      fails ? "fixture tool failure" : result,
      fails,
    );
    await ping(host);
  },
);
