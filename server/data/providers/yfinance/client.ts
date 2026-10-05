// Purpose: Own Yahoo's HTTP client and retry policy across Provider activations.
import { statusFailure, yfinanceError } from "./errors";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import { Effect } from "effect";
import {
  fetchResponse,
  makeHttpFetch,
} from "@openchart/server/data/providers/http";

/** Build once per Provider Layer; chart and search share concurrency and cooldown.
 * Preserve Yahoo's bounded 429/418 retries. Cancellation aborts waiting and I/O.
 * @example const client = yield* makeClient(options.fetch);
 */
export const makeClient = Effect.fn("YFinance.makeClient")(function* (
  fetcher: typeof fetch = fetch,
) {
  return {
    fetch: yield* makeHttpFetch(
      (input, init) => fetchResponse(fetcher, input, init),
      [429, 418],
    ),
  };
});

/** Injectable Yahoo transport; polling cadence is provider-owned delivery behavior. */
export interface YFinanceOptions {
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly pollIntervalMs?: number;
}

/** Fetch Yahoo JSON with Effect interruption propagated to native fetch.
 * A 400 keeps Yahoo's JSON body as cause; Yahoo bars read it for empty ranges.
 * @example const body = yield* request({}, '/v1/finance/search', {q: 'AAPL'});
 */
export const request = Effect.fn("YFinance.request")(function* (
  options: YFinanceOptions,
  path: string,
  parameters: Record<string, string>,
) {
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const url = new URL(
        path,
        options.baseUrl ?? "https://query1.finance.yahoo.com",
      );
      url.search = new URLSearchParams(parameters).toString();
      const response = await (options.fetch ?? fetch)(url, {
        signal,
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      });
      if (!response.ok) {
        throw statusFailure(
          response.status,
          response.status === 400
            ? await response.json().catch(() => undefined)
            : `Yahoo Finance request failed (${response.status}).`,
        );
      }
      return (await response.json()) as unknown;
    },
    catch: yfinanceError,
  }).pipe(
    // A hung request must fail so the consumer can report it and retry.
    Effect.timeoutOrElse({
      duration: "30 seconds",
      orElse: () =>
        Effect.fail(
          new DatasetFailure(new DatasetReasons.Unavailable(), {
            cause: "Yahoo Finance did not respond within 30 seconds.",
          }),
        ),
    }),
  );
});
