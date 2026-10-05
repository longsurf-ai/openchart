// Purpose: Own Binance hosts, HTTP quotas, source metadata and throttling policy.
import { binanceError, httpReason } from "./errors";
import type WebSocket from "ws";
import { Clock, Duration, Effect, Schema } from "effect";
import {
  DatasetFailure,
  DatasetReasons,
  type DatasetReason,
} from "@openchart/server/data/dataset";
import {
  fetchResponse,
  makeHttpFetch,
  type HttpRequest,
} from "@openchart/server/data/providers/http";

const Limits = Schema.Struct({
  rateLimits: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        rateLimitType: Schema.String,
        interval: Schema.String,
        intervalNum: Schema.Int.check(Schema.isGreaterThan(0)),
        limit: Schema.Int.check(Schema.isGreaterThan(0)),
      }),
    ),
  ),
});
const intervals: Record<string, number> = {
  SECOND: 1000,
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
};
type Budget = { kind: string; window: number; limit: number; header: string };

/** Build once per Provider Layer so quotas and cooldown survive activation changes.
 * The returned fetch aborts quota waits and HTTP when its caller cancels.
 * @example const client = yield* makeClient(options.fetch);
 */
export const makeClient = Effect.fn("Binance.makeClient")(function* (
  fetcher: typeof fetch | undefined,
) {
  // Use Binance Spot's public IP budget until exchangeInfo advertises limits.
  let budgets: Budget[] = [
    {
      kind: "REQUEST_WEIGHT",
      window: 60_000,
      limit: 6000,
      header: "x-mbx-used-weight-1m",
    },
  ];
  const accounted = new Map<string, { windowId: number; tokens: number }>();
  const invalidLimits = (cause: unknown) =>
    new DatasetFailure(new DatasetReasons.InvalidResult(), { cause });
  const request: HttpRequest<DatasetFailure> = Effect.fn("Binance.request")(
    function* (input, init, waitForCooldown) {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      const weight = url.pathname === "/api/v3/exchangeInfo" ? 20 : 2;
      // Reserve every advertised fixed-window budget together. Headers account
      // for other applications sharing this IP.
      for (;;) {
        yield* waitForCooldown;
        const now = yield* Clock.currentTimeMillis;
        let delay = 0;
        for (const budget of budgets) {
          const key = `${url.origin}:${budget.kind}:${budget.window}`;
          const windowId = Math.floor(now / budget.window);
          const previous = accounted.get(key);
          const used = previous?.windowId === windowId ? previous.tokens : 0;
          const tokens = budget.kind === "REQUEST_WEIGHT" ? weight : 1;
          if (tokens > budget.limit)
            return yield* Effect.fail(
              new DatasetFailure(new DatasetReasons.RateLimited(), {
                cause: "Provider quota cannot admit this request.",
              }),
            );
          if (used + tokens > budget.limit)
            delay = Math.max(delay, (windowId + 1) * budget.window - now);
        }
        if (delay > 0) {
          yield* Effect.sleep(delay);
          continue;
        }
        for (const budget of budgets) {
          const key = `${url.origin}:${budget.kind}:${budget.window}`;
          const windowId = Math.floor(now / budget.window);
          const previous = accounted.get(key);
          accounted.set(key, {
            windowId,
            tokens:
              (previous?.windowId === windowId ? previous.tokens : 0) +
              (budget.kind === "REQUEST_WEIGHT" ? weight : 1),
          });
        }
        break;
      }
      const response = yield* fetchResponse(fetcher ?? fetch, input, init);
      const receivedAt = yield* Clock.currentTimeMillis;
      if (response.ok && url.pathname === "/api/v3/exchangeInfo") {
        const metadata = yield* Effect.tryPromise({
          try: () => response.clone().json() as Promise<unknown>,
          catch: invalidLimits,
        });
        const parsed = yield* Schema.decodeUnknownEffect(Limits)(metadata).pipe(
          Effect.mapError(invalidLimits),
        );
        const advertised = (parsed.rateLimits ?? []).flatMap((limit) => {
          const unit = intervals[limit.interval];
          return unit &&
            ["REQUEST_WEIGHT", "RAW_REQUESTS"].includes(limit.rateLimitType)
            ? [
                {
                  kind: limit.rateLimitType,
                  window: unit * limit.intervalNum,
                  limit: limit.limit,
                  header: `x-mbx-used-weight-${limit.intervalNum}${limit.interval[0]!.toLowerCase()}`,
                },
              ]
            : [];
        });
        if (advertised.length) budgets = advertised;
      }
      for (const budget of budgets) {
        if (budget.kind !== "REQUEST_WEIGHT") continue;
        const raw = response.headers.get(budget.header);
        if (raw === null) continue;
        const used = Number(raw);
        if (!Number.isSafeInteger(used) || used < 0) continue;
        const windowId = Math.floor(receivedAt / budget.window);
        const key = `${url.origin}:${budget.kind}:${budget.window}`;
        const prior = accounted.get(key);
        const local = prior?.windowId === windowId ? prior.tokens : 0;
        if (used > local) accounted.set(key, { windowId, tokens: used });
      }
      return response;
    },
  );
  return { fetch: yield* makeHttpFetch(request, [429, 418]) };
});

