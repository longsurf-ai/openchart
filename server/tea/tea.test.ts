// Purpose: Retained compilations, independent warmed executions and scoped cancellation.
import fs from "node:fs";
import { mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { Schema as ArrowSchema } from "apache-arrow";
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Queue,
  Schema,
  Scope,
  Stream,
} from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { binanceBars } from "@openchart/server/data/providers/binance/datasets/definitions";
import {
  BarsRequest,
  barsSeries,
  FeedError,
  FeedReasons,
  Resolution,
} from "@openchart/feed";
import { BarColumns, ProviderId, ProviderListing } from "@openchart/market";

import {
  defineDataFrame,
  takeRows,
  type DataFrame,
} from "@openchart/timeseries";
import { Feed } from "@openchart/server/feed/service";
import type { ISymbologyFeedService } from "@openchart/server/feed/symbology/service";
import { logosFeed } from "@openchart/server/feed/logo/logo";
import { calendarFeed } from "@openchart/server/feed/calendar/calendar";
import { readBarsHistory } from "@openchart/server/feed/bar/history";
import { Workspaces } from "@openchart/server/workspace/workspace";
import type { Workspace } from "@openchart/server/workspace/instance";
import { WorkspaceId } from "@openchart/server/resources/workspace/entity";
import { temporaryHome } from "@openchart/server/home.test-utils";
import * as Tea from "./tea";

const series = Schema.decodeUnknownSync(BarsRequest)({
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
  to: 10,
  countBack: 1,
});
const frames = (
  values: readonly {
    time: number;
    close: number;
    open?: number;
    high?: number;
    low?: number;
    final?: boolean;
  }[],
) =>
  binanceBars.frame.create({
    labels: {},
    rows: values.map(
      ({
        time,
        close,
        open = close,
        high = close,
        low = close,
        final = true,
      }) => ({
        time,
        close,
        open,
        high,
        low,
        volume: 1,
        trades: 1,
        asOf: time + 1,
        final,
      }),
    ),
  });
const runtimes: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
});

async function fixture(
  source: string,
  values: Parameters<typeof frames>[0] = Array.from(
    { length: 1010 },
    (_, index) => ({ time: index + 1, close: 1, final: true }),
  ),
  sourceFrame?: DataFrame<BarColumns>,
) {
  const root = temporaryHome();
  const workspaceId = WorkspaceId.create();
  const compile = Schema.decodeUnknownSync(Tea.WorkspaceSources)({
    workspaceId,
    path: "main.tea",
  });
  await writeFile(join(root, compile.path), source);
  const read = vi.fn<Workspace["read"]>(() =>
    Effect.die("Tea compilation must use the compiler filesystem reader"),
  );
  let captures = 0;
  let releases = 0;
  let waiting: Deferred.Deferred<void> | undefined;
  const entered = Deferred.makeUnsafe<void>();
  const calls: BarsRequest[] = [];
  const queue = Effect.runSync(
    Queue.unbounded<ReturnType<typeof frames>, FeedError | Cause.Done>(),
  );
  const data: DataFrame<BarColumns> = sourceFrame ?? frames(values);
  const search = vi.fn<ISymbologyFeedService["search"]>(() =>
    Effect.succeed([]),
  );
  const workspace = {
    id: workspaceId,
    root,
    read,
  } as unknown as Workspace;
  const bars = {
    // Binance serves 24h unadjusted bars; Yahoo regular-session,
    // split-adjusted ones, and no 1s bars.
    getCapabilities: ({ provider }: ProviderListing) =>
      Effect.succeed(
        Resolution.literals
          .filter(
            (resolution) => provider !== "yfinance" || resolution !== "1s",
          )
          .map((resolution) => ({
            resolution,
            ...(provider === "yfinance"
              ? { session: "regular" as const, adjustment: "split" as const }
              : { session: "24h" as const, adjustment: "raw" as const }),
            modes: ["history", "live"] as const,
          })),
      ),
    observe: Effect.fn("Test.bars.observe")(function* (request: BarsRequest) {
      calls.push(request);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          releases++;
        }),
      );
      if (waiting) {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(waiting);
      }
      const snapshot = yield* readBarsHistory(request, (bounds) => {
        const indices = [...data].flatMap((row, index) =>
          row.time >= (bounds.from ?? -Infinity) && row.time < bounds.to
            ? [index]
            : [],
        );
        return Effect.succeed(
          takeRows(
            data,
            bounds.count === undefined ? indices : indices.slice(-bounds.count),
          ),
        );
      });
      return {
        snapshot,
        ...(request.to === "now" ? { updates: Stream.fromQueue(queue) } : {}),
      };
    }),
  };
  const runtime = ManagedRuntime.make(
    Tea.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(Workspaces, { open: () => Effect.succeed(workspace) }),
          Layer.succeed(Feed, {
            getVersion: () => Effect.die("Unused"),
            get: () =>
              Effect.sync(() => {
                captures++;
                return {
                  bars,
                  symbology: {
                    index: () => Effect.die("Unexpected index"),
                    indexStatus: () => Effect.succeed([]),
                    search,
                  },
                  logos: logosFeed(),
                  calendar: calendarFeed(),
                };
              }),
          }),
        ),
      ),
    ),
  );
  runtimes.push(runtime);
  const run = <A, E>(
    effect: (tea: typeof Tea.Service.Service) => Effect.Effect<A, E>,
  ) => runtime.runPromise(Effect.flatMap(Tea.Service, effect));
  const node = await run((tea) => tea.compile(compile));
  // A root reading the fixture market through the standard Bars input and map.
  const request = (
    node: Pick<Tea.CompileResponse, "id">,
    overrides: Partial<Tea.ObserveRequest> = {},
  ): Tea.ObserveRequest => ({
    id: node.id,
    ...Tea.barsInputs(series),
    parameters: {},
    requests: {},
    nodes: {},
    from: 1001,
    to: 1011,
    countBack: 10,
    warmupBars: 1000,
    ...overrides,
  });
  return {
    root,
    runtime,
    node,
    request,
    run,
    compile: (source: string) =>
      run((tea) =>
        tea.compile({ entry: "<inline>", sources: { "<inline>": source } }),
      ),
    /** A finite observation in its own scope. */
    finite: (request: Tea.ObserveRequest) =>
      runtime.runPromise(
        Effect.scoped(
          Effect.flatMap(Tea.Service, (tea) => tea.observe(request)),
        ),
      ),
    /** The error validation reports for an invalid graph. */
    invalid: (request: Tea.ObserveRequest) =>
      run((tea) => tea.validate(request).pipe(Effect.flip)),
    bars,
    calls,
    search,
    queue,
    entered,
    pause: () => {
      waiting = Deferred.makeUnsafe<void>();
    },
    resume: () => {
      if (waiting) Effect.runSync(Deferred.succeed(waiting, undefined));
    },
    reads: () => read.mock.calls.length,
    captures: () => captures,
    releases: () => releases,
  };
}

it("retains a compilation after source deletion, warms 1000 points, and isolates parameter bindings", async () => {
  const f = await fixture(
    'factor = input.float(1.0)\nvar float total = 0.0\ntotal += close * factor\nemit "total" total',
  );
  await unlink(join(f.root, "main.tea"));
  const first = await f.runtime.runPromise(
    Effect.scoped(
      Effect.flatMap(Tea.Service, (tea) =>
        tea.observe(f.request(f.node, { parameters: { factor: 1 } })),
      ),
    ),
  );
  const second = await f.runtime.runPromise(
    Effect.scoped(
      Effect.flatMap(Tea.Service, (tea) =>
        tea.observe(f.request(f.node, { parameters: { factor: 2 } })),
      ),
    ),
  );
  expect(first.snapshot.data.numRows).toBe(10);
  expect(first.snapshot.data.get(0)?.total).toBe(1001);
  expect(second.snapshot.data.get(0)?.total).toBe(2002);
  expect(first.snapshot.data.get(0)?.total).toBe(1001);
  expect(f.node.definition.parameters[0]?.value).toBe(1);
  expect(f.reads()).toBe(0);
  expect(f.captures()).toBe(2);
  expect(
    f.calls.map(({ from, to, countBack }) => ({ from, to, countBack })),
  ).toEqual([
    { from: 1001, to: 1011, countBack: 10 },
    { from: 1000, to: 1001, countBack: 1000 },
    { from: 1001, to: 1011, countBack: 10 },
    { from: 1000, to: 1001, countBack: 1000 },
  ]);
  expect(f.releases()).toBe(4);
  await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) => tea.dispose({ id: f.node.id })),
  );
  await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) => tea.dispose({ id: f.node.id })),
  );
  const failure = await f.runtime.runPromise(
    Effect.scoped(
      Effect.flatMap(Tea.Service, (tea) =>
        tea
          .observe(f.request(f.node, { parameters: { factor: 1 } }))
          .pipe(Effect.flip),
      ),
    ),
  );
  expect(failure.code).toBe("node_unavailable");
});

it("uses the request's warmup before countBack expansion and returns empty windows", async () => {
  const f = await fixture(
    'var float total = 0.0\ntotal += close\nemit "total" total',
  );
  const result = await f.finite(
    f.request(f.node, { from: 1009, countBack: 5, warmupBars: 2 }),
  );
  expect(result.snapshot.range.from).toBe(1006);
  expect([...result.snapshot.data].map((row) => row.total)).toEqual([
    3, 4, 5, 6, 7,
  ]);
  expect(f.calls[1]).toMatchObject({ from: 1005, to: 1006, countBack: 2 });
  const empty = await fixture('emit "price" close', []);
  const response = await empty.runtime.runPromise(
    Effect.scoped(
      Effect.flatMap(Tea.Service, (tea) =>
        tea.observe(empty.request(empty.node)),
      ),
    ),
  );
  expect(response.snapshot.data.numRows).toBe(0);
});

