// Purpose: Verifies native configuration preservation and the OS relay's byte transport, isolation and lifetime.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type AddressInfo, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  RELAY_PORT,
  RELAY_TOKEN,
  startHostToolServer,
  type HostToolServer,
} from "./host-tools";
import { ensureHostToolConfig, RELAY_SERVER } from "./native-config";

let home: string;
const children: ChildProcessWithoutNullStreams[] = [];
const sockets: Socket[] = [];
const cleanups: Array<() => void> = [];

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "antigravity-config-"));
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.kill();
  }
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const cleanup of cleanups.splice(0)) cleanup();
  await rm(home, { recursive: true, force: true });
});

function relay(env: Record<string, string>) {
  const child = spawn(RELAY_SERVER.command, RELAY_SERVER.args, {
    env: { ...process.env, [RELAY_PORT]: "", [RELAY_TOKEN]: "", ...env },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

function closed(child: ChildProcessWithoutNullStreams) {
  return once(child, "close", { signal: AbortSignal.timeout(10_000) });
}

async function rawHost() {
  const server = createServer((socket) => sockets.push(socket));
  cleanups.push(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const connection = once(server, "connection").then(
    ([socket]) => socket as Socket,
  );
  return { port: (server.address() as AddressInfo).port, connection };
}

describe("Antigravity native configuration", () => {
  it("preserves other settings, uses native path separators and makes repeat writes unnecessary", async () => {
    const mcpFile = path.join(home, ".gemini", "config", "mcp_config.json");
    const settingsFile = path.join(
      home,
      ".gemini",
      "antigravity-cli",
      "settings.json",
    );
    await mkdir(path.dirname(mcpFile), { recursive: true });
    await mkdir(path.dirname(settingsFile), { recursive: true });
    await writeFile(
      mcpFile,
      JSON.stringify({ mcpServers: { mine: { command: "mine" } }, other: 42 }),
    );
    await writeFile(
      settingsFile,
      JSON.stringify({
        permissions: { allow: ["mine"], deny: ["blocked"] },
        theme: "dark",
      }),
    );
    await ensureHostToolConfig(home);
    const expectedMcp = JSON.parse(await readFile(mcpFile, "utf8"));
    expect(expectedMcp).toEqual({
      mcpServers: { mine: { command: "mine" }, openchart: RELAY_SERVER },
      other: 42,
    });
    expect(JSON.parse(await readFile(settingsFile, "utf8"))).toEqual({
      permissions: {
        allow: [
          "mine",
          "mcp(openchart/*)",
          `read_file(${path.join(await realpath(home), ".gemini", "antigravity-cli", "mcp", "openchart")}${path.sep})`,
        ],
        deny: ["blocked"],
      },
      theme: "dark",
    });
    // Custom formatting survives when the semantic config is already correct.
    const formatted = JSON.stringify(expectedMcp);
    await writeFile(mcpFile, formatted);
    await ensureHostToolConfig(home);
    expect(await readFile(mcpFile, "utf8")).toBe(formatted);
    if (process.platform === "win32") {
      expect(path.win32.isAbsolute(RELAY_SERVER.command)).toBe(true);
      expect(RELAY_SERVER.command).toMatch(
        /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i,
      );
      expect(RELAY_SERVER.args.at(-1)).not.toContain('"');
      expect(RELAY_SERVER.args.at(-1)).not.toContain(process.execPath);
    }
  });

  it("rejects invalid user JSON without replacing it", async () => {
    const file = path.join(home, ".gemini", "config", "mcp_config.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "broken json");
    await expect(ensureHostToolConfig(home)).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("broken json");
  });
});

describe("Antigravity native relay", () => {
  // Cold system PowerShell startup on a shared runner is native integration;
  // Vitest's five-second default is not a product latency contract. The close
  // helper still bounds the process wait to ten seconds inside this deadline.
  it("exits successfully without a request's environment", async () => {
    const child = relay({});
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    expect(await closed(child)).toEqual([0, null]);
    expect(Buffer.concat(output)).toHaveLength(0);
  }, 15_000);

  it("copies raw bytes in both directions after the token line", async () => {
    const host = await rawHost();
    const child = relay({
      [RELAY_PORT]: String(host.port),
      [RELAY_TOKEN]: "request-token",
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    const socket = await host.connection;
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    const bytes = Buffer.from([
      0,
      10,
      13,
      27,
      128,
      255,
      ...Buffer.from("市場\r\n"),
    ]);
    child.stdin.write(bytes);
    socket.write(bytes);
    await expect
      .poll(() => Buffer.concat(received))
      .toEqual(Buffer.concat([Buffer.from("request-token\n"), bytes]));
    await expect.poll(() => Buffer.concat(output)).toEqual(bytes);
  }, 15_000);

  it("isolates simultaneous tool requests by their per-request port and token", async () => {
    const hosts: HostToolServer[] = [];
    const exchanges = await Promise.all(
      ["first", "second"].map(async (value) => {
        const host = await startHostToolServer(
          {
            identify: {
              description: "Identifies this request.",
              inputSchema: z.object({}),
              execute: async () => ({ value, private: true }),
              toModelOutput: (result) => (result as { value: string }).value,
            },
          },
          undefined,
          { started() {}, finished() {} },
        );
        hosts.push(host);
        cleanups.push(() => host.close());
        const child = relay(host.env);
        const lines = createInterface({ input: child.stdout });
        cleanups.push(() => lines.close());
        const answer = once(lines, "line", {
          signal: AbortSignal.timeout(10_000),
        });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "identify", arguments: {} } })}\n`,
        );
        return JSON.parse((await answer)[0] as string);
      }),
    );
    expect(
      exchanges.map((answer: { result: unknown }) => answer.result),
    ).toEqual([
      { content: [{ type: "text", text: "first" }] },
      { content: [{ type: "text", text: "second" }] },
    ]);
    expect(hosts[0]!.env[RELAY_PORT]).not.toBe(hosts[1]!.env[RELAY_PORT]);
    expect(hosts[0]!.env[RELAY_TOKEN]).not.toBe(hosts[1]!.env[RELAY_TOKEN]);
  }, 15_000);

  it.skipIf(process.platform !== "win32")(
    "exits when the host closes while stdin is still open",
    async () => {
      const host = await rawHost();
      const child = relay({
        [RELAY_PORT]: String(host.port),
        [RELAY_TOKEN]: "token",
      });
      const finished = closed(child);
      const socket = await host.connection;
      socket.end();
      expect(await finished).toEqual([0, null]);
    },
    15_000,
  );

  it("exits when stdin closes while the host connection is still open", async () => {
    const host = await rawHost();
    const child = relay({
      [RELAY_PORT]: String(host.port),
      [RELAY_TOKEN]: "token",
    });
    const finished = closed(child);
    await host.connection;
    child.stdin.end();
    // The Unix relay's background cat inherits stdout until the host closes.
    if (process.platform !== "win32") (await host.connection).end();
    expect(await finished).toEqual([0, null]);
  }, 15_000);
});