/** Injectable I/O and public endpoint locations owned by this Provider.
 * Setting restUrl or websocketUrl pins the endpoints: {@link chooseHost} never probes.
 */
export interface BinanceOptions {
  readonly fetch?: typeof fetch;
  readonly restUrl?: string;
  readonly websocketUrl?: string;
  readonly websocket?: (url: string) => WebSocket;
  readonly bufferCapacity?: number;
}

// Each REST host with its stream host. api.binance.com sits behind CloudFront,
// so distant clients connect far faster; it refuses restricted locations (451).
const publicHosts = [
  {
    restUrl: "https://data-api.binance.vision",
    websocketUrl: "wss://data-stream.binance.vision:443",
  },
  {
    restUrl: "https://api.binance.com",
    websocketUrl: "wss://stream.binance.com:443",
  },
] as const;
type PublicHost = (typeof publicHosts)[number];

/** Endpoints used until a probe picks another host, and whenever none answers. */
export const defaultHost: PublicHost = publicHosts[0];

/** Race every public host's `/api/v3/ping` through options.fetch (the Provider's
 * quota and concurrency path); the first success is the fastest host. Hosts that
 * fail or deny access (403, or 451 for a restricted location) drop out; losers are
 * cancelled. Never fails: with no success within 2 seconds it returns
 * {@link defaultHost}. Logs the choice and why.
 * @example const host = yield* pickHost({ fetch: client.fetch });
 */
export const pickHost = Effect.fn("Binance.pickHost")(
  function* (options: BinanceOptions) {
    const [elapsed, host] = yield* Effect.raceAll(
      publicHosts.map((host) =>
        request({ ...options, ...host }, "/api/v3/ping", {}).pipe(
          Effect.as(host),
          Effect.timed,
        ),
      ),
    ).pipe(Effect.timeout("2 seconds"));
    yield* Effect.logInfo("Binance host chosen", {
      host: host.restUrl,
      reason: `fastest successful /api/v3/ping, ${Math.round(Duration.toMillis(elapsed))} ms`,
    });
    return host;
  },
  Effect.catchCause((cause) =>
    Effect.logWarning(
      "Binance host probe failed; keeping the default",
      { host: defaultHost.restUrl },
      cause,
    ).pipe(Effect.as(defaultHost)),
  ),
);

// Failures that say the host itself is unusable from here: refused (403/451),
// unreachable, or failing. Request errors and rate limits are not the host's.
const hostFailures: ReadonlySet<DatasetReason["_tag"]> = new Set([
  "Dataset.AccessDenied",
  "Dataset.Unavailable",
]);

/** Own one Provider activation's host. Requests start on {@link defaultHost} while
 * {@link pickHost} runs in the caller's Scope (closing it cancels the probe), then
 * use the pick until it is refused (403 or 451), unreachable or failing. That
 * restores the default for later requests and probes again, so a recovered pick
 * comes back; the failed request still fails. Request errors and rate limits keep
 * the pick. At most one probe runs at a time. Pinned options skip probing.
 * @example const withHost = yield* chooseHost(options);
 * const bars = yield* withHost((options) => selectBars(options, query));
 */
export const chooseHost = Effect.fn("Binance.chooseHost")(function* (
  options: BinanceOptions,
) {
  let host: PublicHost = defaultHost;
  let probing = false;
  const scope = yield* Effect.scope;
  const probe = Effect.suspend(() => {
    if (probing) return Effect.void;
    probing = true;
    return pickHost(options).pipe(
      Effect.map((picked) => {
        host = picked;
      }),
      Effect.ensuring(
        Effect.sync(() => {
          probing = false;
        }),
      ),
      Effect.forkIn(scope),
      Effect.asVoid,
    );
  });
  if (options.restUrl === undefined && options.websocketUrl === undefined)
    yield* probe;
  return Effect.fn("Binance.withHost")(function* <A, R>(
    run: (options: BinanceOptions) => Effect.Effect<A, DatasetFailure, R>,
  ) {
    const used = host;
    return yield* run({ ...used, ...options }).pipe(
      Effect.tapError((error) => {
        if (
          !hostFailures.has(error.reason._tag) ||
          used === defaultHost ||
          host !== used
        )
          return Effect.void;
        host = defaultHost;
        return Effect.logWarning(
          "Binance host failed; using the default and probing again",
          { host: used.restUrl, error },
        ).pipe(Effect.andThen(probe));
      }),
    );
  });
});

/** Fetch one Binance JSON response with cancellation; callers parse its schema.
 * @example const body = yield* request(options, '/api/v3/exchangeInfo', {});
 */
export const request = Effect.fn("Binance.request")(function* (
  options: BinanceOptions,
  path: string,
  parameters: Record<string, string>,
) {
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const url = new URL(path, options.restUrl ?? defaultHost.restUrl);
      url.search = new URLSearchParams(parameters).toString();
      const response = await (options.fetch ?? fetch)(url, { signal });
      if (!response.ok) {
        throw new DatasetFailure(httpReason(response.status), {
          cause: `Binance market data request failed (${response.status}).`,
        });
      }
      return (await response.json()) as unknown;
    },
    catch: binanceError,
  });
});
