// Purpose: Verify finite Feed reads, model-readable bars, and permission/scope boundaries.

import {
  FeedError,
  FeedReasons,
  type BarsCapabilities,
  type BarsSnapshot,
} from "@openchart/feed";
import { BarColumns, ProviderId } from "@openchart/market";
import { providerToolInputSchema } from "@openchart/models/provider-tools";
import { InvalidArgumentsError } from "@openchart/server/agent/tool/errors";
import * as Tool from "@openchart/server/agent/tool/tool";
import type { IBarsFeedService } from "@openchart/server/feed/bar/service";
import { Feed } from "@openchart/server/feed/service";
import { defineDataFrame } from "@openchart/timeseries";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  JsonSchema,
  Result,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { expect, test, vi } from "vitest";
import { MarketDataWindowTooLarge } from "./errors";
import { MarketDataTool, Parameters } from "./market-data";

const context: Tool.Context = {
  rootRunID: "agr_market_data",
  sessionID: "session",
  messageID: "message",
  callID: "call",
  agent: "analyst",
  messages: [],
  metadata: () => Effect.die("Unexpected progress"),
  ask: () => Effect.void,
};
const identity = {
  provider: "yfinance",
  listing: {
    symbol: "ABC",
    currency: "USD",
    venue: "NMS",
    instrument: { id: "native-42" },
  },
};
const series = {
  ...identity,
  resolution: "1d",
  session: "regular",
  adjustment: "split",
} as const;
const request = {
  operation: "bars",
  ...series,
  from: 200,
  to: 500,
  countBack: 2,
} as const;
const capabilitiesRequest = { operation: "capabilities", ...identity } as const;
const frame = defineDataFrame({ ...BarColumns, final: Schema.Boolean });
const rows = [
  { time: 100, open: -2, high: 0, low: -3, close: -1, volume: 0, final: true },
  {
    time: 200,
    open: null,
    high: 2,
    low: NaN,
    close: 1.23456789,
    volume: null,
    final: true,
  },
];
const snapshot: BarsSnapshot = {
  range: { from: 100, to: 500 },
  data: frame.create({ labels: { symbol: "ABC" }, rows }),
  hasMoreBefore: true,
};

function fixture(bars: Partial<IBarsFeedService> = {}) {
  const get = vi.fn(() =>
    Effect.succeed({
      bars: {
        observe: () => Effect.die("Unexpected observation"),
        getCapabilities: () => Effect.die("Unexpected capabilities"),
        ...bars,
      } satisfies IBarsFeedService,
      symbology: {
        search: () => Effect.die("Unexpected search"),
        index: () => Effect.die("Unexpected index"),
        indexStatus: () => Effect.die("Unexpected index status"),
      },
      logos: { getLogo: () => Effect.die("Unexpected logos") },
      series: { select: () => Effect.die("Unexpected series") },
      calendar: { getCalendar: () => Effect.die("Unexpected calendar") },
    }),
  );
  return {
    get,
    getVersion: () => Effect.die("No version precondition"),
  } satisfies Feed["Service"];
}

test("returns complete OHLCV with source identity, coverage, and null gaps", async () => {
  const closed = vi.fn();
  const observe = vi.fn<IBarsFeedService["observe"]>(() =>
    Effect.acquireRelease(Effect.succeed({ snapshot }), () =>
      Effect.sync(() => {
        closed();
      }),
    ),
  );
  const feed = fixture({ observe });
  const ask = vi.fn<Tool.Context["ask"]>(() => Effect.void);
  await Effect.runPromise(
    Effect.gen(function* () {
      const tool = yield* Tool.init(yield* MarketDataTool);
      expect(feed.get).not.toHaveBeenCalled();
      const result = yield* tool.execute({ request }, { ...context, ask });
      expect(result.output).toEqual({
        type: "json",
        value: {
          series,
          range: snapshot.range,
          hasMoreBefore: true,
          bars: [
            { time: 100, open: -2, high: 0, low: -3, close: -1, volume: 0 },
            {
              time: 200,
              open: null,
              high: 2,
              low: null,
              close: 1.23456789,
              volume: null,
            },
          ],
        },
      });
      expect(JSON.parse(JSON.stringify(result.output))).toEqual(result.output);
      expect([...snapshot.data]).toEqual(rows);
      expect(closed).toHaveBeenCalledOnce();
      expect(observe).toHaveBeenCalledExactlyOnceWith({
        ...series,
        from: 200,
        to: 500,
        countBack: 2,
      });
      expect(ask).toHaveBeenCalledExactlyOnceWith({
        permission: "market_data",
        patterns: ["yfinance:ABC"],
        always: ["*"],
        metadata: request,
      });
      expect(feed.get).toHaveBeenCalledOnce();
    }).pipe(Effect.provideService(Feed, feed)),
  );
});

