// Purpose: Exercise Tea's real LSP over the application's shared Hose transport.
import { mkdir, writeFile } from "node:fs/promises";
import { FSWatcher } from "chokidar";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { ConfigProvider } from "effect";
import { WebSocket } from "ws";
import { expect, test, vi } from "vitest";
import {
  createProtocolConnection,
  type PublishDiagnosticsParams,
} from "vscode-languageserver/node";
import { JsonRpcTransport } from "@openchart/hose/jsonrpc";
import { createTransport } from "@openchart/app/lib/transport/transport";
import { createServer } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";

test("serves independent unsaved documents, updates diagnostics, and exits without stopping its sibling or host", async () => {
  vi.stubGlobal("WebSocket", WebSocket);
  const server = await createServer({
    home: temporaryHome(),
    databasePath: ":memory:",
    models: { fetchEnabled: false, userAgent: "tea-lsp-test" },
    config: ConfigProvider.fromUnknown({}),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  const transport = createTransport({
    origin: `http://127.0.0.1:${address.port}`,
  });
  const open = () => {
    const rpc = new JsonRpcTransport((body) => channel.send(body));
    const channel = transport.hose.openChannel(
      { type: "tea.lsp" },
      {
        data: (body) => rpc.receive(body),
        error: (error) => rpc.close(error),
        done: () => rpc.close(),
      },
    );
    const connection = createProtocolConnection(rpc.reader, rpc.writer);
    connection.listen();
    return {
      connection,
      dispose: () => {
        channel.close();
        connection.dispose();
        rpc.dispose();
      },
    };
  };
  const first = open();
  const second = open();
  try {
    const id = await transport.rpc.resources.workspace.getDefault.query();
    const workspace = await transport.rpc.resources.workspace.get.query({ id });
    const uri = pathToFileURL(join(workspace.root, "unsaved.tea")).href;
    const broken = 'fast = ta.ema(close, 9)\nplot("fast", fasst)\n';
    const fixed = broken.replace("fasst", "fast");
    for (const session of [first, second]) {
      const initialized = await session.connection.sendRequest("initialize", {
        processId: null,
        capabilities: {},
        rootUri: null,
      });
      expect(initialized).toMatchObject({
        capabilities: {
          hoverProvider: true,
          completionProvider: { triggerCharacters: ["."] },
        },
      });
      await session.connection.sendNotification("initialized", {});
    }
    const watch = vi.spyOn(FSWatcher.prototype, "add");
    const watchers = () =>
      watch.mock.results.flatMap((result) =>
        result.type === "return" ? [result.value] : [],
      );
    const diagnostics: PublishDiagnosticsParams[] = [];
    first.connection.onNotification(
      "textDocument/publishDiagnostics",
      (params) => {
        diagnostics.push(params);
      },
    );
    await first.connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "tea", version: 1, text: broken },
    });
    await second.connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "tea", version: 1, text: fixed },
    });
    await vi.waitFor(() =>
      expect(diagnostics.at(-1)).toMatchObject({
        version: 1,
        diagnostics: [{ message: "undeclared name 'fasst'" }],
      }),
    );
    const position = {
      textDocument: { uri },
      position: { line: 1, character: 14 },
    };
    expect(
      await second.connection.sendRequest("textDocument/hover", position),
    ).toMatchObject({
      contents: { value: expect.stringContaining("series float fast") },
    });
    await first.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: fixed }],
    });
    await vi.waitFor(() =>
      expect(diagnostics.at(-1)).toMatchObject({ version: 2, diagnostics: [] }),
    );
    // The host infers dependencies from the same LSP analysis; no file-list RPC
    // or client-side watcher notification is involved, even for missing imports.
    const library = join(workspace.root, "lib");
    await mkdir(library);
    await writeFile(
      join(library, "bands.tea"),
      'library("bands")\nimport ./missing\nexport value(x) => missing.value(x)\n',
    );
    await first.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: 3 },
      contentChanges: [
        { text: 'import ./lib/bands\nplot("x", bands.value(close))\n' },
      ],
    });
    await vi.waitFor(() =>
      expect(diagnostics.at(-1)).toMatchObject({
        version: 3,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("cannot find"),
          }),
        ]),
      }),
    );
    await vi.waitFor(() =>
      expect(
        watchers().some((watcher) =>
          watcher.getWatched()[library]?.includes("bands.tea"),
        ),
      ).toBe(true),
    );
    await writeFile(
      join(library, "missing.tea"),
      'library("missing")\nexport value(x) => x\n',
    );
    await vi.waitFor(() =>
      expect(diagnostics.at(-1)).toMatchObject({ version: 3, diagnostics: [] }),
    );
    await writeFile(
      join(library, "missing.tea"),
      'library("missing")\nexport value(x) => unknown_name\n',
    );
    await vi.waitFor(() =>
      expect(
        diagnostics
          .at(-1)
          ?.diagnostics.some(
            (diagnostic) =>
              typeof diagnostic.message === "string" &&
              diagnostic.message.includes("unknown_name"),
          ),
      ).toBe(true),
    );
    const dependencyWatcher = watchers().find((watcher) =>
      watcher.getWatched()[library]?.includes("bands.tea"),
    );
    if (!dependencyWatcher) throw new Error("Expected dependency observation");
    const closeDependency = vi.spyOn(dependencyWatcher, "close");
    await first.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: 4 },
      contentChanges: [{ text: fixed }],
    });
    await vi.waitFor(() =>
      expect(diagnostics.at(-1)).toMatchObject({ version: 4, diagnostics: [] }),
    );
    await vi.waitFor(() => expect(closeDependency).toHaveBeenCalledOnce());
    await first.connection.sendRequest("shutdown");
    await first.connection.sendNotification("exit");
    expect(
      await second.connection.sendRequest("textDocument/hover", position),
    ).not.toBeNull();
    expect(await transport.rpc.echo.query({ message: "still alive" })).toEqual({
      message: "still alive",
    });
  } finally {
    first.dispose();
    second.dispose();
    transport.hose.disconnect();
    await server.shutdown();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