it("rejects incomplete parameters without opening Feed inputs", async () => {
  const f = await fixture('length = input.int(2)\nemit "price" close[length]');
  const failure = await f.runtime.runPromise(
    Effect.scoped(
      Effect.flatMap(Tea.Service, (tea) =>
        tea.observe(f.request(f.node)).pipe(Effect.flip),
      ),
    ),
  );
  expect(failure.code).toBe("invalid_request");
  expect(f.calls).toEqual([]);
});

it("returned parameter metadata cannot relax retained binding constraints", async () => {
  const f = await fixture(
    'factor = input.float(1.0, minval=0.0)\nemit "price" close * factor',
  );
  const constraints = f.node.definition.parameters[0]?.constraints;
  if (constraints?.kind !== "range") throw new Error("Missing parameter range");
  Object.defineProperty(constraints, "minval", { value: -100 });
  const failure = await f.runtime.runPromise(
    Effect.scoped(
      Effect.flatMap(Tea.Service, (tea) =>
        tea
          .observe(f.request(f.node, { parameters: { factor: -1 } }))
          .pipe(Effect.flip),
      ),
    ),
  );
  expect(failure.code).toBe("invalid_request");
  expect(f.calls).toEqual([]);
});

it("cancels a live observation independently and rejects committed corrections", async () => {
  const f = await fixture('emit "price" close', [
    { time: 1, close: 1, final: true },
  ]);
  const scope = Effect.runSync(Scope.make());
  const session = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) =>
      tea.observe(
        f.request(f.node, { from: 0, to: "now", countBack: 1, warmupBars: 0 }),
      ),
    ).pipe(Scope.provide(scope)),
  );
  expect(session.snapshot.data.get(0)?.price).toBe(1);
  if (!session.updates) throw new Error("Missing updates");
  Queue.offerUnsafe(f.queue, frames([{ time: 1, close: 2 }]));
  const error = await f.runtime.runPromise(
    Stream.runDrain(session.updates).pipe(Effect.flip),
  );
  expect(error.code).toBe("invalid_data");
  await Effect.runPromise(Scope.close(scope, Exit.void));
  const next = await f.runtime.runPromise(
    Effect.scoped(
      Effect.flatMap(Tea.Service, (tea) =>
        tea.observe(f.request(f.node, { from: 0, to: 2, countBack: 1 })),
      ),
    ),
  );
  expect(next.snapshot.data.get(0)?.price).toBe(1);
});

it("binds child parameters independently and preserves nested append outputs", async () => {
  const f = await fixture(
    'length = input.int(2)\ndaily = request.security("X", "1", close[length])\ntype Sample\n    float value\nemit "sample" Sample.new(daily)\nemit.append "events" Sample.new(daily)\nemit.append "events" Sample.new(close)',
    Array.from({ length: 6 }, (_, index) => ({
      time: index + 1,
      close: index + 1,
      final: true,
    })),
  );
  const base = f.request(f.node, {
    from: 3,
    to: 6,
    countBack: 3,
    parameters: { length: 4 },
  });
  const observe = (length: number) =>
    f.runtime.runPromise(
      Effect.scoped(
        Effect.flatMap(Tea.Service, (tea) =>
          tea.observe({
            ...base,
            requests: {
              daily: {
                ...Tea.barsInputs(series),
                parameters: { length },
                requests: {},
              },
            },
          }),
        ),
      ),
    );
  const first = await observe(1);
  const second = await observe(2);
  expect(first.snapshot.data.get(0)?.sample).toEqual({ value: 2 });
  expect(second.snapshot.data.get(0)?.sample).toEqual({ value: 1 });
  expect(first.snapshot.data.get(0)?.events).toEqual([
    { value: 2 },
    { value: 3 },
  ]);
  expect(first.rid).not.toBe(second.rid);
  const decoded = Schema.decodeUnknownSync(Tea.Message)(
    Schema.encodeSync(Tea.Message)({
      type: "snapshot",
      config: { inputs: {}, map: {}, parameters: {}, requests: {} },
      rid: first.rid,
      snapshot: first.snapshot,
    }),
  );
  if (decoded.type !== "snapshot") throw new Error("Missing snapshot");
  expect(decoded.rid).toBe(first.rid);
  expect([...decoded.snapshot.data]).toEqual([...first.snapshot.data]);
  expect(
    decoded.snapshot.data.schema.fields
      .find((field) => field.name === "events")
      ?.metadata.get("tea:write"),
  ).toBe("append");
});

it("a child acquisition failure releases previously acquired root history and warmup", async () => {
  const f = await fixture(
    'peer = request.security("FAIL", "1", close)\nemit "price" close + peer',
  );
  const observe = f.bars.observe;
  const cause = new FeedError({
    reason: new FeedReasons.SourceUnavailable({
      provider: ProviderId.make("binance"),
    }),
  });
  vi.spyOn(f.bars, "observe").mockImplementation((request) =>
    request.listing.symbol === "FAIL" ? Effect.fail(cause) : observe(request),
  );
  const request = f.request(f.node);
  const failure = await f.runtime.runPromise(
    Effect.scoped(
      Effect.flatMap(Tea.Service, (tea) =>
        tea.observe({
          ...request,
          requests: {
            peer: {
              ...Tea.barsInputs({
                ...series,
                listing: { ...series.listing, symbol: "FAIL" },
              }),
              parameters: {},
              requests: {},
            },
          },
        }),
      ),
    ).pipe(Effect.flip),
  );
  expect(failure).toMatchObject({ code: "upstream", message: cause.message });
  expect(f.captures()).toBe(1);
  expect(f.calls).toHaveLength(2);
  expect(f.releases()).toBe(2);
});

it("disposing a node interrupts snapshot preparation and awaits input cleanup", async () => {
  const f = await fixture('emit "price" close');
  f.pause();
  const scope = Effect.runSync(Scope.make());
  const pending = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) => tea.observe(f.request(f.node))).pipe(
      Scope.provide(scope),
      Effect.forkIn(scope),
    ),
  );
  await Effect.runPromise(Deferred.await(f.entered));
  await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) => tea.dispose({ id: f.node.id })),
  );
  const exit = await Effect.runPromise(Fiber.await(pending));
  expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
  expect(f.releases()).toBe(1);
  await Effect.runPromise(Scope.close(scope, Exit.void));
});

it("continues provisional attempts in the snapshot execution and commits each bar once", async () => {
  const f = await fixture(
    'var float total = 0.0\nvarip float attempts = 0.0\ntotal += close\nattempts += 1\nemit "total" total\nemit "attempts" attempts\nemit "confirmed" barstate.isconfirmed\nemit "realtime" barstate.isrealtime\nemit.append "events" close',
    [{ time: 1, close: 1, final: false }],
  );
  const scope = Effect.runSync(Scope.make());
  const session = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) =>
      tea.observe(f.request(f.node, { from: 0, to: "now", countBack: 1 })),
    ).pipe(Scope.provide(scope)),
  );
  expect(session.snapshot.data.get(0)).toMatchObject({
    index: 0,
    provisional: true,
    total: 1,
    attempts: 1,
    confirmed: false,
    realtime: false,
    events: [1],
  });
  if (!session.updates) throw new Error("Missing updates");
  for (const row of [
    { time: 1, close: 2, final: false },
    { time: 1, close: 3, final: true },
    { time: 2, close: 4, final: false },
    { time: 2, close: 5, final: true },
    { time: 3, close: 6, final: false },
    { time: 4, close: 7, final: false },
  ])
    Queue.offerUnsafe(f.queue, frames([row]));
  const updates = await f.runtime.runPromise(
    session.updates.pipe(Stream.take(7), Stream.runCollect),
  );
  expect(updates.map((frame) => frame.get(0))).toMatchObject([
    {
      index: 0,
      provisional: true,
      total: 2,
      attempts: 2,
      confirmed: false,
      realtime: true,
      events: [2],
    },
    {
      index: 0,
      provisional: false,
      total: 3,
      attempts: 3,
      confirmed: true,
      realtime: true,
      events: [3],
    },
    {
      index: 1,
      provisional: true,
      total: 7,
      attempts: 4,
      confirmed: false,
      realtime: true,
      events: [4],
    },
    {
      index: 1,
      provisional: false,
      total: 8,
      attempts: 5,
      confirmed: true,
      realtime: true,
      events: [5],
    },
    {
      index: 2,
      provisional: true,
      total: 14,
      attempts: 6,
      events: [6],
    },
    {
      index: 2,
      provisional: false,
      total: 14,
      attempts: 7,
      events: [6],
    },
    {
      index: 3,
      provisional: true,
      total: 21,
      attempts: 8,
      events: [7],
    },
  ]);
  await Effect.runPromise(Scope.close(scope, Exit.void));
});

