// Purpose: Verify Binance-owned quotas, throttling and host choice at its HTTP client boundary.
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { expect, test, vi } from "vitest";
import {
  DatasetFailure,
  DatasetReasons,
  type DatasetReason,
} from "@openchart/server/data/dataset";
import { chooseHost, makeClient, pickHost, request } from "./client";

test.each([undefined, "120"])(
  "Binance admits 31 cold-start kline requests without waiting (IP weight: %s)",
  async (usedWeight) => {
    const raw = vi.fn(async () =>
      Response.json([], {
        headers:
          usedWeight === undefined
            ? {}
            : { "x-mbx-used-weight-1m": usedWeight },
      }),
    );
    const { fetch } = await Effect.runPromise(
      makeClient(raw).pipe(Effect.provide(TestClock.layer())),
    );
    // Keep quota time frozen: these requests must finish without any refill.
    const signal = AbortSignal.timeout(1000);
    const responses = await Promise.all(
      Array.from({ length: 31 }, () =>
        fetch("https://example.test/api/v3/klines", { signal }),
      ),
    );
    expect(responses.every((response) => response.ok)).toBe(true);
    expect(raw).toHaveBeenCalledTimes(31);
  },
);

test("the next fixed window restores the full quota without an extra refill delay", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const raw = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
        String(input).endsWith("exchangeInfo")
          ? Response.json({
              rateLimits: [
                {
                  rateLimitType: "REQUEST_WEIGHT",
                  interval: "SECOND",
                  intervalNum: 1,
                  limit: 2,
                },
              ],
            })
          : Response.json([]),
      );
      const { fetch: clientFetch } = yield* makeClient(raw);
      yield* Effect.promise(() =>
        clientFetch("https://example.test/api/v3/exchangeInfo"),
      );
      yield* TestClock.adjust("999 millis");
      yield* Effect.promise(() =>
        clientFetch("https://example.test/api/v3/klines"),
      );
      const controller = new AbortController();
      const pending = clientFetch("https://example.test/api/v3/klines", {
        signal: controller.signal,
      });
      const settled = Promise.allSettled([pending]);
      try {
        expect(raw).toHaveBeenCalledTimes(2);
        yield* TestClock.adjust("1 milli");
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(raw).toHaveBeenCalledTimes(3)),
        );
        expect((yield* Effect.promise(() => pending)).ok).toBe(true);
      } finally {
        controller.abort();
        yield* Effect.promise(() => settled);
      }
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

test("requests heavier than the advertised window fail instead of waiting forever", async () => {
  const raw = vi.fn(async () =>
    Response.json({
      rateLimits: [
        {
          rateLimitType: "REQUEST_WEIGHT",
          interval: "SECOND",
          intervalNum: 1,
          limit: 1,
        },
      ],
    }),
  );
  const { fetch: clientFetch } = await Effect.runPromise(makeClient(raw));
  await clientFetch("https://example.test/api/v3/exchangeInfo");
  await expect(
    clientFetch("https://example.test/api/v3/klines"),
  ).rejects.toMatchObject({ reason: { _tag: "Dataset.RateLimited" } });
  expect(raw).toHaveBeenCalledTimes(1);
});

test("advertised weights and used-weight headers prevent requests exceeding the shared IP budget", async () => {
  const raw = vi.fn(async () =>
    Response.json(
      {
        rateLimits: [
          {
            rateLimitType: "REQUEST_WEIGHT",
            interval: "DAY",
            intervalNum: 1,
            limit: 40,
          },
        ],
      },
      { headers: { "x-mbx-used-weight-1d": "40" } },
    ),
  );
  const { fetch } = await Effect.runPromise(makeClient(raw));
  await fetch("https://example.test/api/v3/exchangeInfo");
  const controller = new AbortController();
  const pending = fetch("https://example.test/api/v3/klines", {
    signal: controller.signal,
  });
  const rejection = expect(pending).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(raw).toHaveBeenCalledTimes(1);
  controller.abort();
  await rejection;
});

test.each([429, 418])(
  "Binance retries throttling status %i at most four times",
  async (status) => {
    const raw = vi.fn(
      async () =>
        new Response(null, { status, headers: { "retry-after": "0" } }),
    );
    const { fetch } = await Effect.runPromise(makeClient(raw));
    expect((await fetch("https://example.test/api/v3/klines")).status).toBe(
      status,
    );
    expect(raw).toHaveBeenCalledTimes(4);
  },
);

