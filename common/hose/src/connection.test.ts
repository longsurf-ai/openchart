// Purpose: Locks Hose server multiplexing, protocol failure, and exactly-once teardown.

import { expect, test, vi } from "vitest";

import { encode, type ServerMsg } from "./protocol";
import { HoseRouter } from "./router";
import { type Channel, HoseConnection } from "./connection";

function setup(router?: HoseRouter) {
  const sent: ServerMsg[] = [];
  const closed: Array<[number | undefined, string | undefined]> = [];
  const teardown: string[] = [];
  const server = new HoseConnection(
    {
      send(msg) {
        sent.push(JSON.parse(msg) as ServerMsg);
        return true;
      },
      bufferedAmount: 0,
      close(code, reason) {
        closed.push([code, reason]);
      },
    },
    router ??
      new HoseRouter().route("echo", (body, channel) => {
        channel.data(body);
        return () => teardown.push(channel.id);
      }),
    undefined,
  );
  return { server, sent, closed, teardown };
}

test("installs registrations while keeping routing failures and teardown channel-local", () => {
  const active: Channel[] = [];
  const stopLive = vi.fn();
  const stopOnce = vi.fn();
  const router = new HoseRouter()
    .route("live", (_body, channel) => {
      active.push(channel);
      channel.data("snapshot");
      return stopLive;
    })
    .route("once", (_body, channel) => {
      channel.data(42);
      channel.done();
      return stopOnce;
    });
  const first = setup(router);
  const second = setup(router);
  for (const state of [first, second]) {
    state.server.receive(
      encode({ type: "open", id: "live", body: { type: "live" } }),
    );
  }
  first.server.receive(
    encode({ type: "open", id: "once", body: { type: "once" } }),
  );
  first.server.receive(encode({ type: "open", id: "invalid", body: {} }));
  first.server.receive(
    encode({ type: "open", id: "unknown", body: { type: "missing" } }),
  );
  expect(first.sent).toEqual([
    { type: "data", id: "live", body: "snapshot" },
    { type: "data", id: "once", body: 42 },
    { type: "done", id: "once" },
    { type: "error", id: "invalid", code: "invalid_request" },
    { type: "error", id: "unknown", code: "not_found" },
  ]);
  expect(stopOnce).toHaveBeenCalledOnce();
  expect(stopLive).not.toHaveBeenCalled();
  expect(first.closed).toEqual([]);
  active[0]!.data("update");
  expect(first.sent.at(-1)).toEqual({
    type: "data",
    id: "live",
    body: "update",
  });
  first.server.receive(encode({ type: "close", id: "live" }));
  first.server.dispose();
  expect(stopLive).toHaveBeenCalledOnce();
  active[1]!.data("still live");
  expect(second.sent.at(-1)).toEqual({
    type: "data",
    id: "live",
    body: "still live",
  });
  second.server.dispose();
  second.server.dispose();
  expect(stopLive).toHaveBeenCalledTimes(2);
  expect(stopOnce).toHaveBeenCalledOnce();
});

test("multiplexes channels and tears down only the closed one", () => {
  const state = setup();
  state.server.receive(
    encode({ type: "open", id: "a", body: { type: "echo", value: 1 } }),
  );
  state.server.receive(
    encode({ type: "open", id: "b", body: { type: "echo", value: 2 } }),
  );
  state.server.receive(encode({ type: "close", id: "a" }));
  expect(state.sent).toEqual([
    { type: "data", id: "a", body: { type: "echo", value: 1 } },
    { type: "data", id: "b", body: { type: "echo", value: 2 } },
  ]);
  expect(state.teardown).toEqual(["a"]);
  state.server.dispose();
  expect(state.teardown).toEqual(["a", "b"]);
});

test("malformed input closes the connection", () => {
  const state = setup();
  state.server.receive("{");
  expect(state.closed).toEqual([[1002, "protocol_error"]]);
});

test("duplicate channel id closes the connection", () => {
  const state = setup();
  state.server.receive(
    encode({ type: "open", id: "a", body: { type: "echo", value: 1 } }),
  );
  state.server.receive(
    encode({ type: "open", id: "a", body: { type: "echo", value: 2 } }),
  );
  expect(state.closed).toEqual([[1002, "protocol_error"]]);
  expect(state.teardown).toEqual(["a"]);
});

test("does not expose a channel handler exception", () => {
  const sent: ServerMsg[] = [];
  const router = new HoseRouter();
  const server = new HoseConnection(
    {
      send(msg) {
        sent.push(JSON.parse(msg) as ServerMsg);
        return true;
      },
      bufferedAmount: 0,
      close: () => {},
    },
    router,
    undefined,
  );
  router.route("echo", () => {
    throw new Error("database password");
  });
  server.receive(encode({ type: "open", id: "a", body: { type: "echo" } }));
  expect(sent).toEqual([{ type: "error", id: "a", code: "internal" }]);
});

test("rejects invalid channel output before sending it", () => {
  let active: Channel | undefined;
  const sent: ServerMsg[] = [];
  const router = new HoseRouter();
  const server = new HoseConnection(
    {
      send(msg) {
        sent.push(JSON.parse(msg) as ServerMsg);
        return true;
      },
      bufferedAmount: 0,
      close: () => {},
    },
    router,
    undefined,
  );
  router.route("echo", (_body, channel) => {
    active = channel;
  });
  server.receive(encode({ type: "open", id: "a", body: { type: "echo" } }));
  const channel = active;
  if (!channel) throw new Error("Hose test did not open its channel");
  expect(() => channel.data(undefined)).toThrow("requires a body");
  expect(() => channel.error("failed", undefined)).toThrow("require a body");
  expect(sent).toEqual([]);
  server.dispose();
});