it("reads the observation clock again for live timenow without changing event time", async () => {
  const f = await fixture('emit "now" timenow\nemit "event" time', [
    { time: 1, close: 1, final: false },
  ]);
  let now = 1000;
  const originalClock = Effect.runSync(Clock.Clock);
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => now,
    currentTimeMillis: Effect.sync(() => now),
    currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
    monotonicTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
    sleep: (duration) => originalClock.sleep(duration),
  };
  const scope = Effect.runSync(Scope.make());
  const session = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) =>
      tea.observe(f.request(f.node, { from: 0, to: "now", countBack: 1 })),
    ).pipe(Scope.provide(scope), Effect.provideService(Clock.Clock, clock)),
  );
  expect(session.snapshot.data.get(0)).toMatchObject({
    time: 1,
    now: 1000,
    event: 1,
  });
  if (!session.updates) throw new Error("Missing live updates");
  now = 2000;
  Queue.offerUnsafe(f.queue, frames([{ time: 1, close: 2, final: false }]));
  const updates = await f.runtime.runPromise(
    session.updates.pipe(Stream.take(1), Stream.runCollect),
  );
  expect(updates[0]?.get(0)).toMatchObject({ time: 1, now: 2000, event: 1 });
  await Effect.runPromise(Scope.close(scope, Exit.void));
});

it("barstate.islast marks only the newest row: a finite window's last, then a live run's last history row and every live row", async () => {
  const f = await fixture(
    [
      "var int marked = 0",
      "if barstate.islast",
      "    marked += 1",
      'emit "last" barstate.islast',
      'emit "marked" marked',
      'emit "realtime" barstate.isrealtime',
    ].join("\n"),
  );
  // 1,000 final warmup rows, then ten more: only the very last was marked.
  const finite = await f.finite(f.request(f.node));
  expect(
    [...finite.snapshot.data].map(({ last, marked }) => [last, marked]),
  ).toEqual([...Array.from({ length: 9 }, () => [false, 0]), [true, 1]]);
  const scope = Effect.runSync(Scope.make());
  const session = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) =>
      tea.observe(f.request(f.node, { to: "now" })),
    ).pipe(Scope.provide(scope)),
  );
  // Final, yet the newest until a live row arrives.
  expect([...session.snapshot.data].at(-1)).toMatchObject({
    time: 1010,
    provisional: false,
    last: true,
    realtime: false,
  });
  if (!session.updates) throw new Error("Missing updates");
  for (const row of [
    { time: 1011, close: 1, final: false },
    { time: 1011, close: 1, final: true },
    { time: 1012, close: 1, final: false },
  ])
    Queue.offerUnsafe(f.queue, frames([row]));
  const updates = await f.runtime.runPromise(
    session.updates.pipe(Stream.take(3), Stream.runCollect),
  );
  expect(updates.map((frame) => frame.get(0))).toMatchObject([
    { time: 1011, provisional: true, last: true, realtime: true },
    { time: 1011, provisional: false, last: true, realtime: true },
    { time: 1012, provisional: true, last: true, realtime: true },
  ]);
  await Effect.runPromise(Scope.close(scope, Exit.void));
});

it("cancelling one admitted observation leaves its sibling and retained ID available", async () => {
  const f = await fixture('emit "price" close');
  f.pause();
  const scopes = [
    Effect.runSync(Scope.make()),
    Effect.runSync(Scope.make()),
  ] as const;
  const fibers = await Promise.all(
    scopes.map((scope) =>
      f.runtime.runPromise(
        Effect.flatMap(Tea.Service, (tea) =>
          tea.observe(f.request(f.node)),
        ).pipe(Scope.provide(scope), Effect.forkIn(scope)),
      ),
    ),
  );
  await vi.waitFor(() => expect(f.calls).toHaveLength(2));
  await Effect.runPromise(Scope.close(scopes[0], Exit.void));
  const cancelled = await Effect.runPromise(Fiber.await(fibers[0]!));
  expect(
    Exit.isFailure(cancelled) && Cause.hasInterrupts(cancelled.cause),
  ).toBe(true);
  expect(f.releases()).toBe(1);
  f.resume();
  const sibling = await Effect.runPromise(Fiber.join(fibers[1]!));
  expect(sibling.snapshot.data.numRows).toBe(10);
  await Effect.runPromise(Scope.close(scopes[1], Exit.void));
});

it("fulfills Pine input.source price aliases from the native OHLCV input", async () => {
  const f = await fixture('price = input.source(hl2)\nemit "price" price', [
    { time: 1, open: 4, high: 12, low: 2, close: 5 },
  ]);
  const result = await f.runtime.runPromise(
    Effect.scoped(
      Effect.flatMap(Tea.Service, (tea) =>
        tea.observe(
          f.request(f.node, {
            from: 0,
            to: 2,
            countBack: 1,
            parameters: { price: "hl2" },
          }),
        ),
      ),
    ),
  );
  expect(result.snapshot.data.get(0)?.price).toBe(7);
});

it("warms EMA before publishing a later finite window", async () => {
  const f = await fixture(
    'emit "ema" ta.ema(close, 20)',
    Array.from({ length: 2020 }, (_, index) => ({
      time: index + 1,
      close: 100 + 20 * Math.sin(index / 11),
    })),
  );
  const observe = (from: number) =>
    f.runtime.runPromise(
      Effect.scoped(
        Effect.flatMap(Tea.Service, (tea) =>
          tea.observe(f.request(f.node, { from, to: 2021, countBack: 20 })),
        ),
      ),
    );
  const full = await observe(1);
  const later = await observe(2001);
  expect(later.snapshot.data.numRows).toBe(20);
  expect(later.snapshot.data.get(0)?.ema).toBeCloseTo(
    full.snapshot.data.get(2000)?.ema as number,
    10,
  );
});

it("executes known historical rows without a native final flag once, including warmup", async () => {
  const f = await fixture(
    'varip int n = 0\nn += 1\nemit "n" n\nemit "confirmed" barstate.isconfirmed',
    [],
    defineDataFrame(BarColumns).create({
      labels: {},
      rows: [
        { time: 60_000, open: 1, high: 1, low: 1, close: 1, volume: 0 },
        { time: 120_000, open: 2, high: 2, low: 2, close: 2, volume: 0 },
      ],
    }),
  );
  const observe = (from: number, warmupBars: number) =>
    f.finite(
      f.request(f.node, { from, to: 180_000, countBack: 1, warmupBars }),
    );
  const full = await observe(60_000, 0);
  expect(
    [...full.snapshot.data].map(({ n, confirmed, provisional }) => ({
      n,
      confirmed,
      provisional,
    })),
  ).toEqual([
    { n: 1, confirmed: true, provisional: false },
    { n: 2, confirmed: true, provisional: false },
  ]);
  const warmed = await observe(120_000, 1);
  expect(warmed.snapshot.data.get(0)).toMatchObject({
    n: 2,
    confirmed: true,
    provisional: false,
  });
  const scope = Effect.runSync(Scope.make());
  const live = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) =>
      tea.observe(
        f.request(f.node, {
          from: 60_000,
          to: "now",
          countBack: 1,
          warmupBars: 0,
        }),
      ),
    ).pipe(Scope.provide(scope)),
  );
  expect(
    [...live.snapshot.data].map(({ n, confirmed }) => ({ n, confirmed })),
  ).toEqual([
    { n: 1, confirmed: true },
    { n: 2, confirmed: false },
  ]);
  await Effect.runPromise(Scope.close(scope, Exit.void));
});

const alertScript = [
  'indicator("Cross", overlay = true)',
  "import ta",
  "threshold = input.float(10.0)",
  "type Alert",
  "    string title",
  "    string message",
  'plot("fast", ta.ema(close, 2))',
  'emit "raw" close',
  'emit.append "lookalike" Alert.new("Up", "Price rose")',
  'alertcondition("cross", close > threshold, "Up", "Price rose")',
].join("\n");

it("compiles inline source to the metadata of the identical Workspace file and observes its alert column", async () => {
  const f = await fixture(alertScript, [
    { time: 1, close: 9 },
    { time: 2, close: 11 },
  ]);
  const inline = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) =>
      tea.compile({ entry: "<inline>", sources: { "<inline>": alertScript } }),
    ),
  );
  expect(inline.id).not.toBe(f.node.id);
  expect({
    ...Schema.encodeSync(Tea.CompileResponse)(inline),
    id: f.node.id,
  }).toEqual(Schema.encodeSync(Tea.CompileResponse)(f.node));
  expect(inline.declaration).toEqual({
    kind: "indicator",
    title: "Cross",
    overlay: true,
    timeframe: "",
  });
  // Only the nominal visual.Alert column; the user struct has the same fields.
  expect(Tea.teaAlertOutputs(inline.definition.outputs)).toEqual(["cross"]);

  const finite = (node: Tea.CompileResponse) =>
    f.finite(
      f.request(node, {
        parameters: { threshold: 10 },
        from: 0,
        to: 3,
        countBack: 2,
        warmupBars: 0,
      }),
    );
  const rows = [...(await finite(inline)).snapshot.data];
  expect(rows).toEqual([...(await finite(f.node)).snapshot.data]);
  expect(rows.map((row) => row.cross)).toEqual([
    [],
    [{ title: "Up", message: "Price rose" }],
  ]);

  const scope = Effect.runSync(Scope.make());
  const session = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) =>
      tea.observe(
        f.request(inline, {
          parameters: { threshold: 10 },
          from: 0,
          to: "now",
          countBack: 2,
          warmupBars: 0,
        }),
      ),
    ).pipe(Scope.provide(scope)),
  );
  if (!session.updates) throw new Error("Missing updates");
  for (const row of [
    { time: 3, close: 11, final: false },
    { time: 3, close: 9, final: false },
    { time: 3, close: 12, final: true },
  ])
    Queue.offerUnsafe(f.queue, frames([row]));
  const updates = await f.runtime.runPromise(
    session.updates.pipe(Stream.take(3), Stream.runCollect),
  );
  // Each attempt replaces the step's list: non-empty means this attempt fired.
  expect(
    updates.map((frame) => {
      const { index, provisional, cross } = frame.get(0)!;
      return { index, provisional, cross };
    }),
  ).toEqual([
    {
      index: 2,
      provisional: true,
      cross: [{ title: "Up", message: "Price rose" }],
    },
    { index: 2, provisional: true, cross: [] },
    {
      index: 2,
      provisional: false,
      cross: [{ title: "Up", message: "Price rose" }],
    },
  ]);
  await Effect.runPromise(Scope.close(scope, Exit.void));
});

