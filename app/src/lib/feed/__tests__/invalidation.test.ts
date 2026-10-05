// Purpose: Verify bulk catalog commits refresh local searches and counts without a live-query feedback loop.
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { Subject } from "rxjs";
import { expect, test, vi } from "vitest";
import type { AppEventFrame } from "@openchart/app/lib/transport/transport";
import { subscribeResourceInvalidation } from "@openchart/app/lib/resource/invalidation";
import { subscribeSymbologyInvalidation } from "@openchart/app/lib/feed/invalidation";

test("1000 committed listing events coalesce while live search remains untouched", async () => {
  const events = new Subject<AppEventFrame>();
  const transport = { events };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const keys = [
    ["v1", "symbology", "search", { query: "BTC", indexed: true }],
    ["v1", "symbology", "search", { query: "BTC", indexed: false }],
    [["resources", "symbology"], "counts"],
  ];
  const fetchers = keys.map(() => vi.fn(async () => "fresh"));
  const observers = keys.map((queryKey, i) => {
    client.setQueryData(queryKey, "before");
    return new QueryObserver(client, {
      queryKey,
      queryFn: fetchers[i]!,
    }).subscribe(() => {});
  });
  const feed = subscribeSymbologyInvalidation(transport, client);
  const resources = subscribeResourceInvalidation(transport, client);
  try {
    for (let i = 0; i < 1000; i++)
      events.next({
        kind: "event",
        event: {
          id: `evt_${i}` as never,
          type: "resource.changed",
          data: { resource: "symbology", id: `sym_${i}`, revision: 1 },
        },
      });
    await vi.waitFor(() => expect(fetchers[0]).toHaveBeenCalledTimes(1));
    expect(fetchers[1]).not.toHaveBeenCalled();
    expect(fetchers[2]).toHaveBeenCalledTimes(1);
    events.next({ kind: "ready" });
    await vi.waitFor(() => expect(fetchers[0]).toHaveBeenCalledTimes(2));
    expect(fetchers[1]).not.toHaveBeenCalled();
  } finally {
    feed.unsubscribe();
    resources.unsubscribe();
    observers.forEach((unsubscribe) => unsubscribe());
    client.clear();
  }
});
