// Purpose: Graceful protocol shutdown must not masquerade as an inbound disconnect.
import { createMessageConnection } from "vscode-jsonrpc";
import { expect, test, vi } from "vitest";
import { JsonRpcTransport } from "./jsonrpc";

test("ending a protocol connection does not fire its disconnect handler", () => {
  const transport = new JsonRpcTransport(() => {});
  const connection = createMessageConnection(
    transport.reader,
    transport.writer,
  );
  const closed = vi.fn();
  connection.onClose(closed);
  connection.listen();

  connection.end();
  connection.dispose();
  transport.close();
  transport.dispose();

  expect(closed).not.toHaveBeenCalled();
});

test("a real channel disconnect rejects pending requests and notifies once", async () => {
  const sent = vi.fn();
  const transport = new JsonRpcTransport(sent);
  const connection = createMessageConnection(
    transport.reader,
    transport.writer,
  );
  const closed = vi.fn();
  connection.onClose(() => {
    closed();
    connection.dispose();
  });
  connection.listen();
  const response = connection.sendRequest("pending");
  const rejected = expect(response).rejects.toThrow(
    "Pending response rejected",
  );
  await vi.waitFor(() => expect(sent).toHaveBeenCalledOnce());

  transport.close();
  transport.close();

  await rejected;
  expect(closed).toHaveBeenCalledOnce();
  connection.dispose();
  transport.dispose();
});