it("never reads the disk for relative imports in inline source", async () => {
  const f = await fixture('emit "price" close');
  const compile = (source: string) =>
    f.runtime.runPromise(
      Effect.flatMap(Tea.Service, (tea) =>
        tea.compile({ entry: "<inline>", sources: { "<inline>": source } }),
      ),
    );
  // The vendored loader binds readFileSync from the builtin ESM facade.
  const reads = vi.spyOn(fs, "readFileSync");
  syncBuiltinESMExports();
  const teaReads = () =>
    reads.mock.calls.filter(([path]) => String(path).endsWith(".tea"));
  try {
    for (const statement of [
      "import ./lib/bands",
      "import ../shared/risk as risk",
      "import /* beside */ ./lib/bands",
      // Only "\n" ends a Tea line comment; the import continues on the next line.
      "import // a\rb\n ./lib/bands",
      "import // a b\n ./lib/bands",
    ]) {
      const failure = await compile(`${statement}\nemit "price" close`).then(
        () => undefined,
        (error: unknown) => error,
      );
      // Inline source reads through a reader that finds no file.
      expect(failure).toMatchObject({ code: "compile_failed" });
      expect(String((failure as Error).message)).toContain("cannot find");
    }
    // Compilation reads Tea's shipped libraries, never a user file.
    expect(
      teaReads().filter(([path]) => !String(path).includes("/tea-lib/")),
    ).toEqual([]);
    // Control: the spy sees the loader, and registry libraries still load. Its
    // adjacent comments would stall a guard whose comment match can regroup.
    const started = performance.now();
    await compile(`import ${"/**/".repeat(30)}trade\nemit "price" close`);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(teaReads().map(([path]) => String(path))).toEqual(
      expect.arrayContaining([expect.stringMatching(/tea-lib\/trade\.tea$/)]),
    );
  } finally {
    reads.mockRestore();
    syncBuiltinESMExports();
  }
});

it("snapshots a Workspace script with its imports and compiles the snapshot without the disk", async () => {
  const f = await fixture('emit "price" close');
  await mkdir(join(f.root, "strategies/lib"), { recursive: true });
  await mkdir(join(f.root, "shared"), { recursive: true });
  await writeFile(
    join(f.root, "strategies/entry.tea"),
    'import ./lib/bands\nimport ../shared/risk as limits\nemit "capped" limits.cap(bands.upper(close, 2.0), 100.0)\n',
  );
  await writeFile(
    join(f.root, "strategies/lib/bands.tea"),
    'library("bands")\nimport ../../shared/risk\nexport upper(source, k) =>\n    risk.cap(source + k, 100.0)\n',
  );
  await writeFile(
    join(f.root, "shared/risk.tea"),
    'library("risk")\nexport cap(value, limit) =>\n    math.min(value, limit)\n',
  );
  const request = Schema.decodeUnknownSync(Tea.WorkspaceSources)({
    workspaceId: WorkspaceId.create(),
    path: "strategies/entry.tea",
  });
  const run = <A, E>(
    effect: (tea: typeof Tea.Service.Service) => Effect.Effect<A, E>,
  ) => f.runtime.runPromise(Effect.flatMap(Tea.Service, effect));
  const files = await run((tea) =>
    tea
      .compile({ ...request, includeSources: true })
      .pipe(Effect.map((node) => node.sources!)),
  );
  expect(Object.keys(files).sort()).toEqual([
    "shared/risk.tea",
    "strategies/entry.tea",
    "strategies/lib/bands.tea",
  ]);
  const fromDisk = await run((tea) => tea.compile(request));
  await rm(join(f.root, "strategies"), { recursive: true });
  await rm(join(f.root, "shared"), { recursive: true });
  const fromSnapshot = await run((tea) =>
    tea.compile({ entry: request.path, sources: files }),
  );
  expect({
    ...Schema.encodeSync(Tea.CompileResponse)(fromSnapshot),
    id: "",
  }).toEqual({
    ...Schema.encodeSync(Tea.CompileResponse)(fromDisk),
    id: "",
  });
  const missing = await run((tea) =>
    tea.compile({
      entry: request.path,
      sources: { [request.path]: files[request.path]! },
    }),
  ).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(String((missing as Error).message)).toContain(
    "cannot find './lib/bands'",
  );
});

it("snapshots an empty script and refuses one over the snapshot limits as a Tea error", async () => {
  const f = await fixture('emit "price" close');
  await writeFile(join(f.root, "empty.tea"), "");
  // A comment keeps the oversized script valid Tea, so only the limit refuses it.
  await writeFile(
    join(f.root, "big.tea"),
    `// ${"x".repeat(65536)}\nemit "price" close\n`,
  );
  const request = (path: string) =>
    Schema.decodeUnknownSync(Tea.WorkspaceSources)({
      workspaceId: WorkspaceId.create(),
      path,
    });
  const run = <A, E>(
    effect: (tea: typeof Tea.Service.Service) => Effect.Effect<A, E>,
  ) => f.runtime.runPromise(Effect.flatMap(Tea.Service, effect));
  const empty = await run((tea) =>
    tea
      .compile({ ...request("empty.tea"), includeSources: true })
      .pipe(Effect.map((node) => node.sources!)),
  );
  expect(empty).toEqual({ "empty.tea": "" });
  await expect(
    run((tea) => tea.compile({ entry: "empty.tea", sources: empty })),
  ).resolves.toMatchObject({ definition: { outputs: expect.anything() } });
  await expect(
    run((tea) => tea.compile({ ...request("big.tea"), includeSources: true })),
  ).rejects.toMatchObject({
    code: "compile_failed",
    message: expect.stringContaining("snapshot limits"),
  });
});

it("uses ordinary filesystem import resolution, including parent paths and symlinks", async () => {
  const f = await fixture('emit "price" close');
  await mkdir(join(f.root, "inner"));
  await writeFile(
    join(f.root, "library.tea"),
    'library("lib")\nexport one() => 1\n',
  );
  await symlink(join(f.root, "library.tea"), join(f.root, "inner/linked.tea"));
  const source =
    'import ./linked\nimport ../library as other\nemit "one" lib.one() + other.one()';
  await writeFile(join(f.root, "inner/entry.tea"), source);
  const node = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) =>
      tea.compile({
        workspaceId: WorkspaceId.create(),
        path: "inner/entry.tea",
        includeSources: true,
      }),
    ),
  );
  expect(node.sources).toEqual({
    "inner/entry.tea": source,
    "inner/linked.tea": 'library("lib")\nexport one() => 1\n',
    "library.tea": 'library("lib")\nexport one() => 1\n',
  });
  expect(f.reads()).toBe(0);
  expect(f.node).not.toHaveProperty("sources");
});

it("validates a complete tree without Feed acquisition and keeps its retained node usable", async () => {
  const f = await fixture(
    'length = input.int(2, minval = 1)\nchild = request.security("X", "1", close[length])\nemit "value" child',
  );
  const request = f.request(f.node, { parameters: { length: 2 } });
  const complete = {
    ...request,
    requests: {
      child: {
        ...Tea.barsInputs(series),
        parameters: { length: 3 },
        requests: {},
      },
    },
  };
  const before = f.calls.length;
  await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) => tea.validate(complete)),
  );
  expect(f.calls).toHaveLength(before);
  const failure = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) => tea.validate(request)).pipe(
      Effect.flip,
    ),
  );
  expect(failure.code).toBe("invalid_request");
  expect(f.calls).toHaveLength(before);
  await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) => tea.validate(complete)),
  );
});

// A root that reads `node` through a NodeRef input named after it, and maps
// each listed column to a field path of that node's output rows.
function readingNode(
  base: Tea.ObserveRequest,
  name: string,
  node: Tea.CompileResponse,
  columns: Readonly<Record<string, Tea.FieldPath>>,
  config: Tea.NodeConfig = {
    ...Tea.barsInputs(series),
    parameters: {},
    requests: {},
  },
): Tea.ObserveRequest {
  return {
    ...base,
    inputs: {
      ...base.inputs,
      [name]: { _tag: "NodeRef", node: name, schema: node.definition.outputs },
    },
    map: {
      ...base.map,
      ...Object.fromEntries(
        Object.entries(columns).map(([column, path]) => [column, [name, path]]),
      ),
    },
    nodes: { ...base.nodes, [name]: { id: node.id, ...config } },
  };
}