test("resolves now once before observation and releases the source before returning", async () => {
  const closed = vi.fn();
  const observe = vi.fn<IBarsFeedService["observe"]>(() =>
    Effect.acquireRelease(
      Effect.succeed({
        snapshot: { ...snapshot, range: { from: 100, to: 10_000 } },
      }),
      () =>
        Effect.sync(() => {
          closed();
        }),
    ),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(10_000);
      const tool = yield* Tool.init(yield* MarketDataTool);
      const result = yield* tool.execute(
        { request: { ...request, to: "now" } },
        context,
      );
      expect(observe.mock.calls[0]?.[0].to).toBe(10_000);
      expect(result.output).toMatchObject({ value: { range: { to: 10_000 } } });
      expect(closed).toHaveBeenCalledOnce();
    }).pipe(
      Effect.provideService(Feed, fixture({ observe })),
      Effect.provide(TestClock.layer()),
    ),
  );
});

test("reads current capabilities on every call and preserves combinations and delivery modes", async () => {
  const capabilities: BarsCapabilities = [
    {
      resolution: "1d",
      session: "regular",
      adjustment: "split",
      modes: ["history", "delayed"],
    },
  ];
  const getCapabilities = vi.fn<IBarsFeedService["getCapabilities"]>(() =>
    Effect.succeed(capabilities),
  );
  const feed = fixture({ getCapabilities });
  await Effect.runPromise(
    Effect.gen(function* () {
      const tool = yield* Tool.init(yield* MarketDataTool);
      expect(feed.get).not.toHaveBeenCalled();
      expect(
        (yield* tool.execute({ request: capabilitiesRequest }, context)).output,
      ).toEqual({
        type: "json",
        value: { ...identity, capabilities },
      });
      const replacement = fixture({
        getCapabilities: () => Effect.succeed([]),
      });
      feed.get.mockReturnValueOnce(replacement.get());
      expect(
        (yield* tool.execute({ request: capabilitiesRequest }, context)).output,
      ).toEqual({
        type: "json",
        value: { ...identity, capabilities: [] },
      });
      expect(getCapabilities).toHaveBeenCalledExactlyOnceWith(identity);
      expect(feed.get).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provideService(Feed, feed)),
  );
});

test("projects an object schema accepted by native tool adapters for both operations", () => {
  const document = JsonSchema.toDocumentDraft07(
    Schema.toJsonSchemaDocument(Parameters),
  );
  expect(document.schema.type).toBe("object");
  const native = providerToolInputSchema({
    ...document.schema,
    definitions: document.definitions,
  });
  for (const input of [request, capabilitiesRequest]) {
    expect(native.parse({ request: input })).toEqual({ request: input });
  }
});

test.each([
  {},
  { request: { ...request, operation: "quote" } },
  { request: { ...request, provider: undefined } },
  { request: { ...request, listing: { symbol: "ABC" } } },
  { request: { ...request, resolution: "2d" } },
  { request: { ...request, session: "invalid" } },
  { request: { ...request, adjustment: "invalid" } },
  { request: { ...request, from: 500 } },
  { request: { ...request, from: 501 } },
  { request: { ...request, from: 1.5 } },
  { request: { ...request, to: undefined } },
  { request: { ...request, countBack: 0 } },
  { request: { ...request, countBack: 1.5 } },
  { request: { ...request, countBack: 1001 } },
  { request: { ...request, limit: 10 } },
  { request: { ...capabilitiesRequest, from: 100 } },
  { request, extra: true },
])(
  "rejects invalid input before permission and Feed access: %j",
  async (input) => {
    const feed = fixture();
    const ask = vi.fn<Tool.Context["ask"]>(() => Effect.void);
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const tool = yield* Tool.init(yield* MarketDataTool);
        return yield* Effect.flip(tool.execute(input, { ...context, ask }));
      }).pipe(Effect.provideService(Feed, feed)),
    );
    expect(error).toBeInstanceOf(InvalidArgumentsError);
    expect(ask).not.toHaveBeenCalled();
    expect(feed.get).not.toHaveBeenCalled();
  },
);

