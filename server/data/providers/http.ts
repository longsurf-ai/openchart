// Purpose: Share cancellable HTTP concurrency and cooldown without source-specific policy.
import { Clock, Effect, Semaphore } from "effect";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";

/** One source-owned HTTP attempt, including quota admission and response accounting.
 * After waiting for admission, await waitForCooldown before reserving quota/sending:
 * another request may have extended the shared cooldown in the meantime.
 */
export type HttpRequest<E> = (
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  waitForCooldown: Effect.Effect<void>,
) => Effect.Effect<Response, E>;

/** Execute native fetch with Effect cancellation and the common transport error.
 * @example yield* fetchResponse(fetcher, url, init);
 */
export const fetchResponse = Effect.fn("Http.fetchResponse")(function* (
  fetcher: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) {
  return yield* Effect.tryPromise({
    try: (signal) => fetcher(input, { ...init, signal }),
    catch: (cause) =>
      new DatasetFailure(new DatasetReasons.Unavailable(), { cause }),
  });
});

/** Build a fetch-compatible wrapper once per client; no source names or quota rules.
 * Runs at most four requests concurrently and four attempts for selected statuses.
 * Retry-After (seconds or HTTP date) sets a shared cooldown; absent values use backoff.
 * Caller cancellation interrupts waiting and I/O. Other responses/errors pass through.
 * @example const fetch = yield* makeHttpFetch(request, [429]);
 */
export const makeHttpFetch = Effect.fn("Http.makeHttpFetch")(function* <E>(
  request: HttpRequest<E>,
  retryStatuses: readonly number[],
): Effect.fn.Return<typeof fetch> {
  const permits = yield* Semaphore.make(4);
  const clock = yield* Clock.Clock;
  let cooldownUntil = 0;
  const waitForCooldown = Effect.gen(function* () {
    // Recheck after sleep: a concurrent response may extend the cooldown.
    for (;;) {
      const delay = cooldownUntil - (yield* Clock.currentTimeMillis);
      if (delay <= 0) return;
      yield* Effect.sleep(delay);
    }
  });
  return (input, init) =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (let attempt = 0; attempt < 4; attempt++) {
          yield* waitForCooldown;
          const response = yield* request(input, init, waitForCooldown);
          if (!retryStatuses.includes(response.status)) return response;
          const receivedAt = yield* Clock.currentTimeMillis;
          const retry = response.headers.get("retry-after");
          const seconds = retry === null ? NaN : Number(retry);
          const date = retry === null ? NaN : Date.parse(retry);
          const delay = Number.isFinite(seconds)
            ? Math.max(0, seconds * 1000)
            : Number.isFinite(date)
              ? Math.max(0, date - receivedAt)
              : 1000 * 2 ** attempt;
          cooldownUntil = Math.max(cooldownUntil, receivedAt + delay);
          if (attempt === 3) return response;
          yield* Effect.promise(
            () => response.body?.cancel() ?? Promise.resolve(),
          );
        }
        return yield* Effect.die(
          "HTTP retry loop exhausted without a response",
        );
      }).pipe(
        permits.withPermits(1),
        Effect.provideService(Clock.Clock, clock),
      ),
      {
        signal:
          init?.signal ?? (input instanceof Request ? input.signal : undefined),
      },
    );
});