test("every retry consumes Binance quota", async () => {
  const raw = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
    String(input).endsWith("exchangeInfo")
      ? Response.json({
          rateLimits: [
            {
              rateLimitType: "RAW_REQUESTS",
              interval: "DAY",
              intervalNum: 1,
              limit: 2,
            },
          ],
        })
      : new Response(null, { status: 429, headers: { "retry-after": "0" } }),
  );
  const { fetch: clientFetch } = await Effect.runPromise(makeClient(raw));
  await clientFetch("https://example.test/api/v3/exchangeInfo");
  const controller = new AbortController();
  const pending = clientFetch("https://example.test/api/v3/klines", {
    signal: controller.signal,
  });
  const rejection = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(raw).toHaveBeenCalledTimes(3));
  // Two admitted attempts exhaust the advertised RAW_REQUESTS budget.
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(raw).toHaveBeenCalledTimes(3);
  controller.abort();
  await rejection;
});

test("a request waiting for quota observes a concurrent cooldown before sending", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      let release!: (response: Response) => void;
      const throttled = new Promise<Response>((resolve) => {
        release = resolve;
      });
      const raw = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        if (String(input).endsWith("exchangeInfo"))
          return Response.json(
            {
              rateLimits: [
                {
                  rateLimitType: "REQUEST_WEIGHT",
                  interval: "SECOND",
                  intervalNum: 1,
                  limit: 40,
                },
              ],
            },
            { headers: { "x-mbx-used-weight-1s": "38" } },
          );
        return raw.mock.calls.length === 2 ? throttled : Response.json([]);
      });
      const { fetch: clientFetch } = yield* makeClient(raw);
      yield* Effect.promise(() =>
        clientFetch("https://example.test/api/v3/exchangeInfo"),
      );
      const controller = new AbortController();
      const pending = [
        clientFetch("https://example.test/api/v3/klines", {
          signal: controller.signal,
        }),
        clientFetch("https://example.test/api/v3/klines", {
          signal: controller.signal,
        }),
      ];
      const settled = Promise.allSettled(pending);
      try {
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(raw).toHaveBeenCalledTimes(2)),
        );
        release(
          new Response(null, { status: 429, headers: { "retry-after": "2" } }),
        );
        yield* TestClock.adjust("1 second");
        // Quota resets now, but both requests must honor the two-second cooldown.
        expect(raw).toHaveBeenCalledTimes(2);
        yield* TestClock.adjust("1 second");
        const responses = yield* Effect.promise(() => Promise.all(pending));
        expect(responses.every((response) => response.ok)).toBe(true);
        expect(raw).toHaveBeenCalledTimes(4);
      } finally {
        controller.abort();
        yield* Effect.promise(() => settled);
      }
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

const vision = "https://data-api.binance.vision";
const binanceCom = "https://api.binance.com";

/** Answers each host's ping with a status after a delay; a missing delay never answers. */
const pings =
  (answers: Record<string, { status: number; after?: number }>) =>
  (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const { status, after } = answers[new URL(String(input)).origin]!;
      const timer =
        after === undefined
          ? undefined
          : setTimeout(() => resolve(new Response("{}", { status })), after);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal!.reason);
      });
    });

test.each([
  [binanceCom, { [vision]: 40, [binanceCom]: 0 }],
  [vision, { [vision]: 0, [binanceCom]: 40 }],
])(
  "the probe picks the host that answers its ping first (%s)",
  async (fastest, delays) => {
    const fetch = pings({
      [vision]: { status: 200, after: delays[vision] },
      [binanceCom]: { status: 200, after: delays[binanceCom] },
    });
    const host = await Effect.runPromise(pickHost({ fetch }));
    expect(host.restUrl).toBe(fastest);
  },
);

test.each([451, 403])(
  "the probe skips a host that answers %i, even first",
  async (status) => {
    const fetch = pings({
      [vision]: { status: 200, after: 40 },
      [binanceCom]: { status, after: 0 },
    });
    const host = await Effect.runPromise(pickHost({ fetch }));
    expect(host.restUrl).toBe(vision);
  },
);

test.each([451, 500])(
  "the probe waits for a working host when the default answers %i first",
  async (status) => {
    const fetch = pings({
      [vision]: { status, after: 0 },
      [binanceCom]: { status: 200, after: 40 },
    });
    const host = await Effect.runPromise(pickHost({ fetch }));
    expect(host.restUrl).toBe(binanceCom);
  },
);

test("the probe keeps the default when every host refuses or fails", async () => {
  const fetch = pings({
    [vision]: { status: 500, after: 0 },
    [binanceCom]: { status: 451, after: 0 },
  });
  const host = await Effect.runPromise(pickHost({ fetch }));
  expect(host.restUrl).toBe(vision);
});

