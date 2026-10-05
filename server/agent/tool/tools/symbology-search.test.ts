// Purpose: Locks Agent search identity, live Feed selection, permission ordering, and failure/cancellation propagation.

import { FeedError, FeedReasons, SymbolSearchResult } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { InvalidArgumentsError } from "@openchart/server/agent/tool/errors";
import * as Tool from "@openchart/server/agent/tool/tool";
import { Feed } from "@openchart/server/feed/service";
import type { ISymbologyFeedService } from "@openchart/server/feed/symbology/service";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { expect, test, vi } from "vitest";
import { Parameters, SymbologySearchTool } from "./symbology-search";

const context: Tool.Context = {
  rootRunID: "agr_test",
  sessionID: "session",
  messageID: "message",
  callID: "call",
  agent: "analyst",
  messages: [],
  metadata: () => Effect.die("Unexpected progress"),
  ask: () => Effect.void,
};

function fixture(search: ISymbologyFeedService["search"]) {
  const get = vi.fn(() =>
    Effect.succeed({
      symbology: {
        index: () => Effect.die("Unexpected index"),
        indexStatus: () => Effect.succeed([]),
        search,
      },
      bars: {
        getCapabilities: () => Effect.die("Unexpected bars access"),
        observe: () => Effect.die("Unexpected bars access"),
      },
      logos: { getLogo: () => Effect.die("Unexpected logo access") },
      calendar: { getCalendar: () => Effect.die("Unexpected calendar access") },
    }),
  );
  return {
    get,
    getVersion: () => Effect.die("Search must not require a Feed version"),
  } satisfies Feed["Service"];
}

test("groups live results by query in input order and preserves provider identities", async () => {
  const listings = Schema.decodeUnknownSync(SymbolSearchResult)([
    {
      provider: "yfinance",
      listing: {
        symbol: "ABC",
        currency: "USD",
        name: "Example",
        venue: "NMS",
      },
    },
    {
      provider: "other",
      listing: {
        symbol: "ABC",
        currency: "USD",
        id: 42,
        instrument: { id: "native-42", isin: "example" },
      },
    },
  ]);
  const input = {
    queries: ["ABC", "MSFT"],
    limit: 10,
    assetClass: "stock",
  } as const;
  const search = vi.fn<ISymbologyFeedService["search"]>((request) =>
    Effect.succeed(request.query === "ABC" ? listings : []),
  );
  const feed = fixture(search);
  const ask = vi.fn<Tool.Context["ask"]>(() => Effect.void);
  await Effect.runPromise(
    Effect.gen(function* () {
      const tool = yield* Tool.init(yield* SymbologySearchTool);
      expect(tool.parameters).toBe(Parameters);
      expect(feed.get).not.toHaveBeenCalled();
      const result = yield* tool.execute(input, { ...context, ask });
      expect(result.output).toEqual({
        type: "json",
        value: [
          { query: "ABC", listings },
          { query: "MSFT", listings: [] },
        ],
      });
      expect(search.mock.calls).toEqual([
        [{ query: "ABC", limit: 10, assetClass: "stock", indexed: true }],
        [{ query: "MSFT", limit: 10, assetClass: "stock", indexed: true }],
      ]);
      expect(feed.get).toHaveBeenCalledOnce();
      expect(ask).toHaveBeenCalledExactlyOnceWith({
        permission: "symbology_search",
        patterns: ["ABC", "MSFT"],
        always: ["*"],
        metadata: input,
      });
      feed.get.mockReturnValueOnce(
        Effect.succeed({
          ...(yield* feed.get()),
          symbology: {
            index: () => Effect.die("Unexpected index"),
            indexStatus: () => Effect.succeed([]),
            search: () => Effect.succeed([]),
          },
        }),
      );
      expect((yield* tool.execute(input, context)).output).toEqual({
        type: "json",
        value: [
          { query: "ABC", listings: [] },
          { query: "MSFT", listings: [] },
        ],
      });
      expect(search).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provideService(Feed, feed)),
  );
});

test("waits for permission before reading Feed and preserves rejection", async () => {
  const feed = fixture(() => Effect.die("Search must not start"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const tool = yield* Tool.init(yield* SymbologySearchTool);
      const asked = yield* Deferred.make<void>();
      const approval = yield* Deferred.make<void, string>();
      const call = yield* tool
        .execute(
          { queries: ["AAPL", "MSFT"], limit: 5 },
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

test.each([
  { queries: [], limit: 5 },
  { queries: ["AAPL", ""], limit: 5 },
  { queries: Array.from({ length: 11 }, () => "AAPL"), limit: 5 },
  { queries: ["AAPL"] },
  { queries: ["AAPL"], limit: 0 },
  { queries: ["AAPL"], limit: 1.5 },
  { queries: ["AAPL"], limit: 5, assetClass: "invalid" },
  { queries: ["AAPL"], limit: 5, indexed: true },
  { query: "AAPL", limit: 5 },
])(
  "rejects invalid batch input before permission or Feed access: %j",
  async (input) => {
    const ask = vi.fn<Tool.Context["ask"]>(() => Effect.void);
    const feed = fixture(() => Effect.die("Unexpected search"));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const tool = yield* Tool.init(yield* SymbologySearchTool);
        return yield* Effect.result(tool.execute(input, { ...context, ask }));
      }).pipe(Effect.provideService(Feed, feed)),
    );
    expect(Result.isFailure(result) && result.failure).toBeInstanceOf(
      InvalidArgumentsError,
    );
    expect(ask).not.toHaveBeenCalled();
    expect(feed.get).not.toHaveBeenCalled();
  },
);

test("fails the whole batch on a Feed error without retrying", async () => {
  const error = new FeedError({
    reason: new FeedReasons.SourceUnavailable({
      provider: ProviderId.make("yfinance"),
    }),
  });
  const search = vi.fn<ISymbologyFeedService["search"]>((request) =>
    request.query === "MSFT" ? Effect.fail(error) : Effect.succeed([]),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const tool = yield* Tool.init(yield* SymbologySearchTool);
      return yield* Effect.result(
        tool.execute({ queries: ["AAPL", "MSFT"], limit: 5 }, context),
      );
    }).pipe(Effect.provideService(Feed, fixture(search))),
  );
  expect(Result.isFailure(result) && result.failure).toBe(error);
  expect(search.mock.calls.map(([request]) => request.query)).toEqual([
    "AAPL",
    "MSFT",
  ]);
});

test("cancels an in-flight Feed search with its calling fiber", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finished = vi.fn();
      const feed = fixture(() =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          return yield* Effect.never;
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              finished();
            }),
          ),
        ),
      );
      const tool = yield* Tool.init(yield* SymbologySearchTool);
      const call = yield* tool
        .execute({ queries: ["AAPL", "MSFT"], limit: 5 }, context)
        .pipe(Effect.provideService(Feed, feed), Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(call);
      const result = yield* Fiber.await(call);
      expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(
        true,
      );
      expect(finished).toHaveBeenCalledOnce();
    }),
  );
});