it("reads a node's plot and numeric outputs through a NodeRef in every root attempt", async () => {
  const f = await fixture(
    'total = input.series("indicator.total")\nemit "seen" total\nemit "prev" total[1]\nemit "scaled" input.series("indicator.scaled")',
    [{ time: 1, close: 1, final: false }],
  );
  const indicator = await f.compile(
    'indicator("Total", overlay = false)\nvar float total = 0.0\ntotal += close\nplot("total", total)\nemit "scaled" close * 10',
  );
  const scope = Effect.runSync(Scope.make());
  const session = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) =>
      tea.observe(
        readingNode(
          f.request(f.node, { from: 0, to: "now", countBack: 1 }),
          "indicator",
          indicator,
          {
            "indicator.total": ["total", "series"],
            "indicator.scaled": ["scaled"],
          },
        ),
      ),
    ).pipe(Scope.provide(scope)),
  );
  expect(session.snapshot.data.get(0)).toMatchObject({
    provisional: true,
    seen: 1,
    scaled: 10,
  });
  // The root's Bars input and the Indicator's are one shared Feed session.
  expect(f.calls).toHaveLength(1);
  if (!session.updates) throw new Error("Missing updates");
  for (const row of [
    { time: 1, close: 2, final: false },
    { time: 1, close: 3, final: true },
    { time: 2, close: 4, final: false },
    { time: 3, close: 6, final: false },
  ])
    Queue.offerUnsafe(f.queue, frames([row]));
  const updates = await f.runtime.runPromise(
    session.updates.pipe(Stream.take(5), Stream.runCollect),
  );
  // Provisional attempts roll back the Indicator's var, and `[1]` only
  // advances on a committed bar, in both nodes alike.
  expect(updates.map((frame) => frame.get(0))).toMatchObject([
    { index: 0, provisional: true, seen: 2, scaled: 20 },
    { index: 0, provisional: false, seen: 3, scaled: 30 },
    { index: 1, provisional: true, seen: 7, prev: 3, scaled: 40 },
    { index: 1, provisional: false, seen: 7, prev: 3, scaled: 40 },
    { index: 2, provisional: true, seen: 13, prev: 7, scaled: 60 },
  ]);
  await Effect.runPromise(Scope.close(scope, Exit.void));
});

it("opens one shared input once for the root and a chain of nodes it reads", async () => {
  const f = await fixture(
    'emit "sum" close + input.series("quad")',
    [1, 2, 3].map((time) => ({ time, close: time })),
  );
  const double = await f.compile('emit "double" hl2 * 2');
  const quad = await f.compile('emit "quad" input.series("double") * 2');
  // `quad` reads only `double`, which reads `hl2` of the root's market. The
  // root declares only OHLCV; the one shared stream carries both schemas.
  const base = f.request(f.node, { from: 1, to: 4, countBack: 1 });
  const request = readingNode(
    {
      ...base,
      inputs: {
        bars: {
          _tag: "Bars",
          ...barsSeries(series, series),
          schema: new ArrowSchema(Tea.barsSchema.fields.slice(0, 5)),
        },
      },
      map: { close: ["bars", ["close"]] },
    },
    "quad",
    quad,
    { quad: ["quad"] },
    {
      inputs: {
        double: {
          _tag: "NodeRef",
          node: "double",
          schema: double.definition.outputs,
        },
      },
      map: { double: ["double", ["double"]] },
      parameters: {},
      requests: {},
    },
  );
  const result = await f.finite({
    ...request,
    nodes: {
      ...request.nodes,
      double: {
        id: double.id,
        ...Tea.barsInputs(series),
        parameters: {},
        requests: {},
      },
    },
  });
  expect(
    [...result.snapshot.data].map(({ time, sum }) => ({ time, sum })),
  ).toEqual([
    { time: 1, sum: 5 },
    { time: 2, sum: 10 },
    { time: 3, sum: 15 },
  ]);
  expect(f.captures()).toBe(1);
  expect(f.calls).toHaveLength(1);
  expect(f.releases()).toBe(1);
});

it("rejects a NodeRef graph that cannot run, without opening Feed", async () => {
  const f = await fixture('emit "sum" close + input.series("double")');
  const double = await f.compile('emit "double" close * 2');
  const valid = readingNode(f.request(f.node), "double", double, {
    double: ["double"],
  });
  await f.run((tea) => tea.validate(valid));
  const ref = (node: string, schema = double.definition.outputs) =>
    ({ _tag: "NodeRef", node, schema }) as const;
  const doubleNode = valid.nodes.double!;
  const child = await f.compile(
    'daily = request.security("X", "1", close)\nemit "sum" daily + input.series("double")',
  );
  for (const [request, message] of [
    [
      { ...valid, inputs: { ...valid.inputs, double: ref("missing") } },
      "input 'double' at root reads nodes.missing, which does not exist",
    ],
    [
      {
        ...valid,
        nodes: {
          double: {
            ...doubleNode,
            inputs: { ...doubleNode.inputs, back: ref("double") },
          },
        },
      },
      "nodes.double reads itself through a loop",
    ],
    [
      { ...valid, nodes: { ...valid.nodes, spare: doubleNode } },
      "nodes.spare is not read by the root or by any node it reads",
    ],
    [
      {
        ...valid,
        inputs: {
          ...valid.inputs,
          double: ref("double", f.node.definition.outputs),
        },
      },
      "input 'double' at root has an out-of-date schema for nodes.double; use its current definition.outputs",
    ],
    [
      { ...valid, nodes: { double: { ...doubleNode, inputs: {}, map: {} } } },
      "At least one input is required at nodes.double",
    ],
    [
      {
        ...valid,
        id: child.id,
        requests: {
          daily: {
            ...Tea.barsInputs(series),
            inputs: { ...valid.inputs, double: ref("double") },
            parameters: {},
            requests: {},
          },
        },
      },
      "input 'double' at root.requests.daily is a NodeRef, but request children cannot read nodes",
    ],
  ] as const)
    expect(await f.invalid(request)).toMatchObject({
      code: "invalid_request",
      message,
    });
  expect(f.captures()).toBe(0);
  expect(f.calls).toEqual([]);
});

it("checks the map against the columns the bound parameters read and ignores extra entries", async () => {
  const f = await fixture('price = input.source(close)\nemit "price" price');
  const map = {
    close: ["bars", ["close"]],
    unused: ["bars", ["volume"]],
  } as const;
  const request = f.request(f.node, { parameters: { price: "close" }, map });
  await f.run((tea) => tea.validate(request));
  // Binding input.source selects the required column; the unused default drops out.
  expect(
    await f.invalid({ ...request, parameters: { price: "open" } }),
  ).toMatchObject({
    code: "invalid_request",
    message:
      "Column 'open' has no map entry at root; the map has close, unused",
  });
  await f.run((tea) =>
    tea.validate({
      ...request,
      parameters: { price: "open" },
      map: { open: ["bars", ["open"]] },
    }),
  );
  // The complete Bars map still covers the node after the source changes.
  await f.run((tea) =>
    tea.validate(f.request(f.node, { parameters: { price: "open" } })),
  );
  for (const [entry, message] of [
    [
      ["prices", ["close"]],
      "Column 'close' reads input 'prices', which is not an input at root",
    ],
    [
      ["bars", ["closing"]],
      "Column 'close' reads 'closing', which input 'bars' at root does not declare",
    ],
    [
      ["bars", ["time"]],
      "Column 'close' cannot read 'time' of input 'bars' at root",
    ],
  ] as const)
    expect(
      await f.invalid({ ...request, map: { close: entry } }),
    ).toMatchObject({ code: "invalid_request", message });
  expect(f.calls).toEqual([]);
});

it("steps once per bar of an input that the map never reads", async () => {
  const f = await fixture(
    'emit "event" time',
    [1, 2, 3].map((time) => ({ time, close: time })),
  );
  const result = await f.finite(
    f.request(f.node, { from: 1, to: 4, countBack: 1, map: {} }),
  );
  expect([...result.snapshot.data].map(({ event }) => event)).toEqual([
    1, 2, 3,
  ]);
});

it("checks nodes ids at admission, but only disposing the root id stops a run", async () => {
  const f = await fixture('emit "seen" input.series("double")', [
    { time: 1, close: 1 },
  ]);
  const live = async () => {
    const double = await f.compile('emit "double" close * 2');
    const scope = Effect.runSync(Scope.make());
    const session = await f.runtime.runPromise(
      Effect.flatMap(Tea.Service, (tea) =>
        tea.observe(
          readingNode(
            f.request(f.node, { from: 0, to: "now", countBack: 1 }),
            "double",
            double,
            { double: ["double"] },
          ),
        ),
      ).pipe(Scope.provide(scope)),
    );
    if (!session.updates) throw new Error("Missing updates");
    return { double, scope, updates: session.updates, session };
  };
  const first = await live();
  expect(first.session.snapshot.data.get(0)?.seen).toBe(2);
  await f.run((tea) => tea.dispose({ id: first.double.id }));
  expect(
    await f.run((tea) =>
      tea
        .observe(
          readingNode(f.request(f.node), "double", first.double, {
            double: ["double"],
          }),
        )
        .pipe(Effect.scoped, Effect.flip),
    ),
  ).toMatchObject({ code: "node_unavailable" });
  // The running observation owns the node it built, so it keeps going.
  Queue.offerUnsafe(f.queue, frames([{ time: 2, close: 3 }]));
  const updates = await f.runtime.runPromise(
    first.updates.pipe(Stream.take(1), Stream.runCollect),
  );
  expect(updates[0]?.get(0)?.seen).toBe(6);
  await Effect.runPromise(Scope.close(first.scope, Exit.void));

  const second = await live();
  const releases = f.releases();
  await f.run((tea) => tea.dispose({ id: f.node.id }));
  expect(
    await f.runtime.runPromise(Stream.runCollect(second.updates)),
  ).toHaveLength(0);
  expect(f.releases()).toBe(releases + 1);
  await Effect.runPromise(Scope.close(second.scope, Exit.void));
});

