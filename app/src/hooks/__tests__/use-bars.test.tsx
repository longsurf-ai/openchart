import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import { findErrorToast } from "@openchart/app/testing/test-utils";
// Purpose: Verify latest-request subscriptions and keep/clear display through the public hooks.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  BarsRequest,
  ClientFailures,
  FeedVersion,
  FeedError,
  FeedReasons,
  type BarsMessage,
} from "@openchart/feed";
import { BarColumns, ProviderId } from "@openchart/market";
import { defineDataFrame } from "@openchart/timeseries";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  renderHook,
  waitFor,
  within,
} from "@testing-library/react";
import { Schema } from "effect";
import { useSubscription } from "observable-hooks";
import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { EMPTY, Observable, ReplaySubject, type Subscriber } from "rxjs";
import { expect, it, vi } from "vitest";

import {
  FeedProvider,
  FeedReactContext,
  FeedTransport,
  type FeedClient,
  type UseBarsOptions,
} from "@openchart/app/feed";
import { useBars, useBarsCapabilities } from "@openchart/app/hooks/use-bars";
import { useCalendar } from "@openchart/app/hooks/use-calendar";
import { useDatafeed, useFeedVersion } from "@openchart/app/hooks/use-datafeed";
import { useLogo } from "@openchart/app/hooks/use-logo";
import { useSymbology } from "@openchart/app/hooks/use-symbology";
import { observeBars } from "@openchart/app/lib/feed/bars";
import { createTransport } from "@openchart/app/lib/transport/transport";
import { FeedVersionContext } from "@openchart/app/lib/feed/provider";

const request = Schema.decodeUnknownSync(BarsRequest)({
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "BINANCE",
    currency: "USDT",
  },
  resolution: "1m",
  session: "24h",
  adjustment: "raw",
  from: 0,
  to: "now",
  countBack: 500,
});
const NativeBars = defineDataFrame({
  ...BarColumns,
  asOf: Schema.Finite,
  final: Schema.Boolean,
});
const frame = (time: number, close = 2) =>
  NativeBars.create({
    labels: { symbol: "BTCUSDT" },
    rows: [
      {
        time,
        open: 1,
        high: close,
        low: 1,
        close,
        volume: 1,
        asOf: 100,
        final: false,
      },
    ],
  });
const snapshot = (input: BarsRequest, close = 2): BarsMessage => ({
  type: "snapshot",
  snapshot: {
    data: frame(input.from + 1, close),
    range: {
      from: input.from,
      to: typeof input.to === "number" ? input.to : input.from + 1000,
    },
    hasMoreBefore: false,
  },
});
function setup(automatic = true) {
  const calls: Array<{
    request: BarsRequest;
    sink: Subscriber<BarsMessage>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const client: FeedClient = {
    close: vi.fn(),
    bars: {
      observe: vi.fn((input) =>
        observeBars(
          new Observable((sink) => {
            const stop = vi.fn();
            calls.push({ request: input, sink, stop });
            if (automatic) sink.next(snapshot(input));
            return stop;
          }),
          input,
        ),
      ),
      getCapabilities: vi.fn(),
    },
    symbology: {
      index: vi.fn(),
      indexStatus: vi.fn().mockResolvedValue([]),
      search: vi.fn(),
    },
    logos: { getLogo: vi.fn() },
    series: { select: vi.fn() },
    calendar: { getCalendar: vi.fn() },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FeedReactContext.Provider value={client}>
      {children}
    </FeedReactContext.Provider>
  );
  return { client, calls, wrapper };
}

it("explicit live search refetches a recently cached key on every selection", async () => {
  const { client } = setup();
  const search = vi.spyOn(client.symbology, "search").mockResolvedValue([]);
  const version = FeedVersion.make("live-search");
  const query = { query: "BTC", limit: 30, indexed: false };
  const queries = createQueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  queries.setQueryData([version, "symbology", "search", query], []);
  queries.setQueryData(
    [version, "symbology", "search", { ...query, indexed: true }],
    [],
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <FeedReactContext.Provider value={client}>
        <FeedVersionContext.Provider value={version}>
          {children}
        </FeedVersionContext.Provider>
      </FeedReactContext.Provider>
    </QueryClientProvider>
  );
  const view = renderHook(
    ({ indexed }) => useSymbology({ ...query, indexed }),
    { wrapper, initialProps: { indexed: true } },
  );
  try {
    expect(search).not.toHaveBeenCalled();
    view.rerender({ indexed: false });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    view.rerender({ indexed: true });
    view.rerender({ indexed: false });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  } finally {
    view.unmount();
    queries.clear();
  }
});

it("cleans StrictMode subscriptions and ignores equal request objects", () => {
  const { client, calls } = setup();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <FeedReactContext.Provider value={client}>
        {children}
      </FeedReactContext.Provider>
    </StrictMode>
  );
  const view = renderHook(({ input }) => useBars(input), {
    wrapper,
    initialProps: { input: request },
  });
  expect(view.result.current.status).toBe("ready");
  expect(calls).toHaveLength(2);
  expect(calls[0]!.stop).toHaveBeenCalledOnce();
  view.rerender({ input: { ...request, listing: { ...request.listing } } });
  expect(calls).toHaveLength(2);
  view.rerender({ input: { ...request, countBack: 100 } });
  expect(calls).toHaveLength(3);
  expect(calls[1]!.stop).toHaveBeenCalledOnce();
  view.unmount();
  expect(calls[2]!.stop).toHaveBeenCalledOnce();
});

