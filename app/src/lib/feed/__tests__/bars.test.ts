// Purpose: Verify Bars channel ownership, frozen replay after unsubscribe, and live view sharing, without a browser or server.
import {
  type BarsMessage,
  BarsRequest,
  ClientFailures,
  FeedError,
  FeedReasons,
} from "@openchart/feed";
import { BarColumns } from "@openchart/market";
import { defineDataFrame } from "@openchart/timeseries";
import { Schema } from "effect";
import { Observable, of, Subject, take } from "rxjs";
import { afterEach, assert, expect, it, vi } from "vitest";

import {
  BARS_KEEP_MS,
  observeBars,
  shareBarsViews,
} from "@openchart/app/lib/feed/bars";
import {
  BarsView,
  UseBarsOptions,
  UseBarsResult,
} from "@openchart/app/lib/feed/contracts";

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
  countBack: 1,
});
// Native columns sit beside the required Bar vocabulary.
const NativeBars = defineDataFrame({
  ...BarColumns,
  final: Schema.Boolean,
  asOf: Schema.Finite,
});
const frame = (close = 2, times = [1]) =>
  NativeBars.create({
    labels: { symbol: "BTCUSDT" },
    rows: times.map((time) => ({
      time,
      open: 1,
      high: 2,
      low: 1,
      close,
      volume: 1,
      final: false,
      asOf: 10,
    })),
  });
const snapshot: BarsMessage = {
  type: "snapshot",
  snapshot: { data: frame(), range: { from: 0, to: 10 }, hasMoreBefore: false },
};

it("provides completed updates for finite history and freezes its snapshot", () => {
  const complete = vi.fn();
  const views: BarsView[] = [];
  observeBars(of(snapshot), { ...request, to: 10 }).subscribe({
    next: (view) => views.push(view),
    complete,
  });
  expect(complete).toHaveBeenCalledOnce();
  const view = views[0];
  assert.isDefined(view);
  const updatesComplete = vi.fn();
  view.updates.subscribe({ complete: updatesComplete });
  expect(updatesComplete).toHaveBeenCalledOnce();
  expect(Object.isFrozen(view.data)).toBe(true);
  expect(Object.isFrozen(view.data.get(0))).toBe(true);
  expect(Reflect.set(view.data.get(0)!, "close", 999)).toBe(false);
  expect(view.data.get(0)!.close).toBe(2);
  expect(Object.isFrozen(view.range)).toBe(true);
});

it("stops input on unsubscribe while retaining the final accepted view for late renderers", () => {
  const input = new Subject<BarsMessage>();
  const teardown = vi.fn();
  const start = vi.fn();
  const source = new Observable<BarsMessage>((observer) => {
    start();
    observer.next(snapshot);
    observer.next({ type: "updates", data: frame(3) });
    const subscription = input.subscribe(observer);
    return () => {
      subscription.unsubscribe();
      teardown();
    };
  });
  const stream = observeBars(source, request);
  expect(start).not.toHaveBeenCalled();
  const views: BarsView[] = [];
  const owner = stream.subscribe((view) => views.push(view));
  const view = views[0];
  assert.isDefined(view);
  const values: number[] = [];
  const reader = view.updates.subscribe((batch) =>
    values.push(batch.get(0)!.close as number),
  );
  expect(values).toEqual([3]);
  reader.unsubscribe();
  expect(teardown).not.toHaveBeenCalled();
  input.next({ type: "updates", data: frame(4) });
  expect(views).toHaveLength(1);
  owner.unsubscribe();
  owner.unsubscribe();
  input.next({ type: "updates", data: frame(5) });
  const replay: number[] = [];
  const complete = vi.fn();
  view.updates.subscribe({
    next: (batch) => replay.push(batch.get(0)!.close as number),
    complete,
  });
  expect(replay).toEqual([3, 4]);
  expect(complete).toHaveBeenCalledOnce();
  expect(teardown).toHaveBeenCalledOnce();
});

it("stops even synchronous producers when the outer owner takes only one view", () => {
  const views: BarsView[] = [];
  observeBars(
    of(snapshot, { type: "updates", data: frame() } as const),
    request,
  )
    .pipe(take(1))
    .subscribe((view) => views.push(view));
  const next = vi.fn();
  const complete = vi.fn();
  views[0]!.updates.subscribe({ next, complete });
  expect(next).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledOnce();
});

