// Purpose: Verify shared event invalidations, reconnect resync, and stale version response rejection.
import { describe, expect, it, vi } from "vitest";

import { FeedTransport } from "@openchart/app/lib/feed/transport";
import { createTransport } from "@openchart/app/lib/transport/transport";

const rpc = vi.hoisted(() => ({
  events: { subscribe: { subscribe: vi.fn() } },
  feed: { version: { query: vi.fn() } },
}));
vi.mock("@trpc/client", async (original) => ({
  ...(await original<typeof import("@trpc/client")>()),
  createTRPCClient: () => rpc,
}));

describe("Feed version observation", () => {
  it("reads current state after connection/Feed events and ignores superseded responses", async () => {
    const requests: {
      signal: AbortSignal;
      resolve: (value: string) => void;
    }[] = [];
    rpc.feed.version.query.mockImplementation(
      (_input: unknown, options: { signal: AbortSignal }) =>
        new Promise<string>((resolve) =>
          requests.push({ signal: options.signal, resolve }),
        ),
    );
    let listener!: {
      onStarted?: () => void;
      onData: (
        frame: { kind: "ready" } | { kind: "event"; event: { type: string } },
      ) => void;
      onConnectionStateChange: (state: { state: string }) => void;
    };
    const unsubscribe = vi.fn();
    rpc.events.subscribe.subscribe.mockImplementation((_input, callbacks) => {
      listener = callbacks;
      return { unsubscribe };
    });
    const transport = new FeedTransport(
      createTransport({ origin: "http://127.0.0.1:43873" }),
    );
    const values: string[] = [];
    const subscription = transport
      .watchVersion()
      .subscribe((version) => values.push(version));
    try {
      expect(requests).toHaveLength(0);
      listener.onStarted?.();
      expect(requests).toHaveLength(0);
      listener.onData({ kind: "ready" });
      expect(requests).toHaveLength(1);
      listener.onData({ kind: "event", event: { type: "resource.changed" } });
      expect(requests).toHaveLength(1);
      listener.onData({
        kind: "event",
        event: { type: "feed.version.changed" },
      });
      expect(requests[0]!.signal.aborted).toBe(true);
      requests[1]!.resolve("new");
      await vi.waitFor(() => expect(values).toEqual(["new"]));
      // Simulate an HTTP response that arrived too late to be cancelled.
      requests[0]!.resolve("old");
      await Promise.resolve();
      expect(values).toEqual(["new"]);

      listener.onData({
        kind: "event",
        event: { type: "feed.version.changed" },
      });
      listener.onConnectionStateChange({ state: "connecting" });
      expect(requests[2]!.signal.aborted).toBe(true);
      listener.onStarted?.();
      listener.onData({ kind: "ready" });
      requests[3]!.resolve("after-reconnect");
      await vi.waitFor(() =>
        expect(values).toEqual(["new", "after-reconnect"]),
      );
      requests[2]!.resolve("before-reconnect");
      await Promise.resolve();
      expect(values).toEqual(["new", "after-reconnect"]);

      listener.onData({
        kind: "event",
        event: { type: "feed.version.changed" },
      });
      subscription.unsubscribe();
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(requests[4]!.signal.aborted).toBe(true);
      requests[4]!.resolve("after-unsubscribe");
      await Promise.resolve();
      expect(values).toEqual(["new", "after-reconnect"]);
    } finally {
      subscription.unsubscribe();
    }
  });
});
