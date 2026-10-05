// Purpose: Locks Hose client multiplexing, cancellation, protocol failure, and physical reconnect without channel replay.

import { expect, test, vi } from "vitest";

import { HoseClient, HoseError, type Link, type LinkEvents } from "./client";
import { encode, type ClientMsg } from "./protocol";

class FakeLink implements Link {
  state: "connecting" | "open" | "closed" = "connecting";
  sent: ClientMsg[] = [];
  events?: LinkEvents;
  failSend = false;

  send(msg: string): void {
    if (this.failSend) throw new Error("send failed");
    this.sent.push(JSON.parse(msg) as ClientMsg);
  }

  close(): void {
    this.state = "closed";
  }

  listen(events: LinkEvents): () => void {
    this.events = events;
    return () => {
      if (this.events === events) this.events = undefined;
    };
  }

  connect(): void {
    this.state = "open";
    this.events?.open();
  }

  message(msg: Parameters<typeof encode>[0]): void {
    this.events?.message(encode(msg));
  }

  fail(): void {
    this.events?.close();
  }
}

test("multiplexes data and sends close for one active channel", () => {
  const link = new FakeLink();
  const client = new HoseClient(() => link);
  const data: unknown[] = [];
  const { close } = client.openChannel("request", {
    data: (value) => data.push(value),
    error: () => {},
    done: () => {},
  });
  link.connect();
  const open = link.sent[0];
  expect(open).toEqual({ type: "open", id: "hose-1", body: "request" });
  link.message({ type: "data", id: "hose-1", body: "response" });
  expect(data).toEqual(["response"]);
  close();
  expect(link.sent.at(-1)).toEqual({ type: "close", id: "hose-1" });
  client.disconnect();
});

test("opens queued channels when a Link starts connected", () => {
  const link = new FakeLink();
  link.state = "open";
  const client = new HoseClient(() => link);
  client.openChannel("request", {
    data: () => {},
    error: () => {},
    done: () => {},
  });
  expect(link.sent).toEqual([{ type: "open", id: "hose-1", body: "request" }]);
  client.disconnect();
});

test("disconnect ends old channels and reconnects only the socket", async () => {
  const links: FakeLink[] = [];
  const errors: string[] = [];
  const data: unknown[] = [];
  const client = new HoseClient(
    () => {
      const link = new FakeLink();
      links.push(link);
      return link;
    },
    () => 0,
  );
  client.openChannel("request", {
    data: () => {},
    error: (error) => errors.push(error.message),
    done: () => {},
  });
  links[0]!.connect();
  links[0]!.fail();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(errors).toEqual(["Hose socket_closed"]);
  expect(links).toHaveLength(2);
  expect(links[1]!.sent).toEqual([]);
  links[1]!.connect();
  client.openChannel("new request", {
    data: (value) => data.push(value),
    error: () => {},
    done: () => {},
  });
  expect(links[1]!.sent).toEqual([
    { type: "open", id: "hose-2", body: "new request" },
  ]);
  links[1]!.message({ type: "data", id: "hose-2", body: "new response" });
  expect(data).toEqual(["new response"]);
  client.disconnect();
});

test("invalid server message closes the current socket", () => {
  const link = new FakeLink();
  const errors: string[] = [];
  const client = new HoseClient(
    () => link,
    () => 10_000,
  );
  client.openChannel("request", {
    data: () => {},
    error: (error) => errors.push(error.message),
    done: () => {},
  });
  link.connect();
  link.events?.message("{");
  expect(errors).toEqual(["Hose protocol_error"]);
  expect(link.state).toBe("closed");
  client.disconnect();
});

test("preserves channel error codes", () => {
  const link = new FakeLink();
  let failure: HoseError | undefined;
  const client = new HoseClient(() => link);
  client.openChannel("request", {
    data: () => {},
    error: (error) => {
      failure = error;
    },
    done: () => {},
  });
  link.connect();
  link.message({
    type: "error",
    id: "hose-1",
    code: "not_found",
  });
  expect(failure).toBeInstanceOf(HoseError);
  expect(failure?.code).toBe("not_found");
  expect(failure?.message).toBe("Hose not_found");
  expect(failure?.body).toBeUndefined();
  client.disconnect();
});