it.each([
  "empty",
  "updates-first",
  "duplicate",
  "finite-updates",
  "overflow",
] as const)("reports %s through the outer error channel", (mode) => {
  const messages: BarsMessage[] =
    mode === "empty"
      ? []
      : mode === "updates-first"
        ? [{ type: "updates", data: frame() }]
        : mode === "duplicate"
          ? [snapshot, snapshot]
          : [
              snapshot,
              {
                type: "updates",
                data: frame(
                  2,
                  mode === "overflow"
                    ? Array.from({ length: 50_001 }, (_, i) => i)
                    : [1],
                ),
              },
            ];
  const error = vi.fn();
  observeBars(
    of(...messages),
    mode === "finite-updates" ? { ...request, to: 10 } : request,
  ).subscribe({ error });
  expect(error).toHaveBeenCalledWith(
    mode === "overflow"
      ? new FeedError({
          reason: new FeedReasons.ResyncRequired({
            provider: request.provider,
          }),
        })
      : new ClientFailures.InvalidResponse(),
  );
});

it("local schemas preserve snapshot checks and restrict loading policy", () => {
  const current = { request, ...snapshot.snapshot, updates: of(frame()) };
  expect(Schema.is(BarsView)(current)).toBe(true);
  expect(Schema.is(BarsView)({ ...current, data: frame(2, [11]) })).toBe(false);
  expect(
    Schema.is(UseBarsResult)({ status: "ready", current, retry: () => {} }),
  ).toBe(true);
  for (const error of [
    new ClientFailures.Disconnected(),
    new FeedError({ reason: new FeedReasons.SourceUnavailable({}) }),
  ])
    expect(
      Schema.is(UseBarsResult)({
        status: "error",
        current: undefined,
        error,
        retry: () => {},
      }),
    ).toBe(true);
  expect(
    Schema.is(UseBarsResult)({
      status: "ready",
      current: undefined,
      retry: () => {},
    }),
  ).toBe(false);
  expect(Schema.is(UseBarsOptions)({ loadingBehavior: "clear" })).toBe(true);
  expect(Schema.is(UseBarsOptions)({ loadingBehavior: "unknown" })).toBe(false);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fake channels that record when each one closes. */
function channels() {
  const opened: { input: Subject<BarsMessage>; closed: boolean }[] = [];
  const open = (input: BarsRequest) =>
    observeBars(
      new Observable<BarsMessage>((observer) => {
        const channel = { input: new Subject<BarsMessage>(), closed: false };
        opened.push(channel);
        observer.next(snapshot);
        const subscription = channel.input.subscribe(observer);
        return () => {
          subscription.unsubscribe();
          channel.closed = true;
        };
      }),
      input,
    );
  return { opened, observe: shareBarsViews(open) };
}

function watch(stream: Observable<BarsView>) {
  const views: BarsView[] = [];
  const subscription = stream.subscribe({
    next: (view) => views.push(view),
    error: () => {},
  });
  const view = views[0];
  assert.isDefined(view);
  return { view, subscription };
}

it("keeps the newest live view open after its last subscriber leaves, then closes it", () => {
  vi.useFakeTimers();
  const { opened, observe } = channels();
  const first = watch(observe(request));
  const later = watch(observe({ ...request, from: 5 }));
  expect(later.view).toBe(first.view);
  expect(opened).toHaveLength(1);
  opened[0]!.input.next({ type: "updates", data: frame(3) });
  first.subscription.unsubscribe();
  later.subscription.unsubscribe();
  vi.advanceTimersByTime(BARS_KEEP_MS - 1);
  const again = watch(observe(request));
  expect(again.view).toBe(first.view);
  const replay: number[] = [];
  again.view.updates.subscribe((batch) =>
    replay.push(batch.get(0)!.close as number),
  );
  expect(replay).toEqual([3]);
  again.subscription.unsubscribe();
  vi.advanceTimersByTime(BARS_KEEP_MS - 1);
  expect(opened[0]!.closed).toBe(false);
  vi.advanceTimersByTime(1);
  expect(opened[0]!.closed).toBe(true);
  expect(watch(observe(request)).view).not.toBe(first.view);
  expect(opened).toHaveLength(2);
});

it("opens a new channel for wider requests and closes a replaced view once unwatched", () => {
  const { opened, observe } = channels();
  const narrow = watch(observe({ ...request, from: 10 }));
  const earlier = watch(observe({ ...request, from: 5 }));
  const longer = watch(observe({ ...request, from: 5, countBack: 2 }));
  watch(observe({ ...request, resolution: "5m" }));
  watch(observe({ ...request, to: 10 }));
  expect(opened).toHaveLength(5);
  narrow.subscription.unsubscribe();
  earlier.subscription.unsubscribe();
  expect(opened.map((channel) => channel.closed)).toEqual([
    true,
    true,
    false,
    false,
    false,
  ]);
  longer.subscription.unsubscribe();
  expect(opened[2]!.closed).toBe(false);
});

it.each(["error", "complete"] as const)(
  "never reuses a view after its channel ends with %s",
  (end) => {
    const { opened, observe } = channels();
    const first = watch(observe(request));
    if (end === "error")
      opened[0]!.input.error(new ClientFailures.Disconnected());
    else opened[0]!.input.complete();
    expect(watch(observe(request)).view).not.toBe(first.view);
    expect(opened).toHaveLength(2);
  },
);