it("runs Samples inputs without Feed, warms them from earlier rows and refuses a live window", async () => {
  const f = await fixture(
    'var float total = 0.0\ntotal += close\nemit "total" total',
  );
  const samples: Tea.Samples = {
    _tag: "Samples",
    ...barsSeries(series, series),
    schema: Tea.barsSchema,
    rows: [1, 2, 3, 4, 5].map((time) => ({
      time,
      open: time,
      high: time,
      low: time,
      close: time,
      volume: 1,
    })),
  };
  const request = f.request(f.node, {
    from: 4,
    to: 6,
    countBack: 1,
    warmupBars: 2,
    inputs: { bars: samples },
  });
  const result = await f.finite(request);
  expect(result.snapshot.range).toEqual({ from: 4, to: 6 });
  // Two warmup rows (2 and 3) come before the window.
  expect([...result.snapshot.data].map(({ total }) => total)).toEqual([9, 14]);
  // Tea would end the node with the shorter input and drop rows 4 and 5.
  const short = { ...samples, rows: samples.rows.slice(0, 3) };
  expect(
    await f.run((tea) =>
      tea
        .observe({
          ...request,
          from: 1,
          to: 10,
          inputs: { bars: samples, short },
        })
        .pipe(Effect.scoped, Effect.flip),
    ),
  ).toMatchObject({
    code: "invalid_data",
    message: "Inputs of one node end at different times",
  });
  // The Bars input comes first in graph order, yet nothing opens.
  expect(
    await f.run((tea) =>
      tea
        .observe({
          ...request,
          inputs: {
            market: Tea.barsInputs(series).inputs.bars!,
            bars: samples,
          },
          to: "now",
        })
        .pipe(Effect.scoped, Effect.flip),
    ),
  ).toMatchObject({
    code: "invalid_request",
    message: "Samples require a finite historical window",
  });
  expect(f.captures()).toBe(0);
});

it("supplies syminfo and timeframe only when a node's market inputs agree", async () => {
  const f = await fixture(
    'emit "ticker" syminfo.ticker\nemit "multiplier" timeframe.multiplier',
    [{ time: 1, close: 1 }],
  );
  const base = f.request(f.node, { from: 1, to: 2, countBack: 1, map: {} });
  const first = async (listing: typeof series.listing) =>
    (
      await f.finite({
        ...base,
        inputs: {
          ...base.inputs,
          other: Tea.barsInputs({ ...series, listing }).inputs.bars!,
        },
      })
    ).snapshot.data.get(0);
  // A different display name gives the script the same values.
  expect(
    await first({ ...series.listing, name: "Bitcoin / Tether" }),
  ).toMatchObject({ ticker: "BTCUSDT", multiplier: 1 });
  // Inputs that disagree supply nothing, so the script reads na.
  expect(await first({ ...series.listing, symbol: "ETHUSDT" })).toMatchObject({
    ticker: null,
    multiplier: NaN,
  });
});

it("reads a node that has its own request children through a NodeRef", async () => {
  const f = await fixture(
    'emit "seen" input.series("value")',
    [1, 2, 3, 4, 5, 6].map((time) => ({ time, close: time })),
  );
  const indicator = await f.compile(
    'daily = request.security("X", "1", close)\nemit "value" daily * 10',
  );
  const result = await f.finite(
    readingNode(
      f.request(f.node, { from: 3, to: 7, countBack: 1, warmupBars: 1 }),
      "indicator",
      indicator,
      { value: ["value"] },
      {
        ...Tea.barsInputs(series),
        parameters: {},
        requests: {
          daily: { ...Tea.barsInputs(series), parameters: {}, requests: {} },
        },
      },
    ),
  );
  expect([...result.snapshot.data].map(({ seen }) => seen)).toEqual([
    30, 40, 50, 60,
  ]);
  // The shared market and its warmup, then the child from the node's start.
  expect(
    f.calls.map(({ from, to, countBack }) => ({ from, to, countBack })),
  ).toEqual([
    { from: 3, to: 7, countBack: 1 },
    { from: 2, to: 3, countBack: 1 },
    { from: 2, to: 7, countBack: 1 },
    { from: 1, to: 2, countBack: 1 },
  ]);
});

it("barstate.islast follows each Source's newest row across top-level inputs, a node and its request child", async () => {
  const f = await fixture(
    'emit "last" barstate.islast ? 1 : 0\nemit "node" input.series("node.last")\nemit "child" input.series("node.child")',
    [1, 2, 3].map((time) => ({ time, close: time })),
  );
  const node = await f.compile(
    'child = request.security("X", "1", barstate.islast ? 1 : 0, fill = "carry")\nemit "last" barstate.islast ? 1 : 0\nemit "child" child',
  );
  // The child's one row is its newest, though its parent's newest comes
  // later. Its rows are pushed first, then the root's market, then the node's
  // other market, on whose rows both scripts step.
  const child: Tea.Samples = {
    _tag: "Samples",
    ...barsSeries(series, series),
    schema: Tea.barsSchema,
    rows: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
  };
  const result = await f.finite(
    readingNode(
      f.request(f.node, { from: 1, to: 4, countBack: 1, warmupBars: 0 }),
      "node",
      node,
      { "node.last": ["last"], "node.child": ["child"] },
      {
        ...Tea.barsInputs({
          ...series,
          listing: { ...series.listing, symbol: "ETHUSDT" },
        }),
        parameters: {},
        requests: {
          child: {
            ...Tea.barsInputs(series),
            inputs: { bars: child },
            parameters: {},
            requests: {},
          },
        },
      },
    ),
  );
  expect(
    [...result.snapshot.data].map(({ last, node, child }) => [
      last,
      node,
      child,
    ]),
  ).toEqual([
    [0, 0, 1],
    [0, 0, 1],
    [1, 1, 1],
  ]);
  expect(f.calls).toHaveLength(2);
});

it("starts every node while building, so validate and observe refuse a request on another timeframe before Feed", async () => {
  const f = await fixture('emit "seen" input.series("value")');
  const indicator = await f.compile(
    'daily = request.security("X", "D", close)\nemit "value" daily',
  );
  const bars = { ...Tea.barsInputs(series), parameters: {}, requests: {} };
  // The child reads the 1m market, but the script requests daily bars.
  const request = readingNode(
    f.request(f.node),
    "indicator",
    indicator,
    { value: ["value"] },
    { ...bars, requests: { daily: bars } },
  );
  const error = {
    code: "invalid_request",
    message:
      "request 'daily' expects clock 86400000000000, received 60000000000 at nodes.indicator",
  };
  expect(await f.invalid(request)).toMatchObject(error);
  expect(
    await f.run((tea) => tea.observe(request).pipe(Effect.scoped, Effect.flip)),
  ).toMatchObject(error);
  expect(f.captures()).toBe(0);
});

const listed = (provider: string, symbol: string) =>
  Schema.decodeUnknownSync(ProviderListing)({
    provider,
    listing: { symbol, currency: "USDT", name: `${symbol} on ${provider}` },
  });

it("fills in a left-out request child from its ticker id, keeping the whole listing", async () => {
  const f = await fixture(
    'eth = request.security("BINANCE:ethusdt", "", close)\nemit "eth" eth',
  );
  const eth = listed("binance", "ETHUSDT");
  f.search.mockReturnValue(
    Effect.succeed([
      listed("yfinance", "ETHUSDT"),
      eth,
      listed("binance", "ETHUSDTX"),
    ]),
  );
  // validate looks the listing up without opening any bars.
  await f.run((tea) => tea.validate(f.request(f.node)));
  expect(f.calls).toEqual([]);

  const result = await f.finite(f.request(f.node));
  expect(f.search).toHaveBeenLastCalledWith({
    query: "ethusdt",
    indexed: true,
    limit: 100,
  });
  // The parent's resolution, session and adjustment, and the found listing.
  expect(result.config.requests.eth).toEqual({
    ...Tea.barsInputs(barsSeries(eth, series)),
    parameters: {},
    requests: {},
  });
  expect(f.calls.map(({ listing }) => listing)).toContainEqual(eth.listing);
  expect([...result.snapshot.data].map((row) => row.eth)).toEqual(
    Array(10).fill(1),
  );
});

it("syminfo.tickerid names the script's own listing in request.security", async () => {
  const f = await fixture(
    'same = request.security(syminfo.tickerid, "D", close)\nemit "same" same',
  );
  const btc = { provider: series.provider, listing: series.listing };
  f.search.mockReturnValue(Effect.succeed([btc]));
  await f.run((tea) => tea.validate(f.request(f.node)));
  expect(f.search).toHaveBeenCalledWith({
    query: "BTCUSDT",
    indexed: true,
    limit: 100,
  });
});

it("fills the built-in session profile's period request from the chart market", async () => {
  const source = fs.readFileSync(
    new URL(
      "../indicators/builtins/session-volume-profile.tea",
      import.meta.url,
    ),
    "utf8",
  );
  const f = await fixture(
    source,
    Array.from({ length: 1010 }, (_, index) => ({
      time: index + 1,
      close: 10 + (index % 5),
      high: 12 + (index % 5),
      low: 9 + (index % 5),
    })),
  );
  f.search.mockReturnValue(
    Effect.succeed([{ provider: series.provider, listing: series.listing }]),
  );
  const result = await f.finite(
    f.request(f.node, {
      parameters: Tea.teaParameters(f.node.definition, {}),
    }),
  );
  // The period line asks for daily bars; the script reads the chart's own
  // bars itself, so nothing else is requested.
  expect(
    Object.fromEntries(
      Object.entries(result.config.requests).map(([name, child]) => [
        name,
        (child.inputs.bars as { resolution: string }).resolution,
      ]),
    ),
  ).toEqual({ periodStart: "1d" });
  // The period child opens from the root's first warmup row.
  expect(
    f.calls
      .filter(({ from }) => from === 1)
      .map(({ resolution }) => resolution),
  ).toEqual(["1d"]);
  // The fixture serves the same bars at every resolution, so each bar is a
  // period of its own: the last row writes the one before it, at time 1009
  // (low 12, high 15, volume 1, rising), as 24 equal rows.
  const profile = [...result.snapshot.data].at(-1)!.profile as {
    from: number;
    to: number;
    rows: { low: number; high: number; segments: { value: number }[] }[];
    levels: { y: number }[];
  };
  expect(profile).toMatchObject({ from: 1009, to: 1010 });
  expect(
    profile.rows.map(({ low, high, segments }) => [
      low,
      high,
      segments.map(({ value }) => value),
    ]),
  ).toEqual(
    Array.from({ length: 24 }, (_, k) => [
      12 + k / 8,
      12 + (k + 1) / 8,
      [expect.closeTo(1 / 24, 12), 0],
    ]),
  );
  // Every row ties, so the point of control is the lowest row's middle.
  expect(profile.levels.map(({ y }) => y)).toEqual([12.0625]);
  // Every one of the 1,010 bars is its own period here, so each writes a
  // profile; that takes over 5 s on a busy CI runner.
}, 20_000);