const changes = [
  { name: "time window", input: { ...request, from: 200, to: 300 } },
  { name: "resolution", input: { ...request, resolution: "5m" as const } },
  {
    name: "ticker",
    input: { ...request, listing: { ...request.listing, symbol: "ETHUSDT" } },
  },
] as const;
it.each(changes)(
  "keep stops the old $name subscription and retains its last accepted data",
  ({ input }) => {
    const { calls, wrapper } = setup(false);
    const view = renderHook(({ input }) => useBars(input), {
      wrapper,
      initialProps: { input: request },
    });
    act(() => calls[0]!.sink.next(snapshot(request)));
    const old = view.result.current.current!;
    act(() => calls[0]!.sink.next({ type: "updates", data: frame(1, 3) }));
    view.rerender({ input });
    expect(calls[0]!.stop).toHaveBeenCalledOnce();
    expect(view.result.current.status).toBe("loading");
    expect(view.result.current.current).toBe(old);
    act(() => calls[0]!.sink.next({ type: "updates", data: frame(1, 99) }));
    let price = old.data.get(0)!.close;
    const complete = vi.fn();
    old.updates.subscribe({
      next: (batch) => {
        price = batch.get(0)!.close;
      },
      complete,
    });
    expect(price).toBe(3);
    expect(complete).toHaveBeenCalledOnce();
    act(() => calls[1]!.sink.next(snapshot(input, 4)));
    expect(view.result.current.current?.request).toEqual(input);
    expect(view.result.current.current?.data.get(0)!.close).toBe(4);
    view.unmount();
  },
);

it.each(changes)(
  "clear hides the old $name view during loading and failure",
  ({ input }) => {
    const { calls, wrapper } = setup(false);
    const view = renderHook(
      ({ input }) => useBars(input, { loadingBehavior: "clear" }),
      { wrapper, initialProps: { input: request } },
    );
    act(() => calls[0]!.sink.next(snapshot(request)));
    view.rerender({ input });
    expect(calls[0]!.stop).toHaveBeenCalledOnce();
    expect(view.result.current).toMatchObject({
      status: "loading",
      current: undefined,
    });
    act(() =>
      calls[1]!.sink.error(
        new FeedError({ reason: new FeedReasons.SourceUnavailable({}) }),
      ),
    );
    expect(view.result.current).toMatchObject({
      status: "error",
      current: undefined,
    });
    view.unmount();
  },
);

it("changes loading display policy without restarting requests", () => {
  const { calls, wrapper } = setup(false);
  const view = renderHook(({ input, options }) => useBars(input, options), {
    wrapper,
    initialProps: { input: request, options: {} as UseBarsOptions },
  });
  act(() => calls[0]!.sink.next(snapshot(request)));
  const old = view.result.current.current;
  const input = changes[0].input;
  view.rerender({ input, options: { loadingBehavior: "clear" } });
  expect(view.result.current.current).toBeUndefined();
  view.rerender({ input, options: { loadingBehavior: "keep" } });
  expect(view.result.current.current).toBe(old);
  expect(calls).toHaveLength(2);
  act(() => calls[1]!.sink.next(snapshot(input)));
  const current = view.result.current.current;
  view.rerender({ input, options: { loadingBehavior: "clear" } });
  expect(view.result.current.current).toBe(current);
  expect(calls).toHaveLength(2);
  view.unmount();
});