test("the probe gives up after 2 seconds and cancels unanswered pings", async () => {
  const requested: string[] = [];
  const aborted: string[] = [];
  const silent = pings({
    [vision]: { status: 200 },
    [binanceCom]: { status: 200 },
  });
  const fetch: typeof globalThis.fetch = (input, init) => {
    const origin = new URL(String(input)).origin;
    requested.push(origin);
    init?.signal?.addEventListener("abort", () => aborted.push(origin));
    return silent(input, init);
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const probe = yield* Effect.forkChild(pickHost({ fetch }));
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(requested).toHaveLength(2)),
      );
      yield* TestClock.adjust("2 seconds");
      expect((yield* Fiber.join(probe)).restUrl).toBe(vision);
      // Cancelled pings release their connections and request permits.
      expect(aborted.sort()).toEqual([binanceCom, vision]);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

test("requests use the default host until the probe answers, and again after the pick refuses", async () => {
  const requested: string[] = [];
  let answer!: (response: Response) => void;
  let refuse = false;
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v3/ping")
      return url.origin === binanceCom
        ? new Promise((resolve) => (answer = resolve))
        : new Promise(() => {});
    requested.push(url.origin);
    return refuse && url.origin === binanceCom
      ? new Response(null, { status: 451 })
      : Response.json([]);
  };
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const withHost = yield* chooseHost({ fetch });
        const klines = withHost((options) =>
          request(options, "/api/v3/klines", {}),
        );
        const current = () =>
          Effect.runSync(
            withHost((options) => Effect.succeed(options.websocketUrl)),
          );
        yield* klines;
        expect(requested).toEqual([vision]);
        expect(current()).toBe("wss://data-stream.binance.vision:443");
        yield* Effect.promise(() =>
          vi.waitFor(() => expect(answer).toBeDefined()),
        );
        answer(Response.json({}));
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(current()).toBe("wss://stream.binance.com:443"),
          ),
        );
        yield* klines;
        expect(requested).toEqual([vision, binanceCom]);
        refuse = true;
        expect((yield* Effect.flip(klines)).reason._tag).toBe(
          "Dataset.AccessDenied",
        );
        yield* klines;
        expect(requested).toEqual([vision, binanceCom, binanceCom, vision]);
      }),
    ),
  );
});

test("a refused, unreachable or failing pick hands back to the default and probes again", async () => {
  // Each api.binance.com ping waits for release(); the default never answers.
  const waiting: (() => void)[] = [];
  const release = () => waiting.shift()!();
  const fetch: typeof globalThis.fetch = (input) =>
    new URL(String(input)).origin === binanceCom
      ? new Promise((resolve) => waiting.push(() => resolve(Response.json({}))))
      : new Promise(() => {});
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const withHost = yield* chooseHost({ fetch });
        const current = () =>
          Effect.runSync(
            withHost((options) => Effect.succeed(options.restUrl)),
          );
        const failWith = (reason: DatasetReason) =>
          Effect.flip(withHost(() => Effect.fail(new DatasetFailure(reason))));
        const picked = Effect.promise(async () => {
          await vi.waitFor(() => expect(waiting).toHaveLength(1));
          release();
          await vi.waitFor(() => expect(current()).toBe(binanceCom));
        });
        yield* picked;
        // Request errors and rate limits are not the host's fault.
        for (const reason of [
          new DatasetReasons.InvalidQuery({ detail: "bad symbol" }),
          new DatasetReasons.RateLimited(),
        ]) {
          yield* failWith(reason);
          expect(current()).toBe(binanceCom);
          expect(waiting).toHaveLength(0);
        }
        for (const reason of [
          new DatasetReasons.AccessDenied(),
          new DatasetReasons.Unavailable(),
        ]) {
          yield* failWith(reason);
          expect(current()).toBe(vision);
          // The new probe finds the pick working again and restores it.
          yield* picked;
        }
      }),
    ),
  );
});

test.each([
  { restUrl: "https://example.test" },
  { websocketUrl: "ws://example.test" },
])("pinned endpoints skip the probe (%j)", async (pinned) => {
  const requested: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    requested.push(new URL(String(input)).href);
    return Response.json([]);
  };
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const withHost = yield* chooseHost({ ...pinned, fetch });
        yield* withHost((options) => request(options, "/api/v3/klines", {}));
        // Give a forked probe time to start; none may exist.
        yield* Effect.promise(
          () => new Promise((resolve) => setTimeout(resolve, 20)),
        );
      }),
    ),
  );
  expect(requested).toEqual([`${pinned.restUrl ?? vision}/api/v3/klines`]);
});