test("preserves an error thrown after synchronous completion", () => {
  const sent: ServerMsg[] = [];
  const router = new HoseRouter();
  const server = new HoseConnection(
    {
      send(msg) {
        sent.push(JSON.parse(msg) as ServerMsg);
        return true;
      },
      bufferedAmount: 0,
      close: () => {},
    },
    router,
    undefined,
  );
  router.route("echo", (_body, channel) => {
    channel.done();
    throw new Error("after done");
  });
  expect(() =>
    server.receive(encode({ type: "open", id: "a", body: { type: "echo" } })),
  ).toThrow("after done");
  expect(sent).toEqual([{ type: "done", id: "a" }]);
});

test("disposes every channel when one teardown throws", () => {
  const teardown: string[] = [];
  const router = new HoseRouter();
  const server = new HoseConnection(
    {
      send: () => true,
      bufferedAmount: 0,
      close: () => {},
    },
    router,
    undefined,
  );
  router.route("echo", (_body, channel) => () => {
    teardown.push(channel.id);
    if (channel.id === "a") throw new Error("teardown failed");
  });
  server.receive(encode({ type: "open", id: "a", body: { type: "echo" } }));
  server.receive(encode({ type: "open", id: "b", body: { type: "echo" } }));
  expect(() => server.dispose()).toThrow("teardown failed");
  expect(teardown).toEqual(["a", "b"]);
  server.dispose();
  expect(teardown).toEqual(["a", "b"]);
});

test("a duplex handler echoes client data in order and tears down once", () => {
  const teardown = vi.fn();
  const state = setup(
    new HoseRouter().route("echo", (_body, channel) => {
      channel.onData((body) => {
        if (body === "stop") channel.done();
        else channel.data(body);
      });
      return teardown;
    }),
  );
  state.server.receive(
    encode({ type: "open", id: "a", body: { type: "echo" } }),
  );
  state.server.receive(encode({ type: "data", id: "a", body: "first" }));
  state.server.receive(encode({ type: "data", id: "a", body: { n: 2 } }));
  state.server.receive(encode({ type: "data", id: "a", body: "stop" }));
  // The client could not yet know the channel finished: late data is ignored.
  state.server.receive(encode({ type: "data", id: "a", body: "late" }));
  state.server.receive(encode({ type: "close", id: "a" }));
  expect(state.sent).toEqual([
    { type: "data", id: "a", body: "first" },
    { type: "data", id: "a", body: { n: 2 } },
    { type: "done", id: "a" },
  ]);
  expect(state.closed).toEqual([]);
  state.server.dispose();
  expect(teardown).toHaveBeenCalledOnce();
});

test("ignores data for an unknown id and drops data without a listener", () => {
  const state = setup();
  state.server.receive(encode({ type: "data", id: "never", body: "lost" }));
  state.server.receive(
    encode({ type: "open", id: "a", body: { type: "echo", value: 1 } }),
  );
  state.server.receive(encode({ type: "data", id: "a", body: "dropped" }));
  expect(state.sent).toEqual([
    { type: "data", id: "a", body: { type: "echo", value: 1 } },
  ]);
  expect(state.closed).toEqual([]);
  expect(state.teardown).toEqual([]);
  // A data envelope without a body is still a protocol error.
  state.server.receive(JSON.stringify({ type: "data", id: "a" }));
  expect(state.closed).toEqual([[1002, "protocol_error"]]);
  expect(state.teardown).toEqual(["a"]);
});

test("a throwing data listener fails only its channel without exposing the cause", () => {
  const teardown: string[] = [];
  const state = setup(
    new HoseRouter().route("echo", (_body, channel) => {
      channel.onData((body) => {
        if (body === "bad") throw new Error("database password");
        channel.data(body);
      });
      return () => teardown.push(channel.id);
    }),
  );
  for (const id of ["a", "b"])
    state.server.receive(encode({ type: "open", id, body: { type: "echo" } }));
  state.server.receive(encode({ type: "data", id: "a", body: "bad" }));
  state.server.receive(encode({ type: "data", id: "b", body: "fine" }));
  expect(state.sent).toEqual([
    { type: "error", id: "a", code: "internal" },
    { type: "data", id: "b", body: "fine" },
  ]);
  expect(state.closed).toEqual([]);
  expect(teardown).toEqual(["a"]);
  state.server.dispose();
  expect(teardown).toEqual(["a", "b"]);
});

test("preserves a data listener error thrown after it ended its channel", () => {
  const state = setup(
    new HoseRouter().route("echo", (_body, channel) => {
      channel.onData(() => {
        channel.done();
        throw new Error("after done");
      });
    }),
  );
  state.server.receive(
    encode({ type: "open", id: "a", body: { type: "echo" } }),
  );
  expect(() =>
    state.server.receive(encode({ type: "data", id: "a", body: 1 })),
  ).toThrow("after done");
  expect(state.sent).toEqual([{ type: "done", id: "a" }]);
  expect(state.closed).toEqual([]);
});

test("failed errors send the owner's body and Hose codes send none", () => {
  const router = new HoseRouter()
    .route("failed", (_body, channel) => {
      channel.error("failed", { reason: "rate" });
      return () => {};
    })
    .route("internal", (_body, channel) => {
      channel.error("internal");
      return () => {};
    });
  const state = setup(router);
  state.server.receive(
    encode({ type: "open", id: "failed", body: { type: "failed" } }),
  );
  state.server.receive(
    encode({ type: "open", id: "internal", body: { type: "internal" } }),
  );
  expect(state.sent).toEqual([
    { type: "error", id: "failed", code: "failed", body: { reason: "rate" } },
    { type: "error", id: "internal", code: "internal" },
  ]);
});