test("passes the server's opaque error body to the channel owner", () => {
  const link = new FakeLink();
  let failure: HoseError | undefined;
  const client = new HoseClient(() => link);
  client.openChannel("request", {
    data: () => {},
    error: (error) => {
      failure = error;
    },
    done: () => {},
  });
  link.connect();
  link.message({
    type: "error",
    id: "hose-1",
    code: "failed",
    body: { _tag: "FeedError" },
  });
  expect(failure?.code).toBe("failed");
  expect(failure?.message).toBe("Hose failed");
  expect(failure?.body).toEqual({ _tag: "FeedError" });
  client.disconnect();
});

test("send failure ends old channels without replay", async () => {
  const links: FakeLink[] = [];
  const errors: HoseError[] = [];
  const client = new HoseClient(
    () => {
      const link = new FakeLink();
      links.push(link);
      return link;
    },
    () => 0,
  );
  client.openChannel("request", {
    data: () => {},
    error: (error) => errors.push(error),
    done: () => {},
  });
  links[0]!.failSend = true;
  links[0]!.connect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(errors.map((error) => error.code)).toEqual(["socket_failed"]);
  expect(links).toHaveLength(2);
  expect(links[1]!.sent).toEqual([]);
  client.disconnect();
});

test("Observable abort closes only its channel and completion removes abort listeners", () => {
  const link = new FakeLink();
  const client = new HoseClient(() => link);
  const first = new AbortController();
  const second = new AbortController();
  const removed = vi.spyOn(second.signal, "removeEventListener");
  const errors: unknown[] = [];
  const values: unknown[] = [];
  const complete = vi.fn();
  client
    .observe({ type: "one" }, { signal: first.signal })
    .subscribe({ error: (error) => errors.push(error) });
  client
    .observe({ type: "two" }, { signal: second.signal })
    .subscribe({ next: (value) => values.push(value), complete });
  link.connect();
  const reason = new Error("cancel one");
  first.abort(reason);
  expect(errors).toEqual([reason]);
  expect(link.sent.at(-1)).toEqual({ type: "close", id: "hose-1" });
  link.message({ type: "data", id: "hose-2", body: "still active" });
  link.message({ type: "done", id: "hose-2" });
  expect(values).toEqual(["still active"]);
  expect(complete).toHaveBeenCalledOnce();
  expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(link.state).toBe("open");
  client.disconnect();
});

test("request closes after a synchronous first response and rejects empty completion", async () => {
  const link = new FakeLink();
  link.state = "open";
  const send = link.send.bind(link);
  link.send = (message) => {
    send(message);
    const sent = link.sent.at(-1)!;
    if (sent.type === "open")
      link.message({ type: "data", id: sent.id, body: 42 });
  };
  const client = new HoseClient(() => link);
  expect(await client.request({ type: "answer" })).toBe(42);
  expect(link.sent).toEqual([
    { type: "open", id: "hose-1", body: { type: "answer" } },
    { type: "close", id: "hose-1" },
  ]);
  link.send = send;
  const pending = client.request({ type: "empty" });
  const rejected = expect(pending).rejects.toMatchObject({
    code: "empty_response",
  });
  link.message({ type: "done", id: "hose-2" });
  await rejected;
  client.disconnect();
});

test("pre-aborted requests create no connection; unsubscribe detaches its abort listener", async () => {
  const link = new FakeLink();
  const create = vi.fn(() => link);
  const client = new HoseClient(create);
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(
    client.request({ type: "cancelled" }, { signal: cancelled.signal }),
  ).rejects.toBe(cancelled.signal.reason);
  expect(create).not.toHaveBeenCalled();
  const controller = new AbortController();
  const removed = vi.spyOn(controller.signal, "removeEventListener");
  const complete = vi.fn();
  const subscription = client
    .observe({ type: "stop" }, { signal: controller.signal })
    .subscribe({ complete });
  subscription.unsubscribe();
  expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(complete).not.toHaveBeenCalled();
  link.connect();
  expect(link.sent).toEqual([]);
  client.disconnect();
});