it("handles A to B to A and retries without accepting stopped producers", () => {
  const { calls, wrapper } = setup(false);
  const view = renderHook(({ input }) => useBars(input), {
    wrapper,
    initialProps: { input: request },
  });
  view.rerender({ input: changes[0].input });
  view.rerender({ input: { ...request } });
  expect(calls).toHaveLength(3);
  expect(calls[0]!.sink.closed).toBe(true);
  expect(calls[1]!.sink.closed).toBe(true);
  act(() => {
    calls[0]!.sink.next(snapshot(request, 99));
    calls[1]!.sink.error(new Error("old"));
  });
  expect(view.result.current).toMatchObject({
    status: "loading",
    current: undefined,
  });
  act(() => calls[2]!.sink.error(new ClientFailures.Disconnected()));
  expect(view.result.current.status).toBe("error");
  act(() => view.result.current.retry());
  expect(calls).toHaveLength(4);
  act(() => calls[3]!.sink.next(snapshot(request, 4)));
  expect(view.result.current.current?.data.get(0)!.close).toBe(4);
  view.rerender({ input: changes[0].input });
  view.unmount();
  expect(calls[4]!.stop).toHaveBeenCalledOnce();
  act(() => calls[4]!.sink.next(snapshot(changes[0].input, 99)));
});

it("preserves an accepted view on a stream error, including with clear loading behavior", () => {
  const { calls, wrapper } = setup();
  let executions = 0;
  const view = renderHook(
    () => {
      executions++;
      return useBars(request, { loadingBehavior: "clear" });
    },
    { wrapper },
  );
  const ready = view.result.current;
  const count = executions;
  act(() => calls[0]!.sink.next({ type: "updates", data: frame(1, 3) }));
  expect(executions).toBe(count);
  expect(view.result.current).toBe(ready);
  act(() => calls[0]!.sink.error(new ClientFailures.Disconnected()));
  expect(view.result.current).toMatchObject({
    status: "error",
    current: ready.current,
  });
  expect(calls[0]!.stop).toHaveBeenCalledOnce();
  act(() => view.result.current.retry());
  expect(calls).toHaveLength(2);
  expect(view.result.current.status).toBe("ready");
  view.unmount();
});

it("keeps independent subscriptions for two hook consumers", () => {
  const { calls, wrapper } = setup();
  const view = renderHook(() => [useBars(request), useBars(request)] as const, {
    wrapper,
  });
  expect(calls).toHaveLength(2);
  expect(view.result.current[0].current).not.toBe(
    view.result.current[1].current,
  );
  view.unmount();
  for (const call of calls) expect(call.stop).toHaveBeenCalledOnce();
});

