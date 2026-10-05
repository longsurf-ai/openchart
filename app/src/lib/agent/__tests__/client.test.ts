// Purpose: Verify Agent and Feed share a socket while late observers request snapshots without event replay, and that a desktop token rides every channel.

import { EventSource as FetchEventSource } from "eventsource";
import { Subject } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";

import { createAgentClient } from "@openchart/app/lib/agent/client";
import { FeedTransport } from "@openchart/app/lib/feed/transport";
import {
  createTransport,
  type AppEventFrame,
} from "@openchart/app/lib/transport/transport";

const rpc = vi.hoisted(() => ({
  events: { subscribe: { subscribe: vi.fn() } },
  agent: { requestSnapshot: { mutate: vi.fn(async () => {}) } },
  feed: { version: { query: vi.fn(async () => "current") } },
}));
const links = vi.hoisted(() => ({
  httpLink: vi.fn(),
  httpSubscriptionLink: vi.fn(),
}));
vi.mock("@trpc/client", async (original) => ({
  ...(await original<typeof import("@trpc/client")>()),
  createTRPCClient: () => rpc,
  ...links,
}));
afterEach(() => vi.unstubAllGlobals());

it("notifies the directory once per metadata or Run change and ignores transcript changes", () => {
  const events = new Subject<AppEventFrame>();
  const remote = createAgentClient({
    ...createTransport({ origin: "http://127.0.0.1:43873" }),
    events,
  });
  const changed = vi.fn();
  const subscription = remote.directoryChanges.subscribe(changed);
  const metadata = {
    op: "add",
    path: "/session",
    value: {
      id: "ses_a",
      parentId: null,
      title: "Research",
      createdAt: 1,
      updatedAt: 2,
    },
  };
  const runs = { op: "add", path: "/runs", value: [] };
  for (const delta of [
    [{ op: "add", path: "/messageInfo", value: {} }],
    [metadata],
    [runs],
    [metadata, runs],
  ]) {
    events.next({
      kind: "event",
      event: {
        id: "evt_change" as never,
        type: "agent.event",
        data: { sessionID: "ses_a", event: { type: "STATE_DELTA", delta } },
      },
    });
  }
  expect(changed).toHaveBeenCalledTimes(3);
  subscription.unsubscribe();
});

it.each([
  { id: "ses_a" },
  {
    id: "ses_other",
    parentId: null,
    title: "Wrong Session",
    createdAt: 1,
    updatedAt: 2,
  },
])(
  "rejects invalid metadata even when the frame also changes Runs: %j",
  (value) => {
    const events = new Subject<AppEventFrame>();
    const remote = createAgentClient({
      ...createTransport({ origin: "http://127.0.0.1:43873" }),
      events,
    });
    const changed = vi.fn();
    const failed = vi.fn();
    const subscription = remote.directoryChanges.subscribe({
      next: changed,
      error: failed,
    });
    events.next({
      kind: "event",
      event: {
        id: "evt_invalid" as never,
        type: "agent.event",
        data: {
          sessionID: "ses_a",
          event: {
            type: "STATE_DELTA",
            delta: [
              { op: "add", path: "/runs", value: [] },
              { op: "add", path: "/session", value },
            ],
          },
        },
      },
    });
    expect(changed).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    expect(subscription.closed).toBe(true);
  },
);

