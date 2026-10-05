// Purpose: Embed Tea's language server in one independent duplex Hose channel.
import { Effect, Stream, SubscriptionRef } from "effect";
import type { Context } from "@openchart/server/context";
import { observeWorkspaceFiles } from "@openchart/server/workspace/file-observation";
import { failureFor } from "@openchart/server/lib/errors";
import { JsonRpcTransport } from "@openchart/hose/jsonrpc";
import type { ChannelHandler } from "@openchart/hose";
import { startLanguageServer } from "tea/lsp";
import { createConnection } from "vscode-languageserver";
import { createProtocolConnection } from "vscode-languageserver/node";

/**
 * Starts one in-process LSP session. Hose owns its lifetime and tears down all
 * protocol state when the channel ends. LSP exit never exits the host process.
 *
 * @example router.route("tea.lsp", teaLanguageServer);
 */
export const teaLanguageServer: ChannelHandler<Context> = (
  _body,
  channel,
  ctx,
) => {
  const transport = new JsonRpcTransport((body) => channel.data(body));
  channel.onData((body) => transport.receive(body));
  const connection = createConnection(
    (logger) =>
      createProtocolConnection(transport.reader, transport.writer, logger),
    { initialize() {}, shutdownReceived: false, exit: () => channel.done() },
  );
  const dependencies = Effect.runSync(
    SubscriptionRef.make<readonly string[]>([]),
  );
  const session = startLanguageServer(connection, (files) => {
    Effect.runSync(SubscriptionRef.set(dependencies, files));
  });
  const abort = new AbortController();
  void ctx.runtime
    .runPromise(
      observeWorkspaceFiles(SubscriptionRef.changes(dependencies)).pipe(
        Stream.runForEach(() => Effect.sync(() => session.invalidateFiles())),
      ),
      { signal: abort.signal },
    )
    .catch((error: unknown) => {
      if (!abort.signal.aborted)
        connection.console.error(failureFor(error).message);
    });
  return () => {
    abort.abort();
    connection.dispose();
    transport.dispose();
  };
};