test.each([0, 1000, 1001])(
  "returns an intact window or an explicit size error for %i bars",
  async (count) => {
    const closed = vi.fn();
    const data = frame.create({
      labels: {},
      rows: Array.from({ length: count }, (_, index) => ({
        ...rows[0]!,
        time: index,
      })),
    });
    const observe = vi.fn<IBarsFeedService["observe"]>(() =>
      Effect.acquireRelease(
        Effect.succeed({
          snapshot: {
            data,
            range: { from: 0, to: 2000 },
            hasMoreBefore: false,
          },
        }),
        () =>
          Effect.sync(() => {
            closed();
          }),
      ),
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const tool = yield* Tool.init(yield* MarketDataTool);
        return yield* Effect.result(
          tool.execute({ request: { ...request, from: 0, to: 2000 } }, context),
        );
      }).pipe(Effect.provideService(Feed, fixture({ observe }))),
    );
    if (count > 1000) {
      expect(Result.isFailure(result) && result.failure).toBeInstanceOf(
        MarketDataWindowTooLarge,
      );
      expect(Result.isFailure(result) && String(result.failure)).toContain(
        "Shorten the time window",
      );
    } else {
      expect(result).toMatchObject({
        success: { output: { type: "json", value: { hasMoreBefore: false } } },
      });
      if (Result.isSuccess(result) && result.success.output.type === "json") {
        expect(result.success.output.value).toHaveProperty(
          "bars.length",
          count,
        );
      }
    }
    expect(closed).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledOnce();
  },
);

test("waits for permission and propagates refusal before reading Feed", async () => {
  const feed = fixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const tool = yield* Tool.init(yield* MarketDataTool);
      const asked = yield* Deferred.make<void>();
      const approval = yield* Deferred.make<void, string>();
      const call = yield* tool
        .execute(
          { request },
          {
            ...context,
            ask: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(asked, undefined);
                yield* Deferred.await(approval);
              }),
          },
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(asked);
      expect(feed.get).not.toHaveBeenCalled();
      yield* Deferred.fail(approval, "denied");
      expect(yield* Effect.result(Fiber.join(call))).toEqual(
        Result.fail("denied"),
      );
      expect(feed.get).not.toHaveBeenCalled();
    }).pipe(Effect.provideService(Feed, feed)),
  );
});

test.each([request, capabilitiesRequest])(
  "propagates Feed failures without retrying: $operation",
  async (input) => {
    const failure = new FeedError({
      reason: new FeedReasons.SourceUnavailable({
        provider: ProviderId.make("yfinance"),
      }),
    });
    const closed = vi.fn();
    const observe = vi.fn<IBarsFeedService["observe"]>(() =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            closed();
          }),
        );
        return yield* Effect.fail(failure);
      }),
    );
    const getCapabilities = vi.fn<IBarsFeedService["getCapabilities"]>(() =>
      Effect.fail(failure),
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const tool = yield* Tool.init(yield* MarketDataTool);
        return yield* Effect.flip(tool.execute({ request: input }, context));
      }).pipe(
        Effect.provideService(Feed, fixture({ observe, getCapabilities })),
      ),
    );
    expect(result).toBe(failure);
    expect(observe).toHaveBeenCalledTimes(input.operation === "bars" ? 1 : 0);
    expect(getCapabilities).toHaveBeenCalledTimes(
      input.operation === "capabilities" ? 1 : 0,
    );
    expect(closed).toHaveBeenCalledTimes(input.operation === "bars" ? 1 : 0);
  },
);

test("interrupting the tool cancels and closes an in-flight observation", async () => {
  const closed = vi.fn();
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const observe = vi.fn<IBarsFeedService["observe"]>(() =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed();
            }),
          );
          yield* Deferred.succeed(started, undefined);
          return yield* Effect.never;
        }),
      );
      const tool = yield* Tool.init(yield* MarketDataTool);
      const call = yield* tool
        .execute({ request }, context)
        .pipe(
          Effect.provideService(Feed, fixture({ observe })),
          Effect.forkChild,
        );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(call);
      const result = yield* Fiber.await(call);
      expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(
        true,
      );
      expect(closed).toHaveBeenCalledOnce();
      expect(observe).toHaveBeenCalledOnce();
    }),
  );
});