it("shares readiness and reconnect with Agent/Feed while never replaying old events", async () => {
  let listener!: {
    onData: (frame: AppEventFrame) => void;
    onConnectionStateChange: (connection: { state: string }) => void;
  };
  const unsubscribe = vi.fn();
  rpc.events.subscribe.subscribe.mockImplementation((_input, callbacks) => {
    listener = callbacks;
    return { unsubscribe };
  });
  const transport = createTransport({ origin: "http://127.0.0.1:43873" });
  const remote = createAgentClient(transport);
  const feed = new FeedTransport(transport);
  const first = transport.events.subscribe();
  listener.onData({ kind: "ready" });
  const before = transport.events.subscribe();
  const message = remote.observe("ses_a").subscribe();
  const values: string[] = [];
  const version = feed.watchVersion().subscribe((value) => values.push(value));
  await vi.waitFor(() => expect(values).toEqual(["current"]));
  expect(rpc.agent.requestSnapshot.mutate).toHaveBeenCalledExactlyOnceWith({
    sessionID: "ses_a",
  });
  expect(rpc.events.subscribe.subscribe).toHaveBeenCalledOnce();
  listener.onData({
    kind: "event",
    event: { id: "evt_old" as never, type: "unrelated", data: {} },
  });
  const lateFrames: AppEventFrame[] = [];
  const late = transport.events.subscribe((frame) => lateFrames.push(frame));
  expect(lateFrames).toEqual([{ kind: "ready" }]);
  listener.onConnectionStateChange({ state: "connecting" });
  listener.onData({ kind: "ready" });
  expect(rpc.agent.requestSnapshot.mutate).toHaveBeenCalledTimes(2);
  expect(rpc.feed.version.query).toHaveBeenCalledTimes(2);
  message.unsubscribe();
  first.unsubscribe();
  before.unsubscribe();
  late.unsubscribe();
  expect(unsubscribe).not.toHaveBeenCalled();
  version.unsubscribe();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it("sends a desktop token as a Bearer header on HTTP and SSE and as a query on Hose", async () => {
  const webSocket = vi.fn(() => ({ readyState: 0, close: vi.fn() }));
  vi.stubGlobal("WebSocket", webSocket);
  const transport = createTransport({
    origin: "https://127.0.0.1:52341",
    token: "run-secret",
  });
  expect(transport.url).toBe("https://127.0.0.1:52341/trpc");
  expect(webSocket).not.toHaveBeenCalled();
  transport.hose.connect();
  expect(webSocket).toHaveBeenCalledExactlyOnceWith(
    "wss://127.0.0.1:52341/hose?token=run-secret",
  );
  transport.hose.disconnect();
  expect(links.httpLink).toHaveBeenLastCalledWith({
    url: transport.url,
    headers: { authorization: "Bearer run-secret" },
  });
  const subscription = links.httpSubscriptionLink.mock.lastCall![0];
  expect(subscription.url).toBe(transport.url);
  expect(subscription.EventSource).toBe(FetchEventSource);
  const fetch = vi.fn(async () => new Response());
  vi.stubGlobal("fetch", fetch);
  await subscription.eventSourceOptions.fetch(`${transport.url}/events`, {
    headers: { Accept: "text/event-stream" },
    mode: "cors",
    cache: "no-store",
    redirect: "follow",
  });
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`${transport.url}/events`, {
    headers: {
      Accept: "text/event-stream",
      authorization: "Bearer run-secret",
    },
    mode: "cors",
    cache: "no-store",
    redirect: "follow",
  });
  class Injected {}
  createTransport(
    { origin: "https://127.0.0.1:52341", token: "run-secret" },
    { EventSource: Injected as never },
  );
  expect(links.httpSubscriptionLink.mock.lastCall![0].EventSource).toBe(
    Injected,
  );
});

it("sends nothing extra without a token and keeps the native EventSource", () => {
  const webSocket = vi.fn(() => ({ readyState: 0, close: vi.fn() }));
  vi.stubGlobal("WebSocket", webSocket);
  const transport = createTransport({ origin: "http://127.0.0.1:43874" });
  expect(transport.url).toBe("http://127.0.0.1:43874/trpc");
  expect(webSocket).not.toHaveBeenCalled();
  transport.hose.connect();
  expect(webSocket).toHaveBeenCalledExactlyOnceWith(
    "ws://127.0.0.1:43874/hose",
  );
  transport.hose.disconnect();
  expect(links.httpLink.mock.lastCall![0]).toEqual({ url: transport.url });
  expect(links.httpLink.mock.lastCall![0].headers).toBeUndefined();
  const subscription = links.httpSubscriptionLink.mock.lastCall![0];
  expect(subscription).toEqual({ url: transport.url });
  expect(subscription.EventSource).toBeUndefined();
  expect(subscription.eventSourceOptions).toBeUndefined();
});