test("sends queued before open follow it in order; later sends go out at once", () => {
  const link = new FakeLink();
  const client = new HoseClient(() => link);
  const events = { data: () => {}, error: () => {}, done: () => {} };
  const first = client.openChannel("first", events);
  first.send("a");
  const second = client.openChannel("second", events);
  second.send("b");
  first.send({ n: 2 });
  expect(link.sent).toEqual([]);
  link.connect();
  expect(link.sent).toEqual([
    { type: "open", id: "hose-1", body: "first" },
    { type: "data", id: "hose-1", body: "a" },
    { type: "data", id: "hose-1", body: { n: 2 } },
    { type: "open", id: "hose-2", body: "second" },
    { type: "data", id: "hose-2", body: "b" },
  ]);
  first.send("after open");
  expect(link.sent.at(-1)).toEqual({
    type: "data",
    id: "hose-1",
    body: "after open",
  });
  expect(link.sent).toHaveLength(6);
  expect(() => first.send(undefined)).toThrow("requires a body");
  // Closing before open drops the queue with the channel: nothing reaches the wire.
  const unopened = new FakeLink();
  const idle = new HoseClient(() => unopened);
  const cancelled = idle.openChannel("cancelled", events);
  cancelled.send("never");
  cancelled.close();
  unopened.connect();
  expect(unopened.sent).toEqual([]);
  idle.disconnect();
  client.disconnect();
});

test("send throws after done, error, close, and a socket drop without replay", async () => {
  const links: FakeLink[] = [];
  const client = new HoseClient(
    () => {
      const link = new FakeLink();
      links.push(link);
      return link;
    },
    () => 0,
  );
  const errors: string[] = [];
  const events = {
    data: () => {},
    error: (error: HoseError) => errors.push(error.code),
    done: () => {},
  };
  const done = client.openChannel("done", events);
  const failed = client.openChannel("failed", events);
  const closed = client.openChannel("closed", events);
  const dropped = client.openChannel("dropped", events);
  links[0]!.connect();
  links[0]!.message({ type: "done", id: "hose-1" });
  links[0]!.message({
    type: "error",
    id: "hose-2",
    code: "not_found",
  });
  closed.close();
  dropped.send("delivered once");
  links[0]!.fail();
  for (const channel of [done, failed, closed, dropped])
    expect(() => channel.send("late")).toThrow("is closed");
  expect(errors).toEqual(["not_found", "socket_closed"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  links[1]!.connect();
  expect(links[1]!.sent).toEqual([]);
  expect(links[0]!.sent.filter((msg) => msg.type === "data")).toEqual([
    { type: "data", id: "hose-4", body: "delivered once" },
  ]);
  client.disconnect();
});

test("a body that cannot be encoded throws to its caller and spares sibling channels", () => {
  const link = new FakeLink();
  const client = new HoseClient(() => link);
  const sibling = { data: vi.fn(), error: vi.fn(), done: vi.fn() };
  client.openChannel({ type: "prices" }, sibling);
  link.connect();

  const events = { data: vi.fn(), error: vi.fn(), done: vi.fn() };
  expect(() => client.openChannel({ type: "x", n: 1n }, events)).toThrow();
  expect(() => client.openChannel(undefined, events)).toThrow(
    "Hose channel open requires a body",
  );
  expect(events.error).not.toHaveBeenCalled();
  expect(sibling.error).not.toHaveBeenCalled();
  expect(link.sent).toEqual([
    { type: "open", id: "hose-1", body: { type: "prices" } },
  ]);

  // A synchronous Link that sends again while the open is going out must not
  // make the open go out twice.
  const reentrant = new FakeLink();
  const other = new HoseClient(() => reentrant);
  reentrant.state = "open";
  const opened: { channel?: ReturnType<HoseClient["openChannel"]> } = {};
  const send = reentrant.send.bind(reentrant);
  reentrant.send = (msg) => {
    send(msg);
    if (reentrant.sent.length === 1) opened.channel?.send("again");
  };
  opened.channel = other.openChannel("request", events);
  opened.channel.send("first");
  expect(reentrant.sent.filter((msg) => msg.type === "open")).toHaveLength(1);
  client.disconnect();
  other.disconnect();
});
