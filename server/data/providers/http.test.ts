// Purpose: Verify provider-independent retry execution, concurrency and cancellation.
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { expect, test, vi } from "vitest";
import { fetchResponse, makeHttpFetch } from "./http";

const client = (raw: typeof fetch, statuses: readonly number[] = [429]) =>
  makeHttpFetch((input, init) => fetchResponse(raw, input, init), statuses);

test("only the caller's selected response statuses trigger retries", async () => {
  const raw = vi.fn(
    async () =>
      new Response(null, { status: 503, headers: { "retry-after": "0" } }),
  );
  const retry = await Effect.runPromise(client(raw, [503]));
  expect((await retry("https://example.test/data")).status).toBe(503);
  expect(raw).toHaveBeenCalledTimes(4);
  raw.mockClear();
  const noRetry = await Effect.runPromise(client(raw, [429]));
  expect((await noRetry("https://example.test/data")).status).toBe(503);
  expect(raw).toHaveBeenCalledTimes(1);
});

test("only four requests run concurrently and cancellation releases their permits", async () => {
  const signals: AbortSignal[] = [];
  const raw = vi.fn(
    (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signals.push(signal);
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  );
  const fetch = await Effect.runPromise(client(raw));
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const pending = controllers.map((controller) =>
    fetch("https://example.test/data", { signal: controller.signal }),
  );
  const settled = Promise.allSettled(pending);
  try {
    await vi.waitFor(() => expect(raw).toHaveBeenCalledTimes(4));
    controllers[0]!.abort();
    await vi.waitFor(() => expect(raw).toHaveBeenCalledTimes(5));
    expect(signals[0]!.aborted).toBe(true);
  } finally {
    controllers.forEach((controller) => controller.abort());
    expect(
      (await settled).every((result) => result.status === "rejected"),
    ).toBe(true);
  }
});

test.each(["2", "Thu, 01 Jan 1970 00:00:02 GMT"])(
  "Retry-After %s delays retries and later requests",
  async (retryAfter) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const raw = vi.fn(async () =>
          raw.mock.calls.length === 1
            ? new Response(null, {
                status: 429,
                headers: { "retry-after": retryAfter },
              })
            : Response.json([]),
        );
        const fetch = yield* client(raw);
        const controller = new AbortController();
        const requests: Promise<Response>[] = [];
        try {
          requests.push(
            fetch("https://example.test/a", { signal: controller.signal }),
          );
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(raw).toHaveBeenCalledTimes(1)),
          );
          requests.push(
            fetch("https://example.test/b", { signal: controller.signal }),
          );
          yield* TestClock.adjust("1 second");
          expect(raw).toHaveBeenCalledTimes(1);
          yield* TestClock.adjust("1 second");
          const responses = yield* Effect.promise(() => Promise.all(requests));
          expect(responses.every((response) => response.ok)).toBe(true);
          expect(raw).toHaveBeenCalledTimes(3);
        } finally {
          controller.abort();
          yield* Effect.promise(() => Promise.allSettled(requests));
        }
      }).pipe(Effect.provide(TestClock.layer())),
    );
  },
);