it("at warmup 0 the range profile reads nothing before its range, counts only the bars inside it and writes it once", async () => {
  const minute = 60_000;
  const source = fs.readFileSync(
    new URL("../indicators/builtins/volume-profile-range.tea", import.meta.url),
    "utf8",
  );
  const f = await fixture(
    source,
    [],
    defineDataFrame(BarColumns).create({
      labels: {},
      rows: Array.from({ length: 48 }, (_, i) => ({
        time: i * minute,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000 + i,
      })),
    }),
  );
  f.search.mockReturnValue(
    Effect.succeed([{ provider: series.provider, listing: series.listing }]),
  );
  const window = { from: 10 * minute, to: 48 * minute, countBack: 1 };
  const observe = (to: number) =>
    f.finite(
      f.request(f.node, {
        ...window,
        to,
        warmupBars: 0,
        parameters: Tea.teaParameters(f.node.definition, {
          rangeStart: 10 * minute,
          rangeEnd: 20 * minute,
        }),
      }),
    );
  const result = await observe(window.to);
  // Only the root's window: the script reads no other series.
  expect(
    f.calls.map(({ from, to, countBack }) => ({ from, to, countBack })),
  ).toEqual([window]);
  const written = [...result.snapshot.data].filter((row) => row.profile);
  expect(written.map((row) => row.time)).toEqual([20 * minute]);
  const { rows } = written[0]!.profile as {
    rows: { segments: { value: number }[] }[];
  };
  // sum(1000 + i) for i = 10..19; the bar before the range would add 1009.
  expect(
    rows
      .flatMap((row) => row.segments)
      .reduce((total, segment) => total + segment.value, 0),
  ).toBeCloseTo(10_145, 6);
  // A past range's run stops at the range's end, so no bar follows it: its
  // last bar, the newest, writes the same profile.
  const stopped = [...(await observe(20 * minute)).snapshot.data].filter(
    (row) => row.profile,
  );
  expect(stopped.map((row) => row.time)).toEqual([19 * minute]);
  expect(stopped[0]!.profile).toEqual(written[0]!.profile);
});

it("searches the providers when the saved index lacks the listing", async () => {
  const f = await fixture(
    'sol = request.security("binance:SOLUSDT", "", close)\nemit "sol" sol',
  );
  f.search.mockImplementation(({ indexed }) =>
    Effect.succeed([listed(indexed ? "yfinance" : "binance", "SOLUSDT")]),
  );
  await f.run((tea) => tea.validate(f.request(f.node)));
  expect(f.search.mock.calls.map(([{ indexed }]) => indexed)).toEqual([
    true,
    false,
  ]);
});

it.each([
  ['"ETHUSDT", ""', "child: 'ETHUSDT' is not a ticker id"],
  ['"nowhere:ETHUSDT", ""', "is not a ticker id"],
  ['"binance:ETHUSDT", "3"', "child: timeframe '3' has no bars"],
  ['"binance:MISSING", ""', "child: binance:MISSING names no listing"],
])(
  "a left-out child of request.security(%s) is rejected",
  async (args, message) => {
    const f = await fixture(
      `child = request.security(${args}, close)\nemit "child" child`,
    );
    expect(await f.invalid(f.request(f.node))).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining(message),
    });
    expect(f.calls).toEqual([]);
  },
);

it.each([
  [
    '"yfinance:AMD", ""',
    "amd: yfinance has no bars for this chart's session and adjustment. Use a yfinance chart.",
  ],
  ['"yfinance:AMD", "1S"', "amd: yfinance has no 1s bars."],
])(
  "a left-out child its provider can't serve, request.security(%s), names the request",
  async (args, message) => {
    const f = await fixture(
      `amd = request.security(${args}, close)\nemit "amd" amd`,
    );
    f.search.mockReturnValue(Effect.succeed([listed("yfinance", "AMD")]));
    expect(await f.invalid(f.request(f.node))).toMatchObject({
      code: "invalid_request",
      message,
    });
    expect(f.calls).toEqual([]);
  },
);

const hour = 3_600_000;
const monday = Date.UTC(2026, 0, 5);
const daily = barsSeries(series, { ...series, resolution: "1d" });
// Two days of hourly bars from Monday; each closes at its hour.
const hours = Array.from({ length: 48 }, (_, i) => ({
  time: monday + i * hour,
  close: i,
}));
// A Feed that offers daily and hourly bars only.
const dailyAndHourly = () =>
  Effect.succeed(
    (["1h", "1d"] as const).map((resolution) => ({
      resolution,
      session: "24h" as const,
      adjustment: "raw" as const,
      modes: ["history", "live"] as const,
    })),
  );

it("runs an auto script on finer bars, with its own child, while chart.timeframe names the chart's", async () => {
  const f = await fixture(
    [
      'indicator("Auto", overlay = false, timeframe = "auto")',
      'same = request.security(syminfo.tickerid, "", chart.timeframe == "D" ? 1 : 0)',
      'emit "intraday" timeframe.isintraday',
      'emit "chart" chart.timeframe',
      'emit "same" same',
    ].join("\n"),
    hours,
  );
  vi.spyOn(f.bars, "getCapabilities").mockImplementation(dailyAndHourly);
  f.search.mockReturnValue(
    Effect.succeed([{ provider: series.provider, listing: series.listing }]),
  );
  const result = await f.finite(
    f.request(f.node, {
      ...Tea.barsInputs(daily),
      from: monday + 24 * hour,
      to: monday + 48 * hour,
      countBack: 1,
      warmupBars: 2,
    }),
  );
  // The run reads hourly bars, as its config says; so does its "" child.
  expect(result.config.inputs.bars).toMatchObject({ resolution: "1h" });
  expect(result.config.requests.same?.inputs.bars).toMatchObject({
    resolution: "1h",
  });
  expect(new Set(f.calls.map(({ resolution }) => resolution))).toEqual(
    new Set(["1h"]),
  );
  // The window holds the chart's bar, so the hourly read counts back 1.
  expect(f.calls[0]).toMatchObject({
    from: monday + 24 * hour,
    to: monday + 48 * hour,
    countBack: 1,
  });
  expect([...result.snapshot.data]).toHaveLength(24);
  expect(
    new Set(
      [...result.snapshot.data].map(({ intraday, chart, same }) =>
        JSON.stringify([intraday, chart, same]),
      ),
    ),
  ).toEqual(new Set([JSON.stringify([true, "D", 1])]));

  // However far back the window reaches, the hourly read covers all of it,
  // live or finite.
  for (const to of [monday + 48 * hour, "now"] as const) {
    f.calls.length = 0;
    await f.run((tea) =>
      tea
        .observe(
          f.request(f.node, {
            ...Tea.barsInputs(daily),
            from: monday - 20_000 * hour,
            to,
            countBack: 500,
            warmupBars: 0,
          }),
        )
        .pipe(Effect.scoped),
    );
    expect(f.calls[0]).toMatchObject({
      resolution: "1h",
      from: monday - 20_000 * hour,
      to,
      countBack: 1,
    });
  }
});

it("starts an auto script's finer bars where the provider keeps them", async () => {
  const f = await fixture('emit "close" close', hours);
  vi.spyOn(f.bars, "getCapabilities").mockImplementation(dailyAndHourly);
  const auto = await f.compile(
    'indicator("Close", overlay = false, timeframe = "auto")\nemit "close" close',
  );
  // Hourly bars exist only from Tuesday, as a provider's retention ends.
  const tuesday = monday + 24 * hour;
  const observe = f.bars.observe;
  const hourlyFrom: number[] = [];
  vi.spyOn(f.bars, "observe").mockImplementation((request) => {
    if (request.resolution !== "1h") return observe(request);
    hourlyFrom.push(request.from);
    return request.from < tuesday
      ? Effect.fail(
          new FeedError({
            reason: new FeedReasons.HistoryUnavailable({
              provider: ProviderId.make("binance"),
              availableFrom: tuesday,
            }),
          }),
        )
      : observe(request);
  });
  const result = await f.finite(
    f.request(auto, {
      ...Tea.barsInputs(daily),
      from: monday,
      to: monday + 48 * hour,
      countBack: 1,
      warmupBars: 0,
    }),
  );
  // Still hourly, from where they start; the chart's bars aren't read.
  expect(result.config.inputs.bars).toMatchObject({ resolution: "1h" });
  expect(hourlyFrom).toEqual([monday, tuesday]);
  expect(f.calls.map(({ resolution }) => resolution)).toEqual(["1h"]);
  expect([...result.snapshot.data].map(({ close }) => close)).toEqual(
    hours.slice(24).map(({ close }) => close),
  );
});