it("retains the error and stopped view throughout backoff, then recovers only on a new snapshot", () => {
  vi.useFakeTimers();
  const { calls, wrapper } = setup(false);
  const view = renderHook(
    () => useBars(request, { loadingBehavior: "clear" }),
    { wrapper },
  );
  const failure = new FeedError({
    reason: new FeedReasons.IncompleteData({ provider: request.provider }),
  });
  try {
    act(() => calls[0]!.sink.next(snapshot(request)));
    const current = view.result.current.current;
    act(() => calls[0]!.sink.error(failure));
    expect(view.result.current).toMatchObject({
      status: "error",
      error: failure,
      current,
    });
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(calls).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(calls).toHaveLength(2);
    expect(view.result.current).toMatchObject({
      status: "error",
      error: failure,
      current,
    });
    act(() => calls[1]!.sink.error(failure));
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(calls).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(calls).toHaveLength(3);
    act(() => calls[2]!.sink.next(snapshot(request, 4)));
    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.current?.data.get(0)?.close).toBe(4);
    expect(view.result.current).not.toHaveProperty("error");
    // A valid snapshot re-earns the initial retry delay.
    act(() => calls[2]!.sink.error(failure));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(calls).toHaveLength(4);
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it("caps live failure backoff at thirty seconds and cancels it on unmount", () => {
  vi.useFakeTimers();
  const { calls, wrapper } = setup(false);
  const view = renderHook(() => useBars(request), { wrapper });
  try {
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      act(() => calls.at(-1)!.sink.error(new ClientFailures.Disconnected()));
      const count = calls.length;
      act(() => {
        vi.advanceTimersByTime(delay - 1);
      });
      expect(calls).toHaveLength(count);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(calls).toHaveLength(count + 1);
      expect(view.result.current.status).toBe("error");
    }
    act(() => calls.at(-1)!.sink.error(new ClientFailures.Disconnected()));
    const count = calls.length;
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(calls).toHaveLength(count);
    for (const call of calls) expect(call.stop).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it.each([
  {
    name: "historical reads",
    input: { ...request, to: 1000 },
    reason: new FeedReasons.IncompleteData({ provider: request.provider }),
  },
  {
    name: "denied access",
    input: request,
    reason: new FeedReasons.AccessDenied({ provider: request.provider }),
  },
  {
    name: "invalid source data",
    input: request,
    reason: new FeedReasons.InvalidSourceData({ provider: request.provider }),
  },
])("does not automatically retry $name", ({ input, reason }) => {
  vi.useFakeTimers();
  const { calls, wrapper } = setup(false);
  const view = renderHook(() => useBars(input), { wrapper });
  try {
    act(() => calls[0]!.sink.error(new FeedError({ reason })));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(calls).toHaveLength(1);
    expect(view.result.current.status).toBe("error");
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it("manual retry cancels backoff without clearing the error before a snapshot", () => {
  vi.useFakeTimers();
  const { calls, wrapper } = setup(false);
  const view = renderHook(() => useBars(request), { wrapper });
  try {
    act(() => calls[0]!.sink.error(new ClientFailures.Disconnected()));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => view.result.current.retry());
    expect(calls).toHaveLength(2);
    expect(view.result.current.status).toBe("error");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(calls).toHaveLength(2);
    act(() => calls[1]!.sink.next(snapshot(request)));
    expect(view.result.current.status).toBe("ready");
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it("cancels pending retries when the request or client changes", () => {
  vi.useFakeTimers();
  const first = setup(false);
  const second = setup(false);
  let client = first.client;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FeedReactContext.Provider value={client}>
      {children}
    </FeedReactContext.Provider>
  );
  const view = renderHook(({ input }) => useBars(input), {
    wrapper,
    initialProps: { input: request },
  });
  try {
    act(() => first.calls[0]!.sink.error(new ClientFailures.Disconnected()));
    view.rerender({ input: changes[2].input });
    expect(first.calls).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(first.calls).toHaveLength(2);
    act(() => first.calls[1]!.sink.error(new ClientFailures.Disconnected()));
    client = second.client;
    view.rerender({ input: changes[2].input });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(first.calls).toHaveLength(2);
    expect(second.calls).toHaveLength(1);
    expect(view.result.current.status).toBe("loading");
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it("applies loadingBehavior when the injected client changes", () => {
  const first = setup();
  const second = setup(false);
  let client = first.client;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FeedReactContext.Provider value={client}>
      {children}
    </FeedReactContext.Provider>
  );
  const view = renderHook(() => useBars(request), { wrapper });
  const old = view.result.current.current;
  client = second.client;
  view.rerender();
  expect(first.calls[0]!.stop).toHaveBeenCalledOnce();
  expect(view.result.current).toMatchObject({
    status: "loading",
    current: old,
  });
  act(() => second.calls[0]!.sink.next(snapshot(request)));
  expect(view.result.current.status).toBe("ready");
  view.unmount();
});

it("mounts consumers before a version while finite queries wait for readiness and respect enabled", async () => {
  const { client } = setup();
  const versions = new ReplaySubject<FeedVersion>(1);
  const transport = new FeedTransport(
    createTransport({ origin: "http://127.0.0.1:43873" }),
  );
  vi.spyOn(transport, "client").mockReturnValue(client);
  vi.spyOn(transport, "watchVersion").mockReturnValue(versions);
  const requests = [
    vi.spyOn(client.symbology, "search").mockResolvedValue([]),
    vi.spyOn(client.bars, "getCapabilities").mockResolvedValue([]),
    vi.spyOn(client.logos, "getLogo").mockResolvedValue(null),
    vi.spyOn(client.calendar, "getCalendar").mockResolvedValue({
      calendar: "24h",
      timezone: "UTC",
      days: [],
    }),
  ];
  const queries = createQueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <FeedProvider transport={transport}>
        <p>Settings</p>
        {children}
      </FeedProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    ({ enabled }) => ({
      version: useFeedVersion(),
      queries: [
        useSymbology({ query: "BTC", limit: 5, indexed: false }, { enabled }),
        useBarsCapabilities(request, { enabled }),
        useLogo(request.listing.symbol, { enabled }),
        useCalendar(
          {
            provider: request.provider,
            listing: request.listing,
            start: 0,
            end: 1000,
            timezone: "UTC",
          },
          { enabled },
        ),
      ],
    }),
    { wrapper, initialProps: { enabled: true } },
  );
  try {
    expect(screen.getByText("Settings")).toBeVisible();
    expect(view.result.current.version).toBeUndefined();
    for (const call of requests) expect(call).not.toHaveBeenCalled();
    act(() => versions.next(FeedVersion.make("one")));
    await waitFor(() => {
      for (const query of view.result.current.queries)
        expect(query.status).toBe("success");
    });
    view.rerender({ enabled: false });
    act(() => versions.next(FeedVersion.make("two")));
    for (const call of requests) expect(call).toHaveBeenCalledOnce();
    for (const query of view.result.current.queries)
      expect(query.fetchStatus).toBe("idle");
  } finally {
    view.unmount();
    queries.clear();
  }
});

it("useLogo skips empty identifiers, caches matches, and keeps errors separate from absence", async () => {
  const { client } = setup();
  const get = vi
    .spyOn(client.logos, "getLogo")
    .mockImplementation(async ({ identifier }) => {
      if (identifier === "broken")
        throw new FeedError({
          reason: new FeedReasons.NotFound({
            provider: ProviderId.make("openchart"),
          }),
        });
      return identifier === "BTC"
        ? { id: "crypto:btc", url: "data:image/svg+xml;base64,AA==" }
        : null;
    });
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <FeedReactContext.Provider value={client}>
        <FeedVersionContext.Provider value={FeedVersion.make("logos")}>
          {children}
        </FeedVersionContext.Provider>
      </FeedReactContext.Provider>
    </QueryClientProvider>
  );
  const view = renderHook(
    ({ identifier }: { identifier: string | undefined }) => useLogo(identifier),
    {
      wrapper,
      initialProps: { identifier: undefined as string | undefined },
    },
  );
  try {
    expect(get).not.toHaveBeenCalled();
    view.rerender({ identifier: " " });
    expect(get).not.toHaveBeenCalled();
    view.rerender({ identifier: "BTC" });
    await waitFor(() =>
      expect(view.result.current.data?.id).toBe("crypto:btc"),
    );
    view.rerender({ identifier: "unknown" });
    expect(view.result.current.data).toBeUndefined();
    await waitFor(() => expect(view.result.current.data).toBeNull());
    view.rerender({ identifier: "BTC" });
    expect(view.result.current.data?.id).toBe("crypto:btc");
    expect(get).toHaveBeenCalledTimes(2);
    view.rerender({ identifier: "broken" });
    await waitFor(() =>
      expect(view.result.current.error).toMatchObject({
        reason: { _tag: "Feed.NotFound" },
      }),
    );
    expect(view.result.current.data).toBeUndefined();
  } finally {
    view.unmount();
    queries.clear();
  }
});

it("useCalendar keeps a listing's days while its window moves, never another listing's", async () => {
  const { client } = setup();
  const pending: Array<() => void> = [];
  const get = vi.spyOn(client.calendar, "getCalendar").mockImplementation(
    (input) =>
      new Promise((resolve) =>
        pending.push(() =>
          resolve({
            calendar: input.listing.symbol,
            timezone: "UTC",
            days: [{ date: input.start, sessions: [] }],
          }),
        ),
      ),
  );
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <FeedReactContext.Provider value={client}>
        <FeedVersionContext.Provider value={FeedVersion.make("calendar")}>
          {children}
        </FeedVersionContext.Provider>
      </FeedReactContext.Provider>
    </QueryClientProvider>
  );
  const window = (symbol: string, start: number) => ({
    provider: request.provider,
    listing: { ...request.listing, symbol },
    start,
    end: start + 1000,
    timezone: "UTC",
  });
  const view = renderHook(
    ({ input }: { input: ReturnType<typeof window> }) => useCalendar(input),
    { wrapper, initialProps: { input: window("A", 0) } },
  );
  try {
    act(() => pending.shift()!());
    await waitFor(() => expect(view.result.current.data?.calendar).toBe("A"));
    view.rerender({ input: window("A", 1000) });
    expect(view.result.current.data?.days[0]?.date).toBe(0);
    act(() => pending.shift()!());
    await waitFor(() =>
      expect(view.result.current.data?.days[0]?.date).toBe(1000),
    );
    view.rerender({ input: window("B", 1000) });
    expect(view.result.current.data).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(3);
  } finally {
    view.unmount();
    queries.clear();
  }
});

it("keeps unrelated children mounted when initial version notifications fail", async () => {
  const { client } = setup();
  const versions = new ReplaySubject<FeedVersion>(1);
  const transport = new FeedTransport(
    createTransport({ origin: "http://127.0.0.1:43873" }),
  );
  vi.spyOn(transport, "client").mockReturnValue(client);
  vi.spyOn(transport, "watchVersion").mockReturnValue(versions);
  const unmount = vi.fn();
  function Settings() {
    useEffect(() => unmount, []);
    return <p>Settings</p>;
  }
  const view = render(
    <FeedProvider transport={transport}>
      <Settings />
    </FeedProvider>,
  );
  expect(screen.getByText("Settings")).toBeVisible();
  act(() => versions.error(new Error("notification connection failed")));
  // Raw text never reaches the UI; version watches always offer Retry.
  const notification = await findErrorToast(
    "Something went wrong while loading data.",
  );
  expect(notification).not.toHaveTextContent("notification connection failed");
  expect(
    within(notification).getByRole("button", { name: "Retry" }),
  ).toBeVisible();
  expect(screen.getByText("Settings")).toBeVisible();
  expect(unmount).not.toHaveBeenCalled();
  expect(client.close).not.toHaveBeenCalled();
  view.unmount();
  expect(unmount).toHaveBeenCalledOnce();
  expect(client.close).toHaveBeenCalledOnce();
});

it("owns client cleanup in StrictMode and never carries a version into another transport", () => {
  const versions = new ReplaySubject<FeedVersion>(1);
  versions.next(FeedVersion.make("one"));
  const nextVersions = new ReplaySubject<FeedVersion>(1);
  const clients: FeedClient[] = [];
  const first = new FeedTransport(
    createTransport({ origin: "http://127.0.0.1:43873" }),
  );
  const second = new FeedTransport(
    createTransport({ origin: "http://127.0.0.1:43874" }),
  );
  for (const transport of [first, second]) {
    vi.spyOn(transport, "client").mockImplementation(() => {
      const { client } = setup();
      clients.push(client);
      return client;
    });
  }
  vi.spyOn(first, "watchVersion").mockReturnValue(versions);
  vi.spyOn(second, "watchVersion").mockReturnValue(nextVersions);
  let transport = first;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <FeedProvider transport={transport}>{children}</FeedProvider>
    </StrictMode>
  );
  const observed: Array<{
    client: FeedClient;
    version: FeedVersion | undefined;
  }> = [];
  const view = renderHook(
    () => {
      const state = { client: useDatafeed(), version: useFeedVersion() };
      observed.push(state);
      return state;
    },
    { wrapper },
  );
  expect(clients).toHaveLength(2);
  expect(clients[0]!.close).toHaveBeenCalledOnce();
  expect(clients[1]!.close).not.toHaveBeenCalled();
  expect(view.result.current.version).toBe("one");
  transport = second;
  view.rerender();
  expect(clients).toHaveLength(3);
  expect(clients[1]!.close).toHaveBeenCalledOnce();
  expect(clients[2]!.close).not.toHaveBeenCalled();
  expect(view.result.current).toEqual({
    client: clients[2],
    version: undefined,
  });
  expect(observed).not.toContainEqual({ client: clients[2], version: "one" });
  expect(versions.observed).toBe(false);
  expect(nextVersions.observed).toBe(true);
  act(() => nextVersions.next(FeedVersion.make("two")));
  expect(view.result.current.version).toBe("two");
  view.unmount();
  for (const client of clients) expect(client.close).toHaveBeenCalledOnce();
  expect(nextVersions.observed).toBe(false);
});

it("version events preserve the client, pending queries, and calls while moving cache identity", async () => {
  const { client, calls } = setup();
  const versions = new ReplaySubject<FeedVersion>(1);
  versions.next(Schema.decodeUnknownSync(FeedVersion)("one"));
  const transport = new FeedTransport(
    createTransport({ origin: "http://127.0.0.1:43873" }),
  );
  const create = vi.spyOn(transport, "client").mockReturnValue(client);
  vi.spyOn(transport, "watchVersion").mockReturnValue(versions);
  let finish!: (
    value: Awaited<ReturnType<typeof client.symbology.search>>,
  ) => void;
  const search = vi
    .spyOn(client.symbology, "search")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue([]);
  const queries = createQueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>
      <FeedProvider transport={transport}>{children}</FeedProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () => ({
      client: useDatafeed(),
      version: useFeedVersion(),
      bars: useBars(request),
      symbols: useSymbology({ query: "BTC", limit: 5, indexed: false }),
    }),
    { wrapper },
  );
  try {
    await waitFor(() => expect(view.result.current?.bars.status).toBe("ready"));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    const bars = view.result.current.bars;
    act(() => versions.next(Schema.decodeUnknownSync(FeedVersion)("two")));
    await waitFor(() => expect(view.result.current.symbols.data).toEqual([]));
    expect(view.result.current.version).toBe("two");
    expect(view.result.current.client).toBe(client);
    expect(view.result.current.bars).toBe(bars);
    expect(create).toHaveBeenCalledOnce();
    expect(client.close).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sink.closed).toBe(false);
    expect(search.mock.calls[0]).toEqual([
      { query: "BTC", limit: 5, indexed: false },
    ]);
    const oldResult = [
      { provider: request.provider, listing: request.listing },
    ];
    await act(async () => {
      finish(oldResult);
    });
    await waitFor(() =>
      expect(
        queries.getQueryData([
          "one",
          "symbology",
          "search",
          { query: "BTC", limit: 5, indexed: false },
        ]),
      ).toEqual(oldResult),
    );
    expect(view.result.current.symbols.data).toEqual([]);
    act(() => calls[0]!.sink.complete());
    expect(view.result.current.bars).toBe(bars);
    expect(calls[0]!.stop).toHaveBeenCalledOnce();
    act(() => versions.error(new Error("notification connection failed")));
    expect(view.result.current.client).toBe(client);
    expect(view.result.current.bars).toBe(bars);
    expect(client.close).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    queries.clear();
  }
  expect(client.close).toHaveBeenCalledOnce();
});

it("connects public hooks to an imperative renderer without per-bar React renders", () => {
  const { client, calls } = setup(false);
  let executions = 0;
  function Host() {
    executions++;
    const [input, setInput] = useState(request);
    const bars = useBars(input);
    const current = bars.current;
    const output = useRef<HTMLOutputElement>(null);
    useEffect(() => {
      if (output.current)
        output.current.textContent =
          current?.data.get(current.data.numRows - 1)?.close?.toString() ?? "";
    }, [current]);
    useSubscription(current?.updates ?? EMPTY, {
      next: (batch) => {
        const last = batch.get(batch.numRows - 1)?.close;
        if (last !== undefined && output.current)
          output.current.textContent = String(last);
      },
      error: () => {},
    });
    return (
      <>
        <button onClick={() => setInput(changes[2].input)}>
          Switch ticker
        </button>
        <output ref={output} aria-label="Price" />
        <span data-testid="symbol">{current?.request.listing.symbol}</span>
      </>
    );
  }
  const view = render(
    <FeedReactContext.Provider value={client}>
      <Host />
    </FeedReactContext.Provider>,
  );
  act(() => calls[0]!.sink.next(snapshot(request)));
  const count = executions;
  act(() => calls[0]!.sink.next({ type: "updates", data: frame(1, 3) }));
  expect(screen.getByLabelText("Price")).toHaveTextContent("3");
  expect(executions).toBe(count);
  fireEvent.click(screen.getByRole("button", { name: "Switch ticker" }));
  expect(calls[0]!.stop).toHaveBeenCalledOnce();
  expect(screen.getByTestId("symbol")).toHaveTextContent("BTCUSDT");
  act(() => calls[0]!.sink.next({ type: "updates", data: frame(1, 99) }));
  expect(screen.getByLabelText("Price")).toHaveTextContent("3");
  act(() => calls[1]!.sink.next(snapshot(changes[2].input, 4)));
  expect(screen.getByLabelText("Price")).toHaveTextContent("4");
  expect(screen.getByTestId("symbol")).toHaveTextContent("ETHUSDT");
  view.unmount();
  expect(calls[1]!.stop).toHaveBeenCalledOnce();
});