it("runs an auto script on the timeframe its header parameter chooses", async () => {
  const f = await fixture('emit "close" close', hours);
  vi.spyOn(f.bars, "getCapabilities").mockImplementation(() =>
    Effect.succeed(
      (["1h", "4h", "1d"] as const).map((resolution) => ({
        resolution,
        session: "24h" as const,
        adjustment: "raw" as const,
        modes: ["history", "live"] as const,
      })),
    ),
  );
  const auto = await f.compile(
    'indicator("Close", overlay = false, timeframe = "auto")\nemit "close" close',
  );
  const window = {
    ...Tea.barsInputs(daily),
    from: monday,
    to: monday + 48 * hour,
    countBack: 1,
    warmupBars: 0,
  };
  // The header's `timeframe` parameter chooses the bars, and the run reports
  // the timeframe it read.
  const result = await f.finite(
    f.request(auto, { ...window, parameters: { timeframe: "240" } }),
  );
  expect(result.config.inputs.bars).toMatchObject({ resolution: "4h" });
  expect(result.config.parameters).toEqual({ timeframe: "240" });
  expect(f.calls.map(({ resolution }) => resolution)).toEqual(["4h"]);
  // Left to the service, it picks hourly bars and says so.
  const picked = await f.finite(
    f.request(auto, { ...window, parameters: { timeframe: "" } }),
  );
  expect(picked.config.parameters).toEqual({ timeframe: "60" });
  // Bars the provider lacks, or coarser than the chart's, are refused.
  for (const timeframe of ["15", "W", "7"])
    expect(
      await f.invalid(
        f.request(auto, { ...window, parameters: { timeframe } }),
      ),
    ).toMatchObject({ code: "invalid_request" });
});

it("resolves a default that follows the chart for each run and reports it", async () => {
  const f = await fixture('emit "close" close', hours);
  const script = await f.compile(
    [
      'range = input.string(chart.timeframe == "D" ? "Monthly" : "Daily", "Range", options = ["Daily", "Monthly"])',
      'length = input.int(2, "Length")',
      'emit "close" close',
    ].join("\n"),
  );
  expect(
    script.definition.parameters.map(({ name, chartDefault }) => ({
      name,
      chartDefault,
    })),
  ).toEqual([
    { name: "range", chartDefault: true },
    { name: "length", chartDefault: undefined },
  ]);
  const run = (resolution: "1h" | "1d", parameters: Tea.ParameterOverrides) =>
    f.request(script, {
      ...Tea.barsInputs(barsSeries(series, { ...series, resolution })),
      parameters,
      from: monday,
      to: monday + 48 * hour,
      countBack: 1,
      warmupBars: 0,
    });
  // Left out, the range follows each run's chart, and the run says which.
  for (const [resolution, range] of [
    ["1d", "Monthly"],
    ["1h", "Daily"],
  ] as const)
    expect(
      (await f.finite(run(resolution, { length: 3 }))).config.parameters,
    ).toEqual({ range, length: 3 });
  // A chosen one stays, and other parameters stay required.
  expect(
    (await f.finite(run("1d", { range: "Daily", length: 3 }))).config
      .parameters,
  ).toEqual({ range: "Daily", length: 3 });
  expect(await f.invalid(run("1d", { range: "Daily" }))).toMatchObject({
    code: "invalid_request",
  });
});

it("an alert and the auto Indicator it reads through a NodeRef share one finer Source", async () => {
  const f = await fixture(
    'emit "seen" input.series("indicator.value")\nemit "intraday" timeframe.isintraday\nemit "chart" chart.timeframe',
    hours,
  );
  vi.spyOn(f.bars, "getCapabilities").mockImplementation(dailyAndHourly);
  const indicator = await f.compile(
    'indicator("Close", overlay = false, timeframe = "auto")\nemit "value" close',
  );
  const bars = { ...Tea.barsInputs(daily), parameters: {}, requests: {} };
  const result = await f.finite(
    readingNode(
      f.request(f.node, {
        ...Tea.barsInputs(daily),
        from: monday,
        to: monday + 48 * hour,
        countBack: 1,
        warmupBars: 0,
      }),
      "indicator",
      indicator,
      { "indicator.value": ["value"] },
      bars,
    ),
  );
  // One hourly read serves both, and they step together.
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({ resolution: "1h" });
  expect(result.config.inputs.bars).toMatchObject({ resolution: "1h" });
  expect(
    [...result.snapshot.data].map(({ seen, intraday, chart }) => [
      seen,
      intraday,
      chart,
    ]),
  ).toEqual(hours.map(({ close }) => [close, true, "D"]));
});

it("runs once more on the chart's bars when Feed can't serve the finer ones, releasing the first attempt", async () => {
  const f = await fixture('emit "close" close', hours);
  vi.spyOn(f.bars, "getCapabilities").mockImplementation(dailyAndHourly);
  const auto = await f.compile(
    'indicator("Close", overlay = false, timeframe = "auto")\nemit "close" close',
  );
  // The hourly window opens; its warmup read fails, as past a retention.
  const observe = f.bars.observe;
  vi.spyOn(f.bars, "observe").mockImplementation((request) =>
    request.resolution === "1h" && request.to !== "now"
      ? Effect.fail(
          new FeedError({
            reason: new FeedReasons.HistoryUnavailable({
              provider: ProviderId.make("binance"),
              availableFrom: monday,
            }),
          }),
        )
      : observe(request),
  );
  const scope = Effect.runSync(Scope.make());
  const session = await f.runtime.runPromise(
    Effect.flatMap(Tea.Service, (tea) =>
      tea.observe(
        f.request(auto, {
          ...Tea.barsInputs(daily),
          from: monday + 24 * hour,
          to: "now",
          countBack: 1,
          warmupBars: 2,
        }),
      ),
    ).pipe(Scope.provide(scope)),
  );
  expect(session.config.inputs.bars).toMatchObject({ resolution: "1d" });
  expect(f.calls.map(({ resolution }) => resolution)).toEqual([
    "1h",
    "1d",
    "1d",
  ]);
  // The failed attempt's hourly session is released; the daily run goes on.
  expect(f.releases()).toBe(1);
  await Effect.runPromise(Scope.close(scope, Exit.void));
  expect(f.releases()).toBe(3);
});

it("runs on supplied history alone, filling a left-out request child from it", async () => {
  const f = await fixture('emit "close" close');
  const weekly = await f.compile(
    'weekStart = request.security(syminfo.tickerid, "W", time, fill = "carry")\nemit "weekStart" weekStart',
  );
  const day = 24 * hour;
  const samples = (resolution: "1d" | "1W", times: number[]): Tea.Samples => ({
    _tag: "Samples",
    ...barsSeries(series, { ...series, resolution }),
    schema: Tea.barsSchema,
    rows: times.map((time) => ({
      time,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    })),
  });
  // Two weeks of days from a Monday, and those two weeks' bars.
  const days = samples(
    "1d",
    Array.from({ length: 14 }, (_, index) => monday + index * day),
  );
  const weeks = samples("1W", [monday, monday + 7 * day]);
  const window = {
    inputs: { bars: days },
    from: monday,
    to: monday + 14 * day,
    countBack: 1,
  };
  const result = await f.finite(
    f.request(weekly, { ...window, samples: [weeks] }),
  );
  expect(result.config.requests.weekStart!.inputs.bars).toEqual(weeks);
  expect([...result.snapshot.data].map(({ weekStart }) => weekStart)).toEqual([
    ...Array<number>(7).fill(monday),
    ...Array<number>(7).fill(monday + 7 * day),
  ]);
  // Neither bars nor listings came from Feed.
  expect(f.calls).toEqual([]);
  expect(f.search).not.toHaveBeenCalled();
  // Without those bars it fails, naming the request; a Bars input, which
  // would read Feed, fails too.
  expect(
    await f.invalid(f.request(weekly, { ...window, samples: [] })),
  ).toMatchObject({
    code: "invalid_request",
    message: expect.stringContaining(
      "weekStart: the supplied history has no BTCUSDT 1W bars",
    ),
  });
  expect(
    await f.invalid(
      f.request(weekly, { ...window, ...Tea.barsInputs(daily), samples: [] }),
    ),
  ).toMatchObject({
    code: "invalid_request",
    message: expect.stringContaining("reads only supplied history"),
  });
  expect(f.calls).toEqual([]);
});

it("runs Samples an auto script reads as given", async () => {
  const f = await fixture('emit "close" close');
  const auto = await f.compile(
    'indicator("Auto", overlay = false, timeframe = "auto")\nemit "intraday" timeframe.isintraday\nemit "chart" chart.timeframe',
  );
  const samples: Tea.Samples = {
    _tag: "Samples",
    ...daily,
    schema: Tea.barsSchema,
    rows: [1, 2].map((d) => ({
      time: monday + d * 24 * hour,
      open: d,
      high: d,
      low: d,
      close: d,
      volume: 1,
    })),
  };
  const result = await f.finite(
    f.request(auto, {
      inputs: { bars: samples },
      from: monday,
      to: monday + 3 * 24 * hour,
      countBack: 1,
    }),
  );
  expect(result.config.inputs.bars).toEqual(samples);
  expect(
    [...result.snapshot.data].map(({ intraday, chart }) => [intraday, chart]),
  ).toEqual([
    [false, "D"],
    [false, "D"],
  ]);
  expect(f.captures()).toBe(0);
});
