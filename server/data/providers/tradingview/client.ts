// Purpose: Own TradingView search, websocket history paging and live bar sessions.

import {
  Cache,
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Queue,
  Schema,
  Stream,
  type Scope,
} from "effect";
import WebSocket from "ws";
import {
  parseSymbolQuery,
  resolutionMs,
  type Adjustment,
  type Resolution,
} from "@openchart/feed";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import type { ProviderAccess } from "@openchart/server/data/provider";
import {
  fetchResponse,
  makeHttpFetch,
} from "@openchart/server/data/providers/http";
import {
  anonymousMaxBars,
  fetchProfile,
  userAgent,
  type Profile,
  type Session,
} from "./credential";
import {
  frameFailure,
  invalidResult,
  statusFailure,
  tradingviewError,
} from "./errors";
import {
  decodeFrame,
  encodeFrame,
  frameCandles,
  heartbeatFrame,
  parseFrames,
  streamStatus,
  tvAdjustments,
  tvResolutions,
  type Candle,
  type ServerFrame,
  type StreamStatus,
} from "./protocol";

/** One native search hit; TradingView identities stay in their own vocabulary. */
export interface SearchRow {
  readonly symbol: string;
  /** TradingView exchange prefix, such as `NASDAQ` or `BINANCE`. */
  readonly exchange: string;
  readonly name: string;
  readonly type: string;
  /** Empty when TradingView does not report a quote currency (for example yields). */
  readonly currency: string;
  readonly primary?: boolean;
  readonly typespecs?: readonly string[];
}

/** One native bar with a millisecond open time. */
export type Bar = Candle;

/**
 * Validated activity for one live series. Heartbeats renew liveness without
 * inventing candles; status preserves the source's exchange-data delay.
 * @example if (activity.type === "bars") consume(activity.bars);
 */
export type LiveActivity =
  | { readonly type: "heartbeat" }
  | { readonly type: "status"; readonly status: StreamStatus }
  | { readonly type: "bars"; readonly bars: readonly Bar[] };

/** Native series selection shared by history and live reads. */
export interface SeriesRequest {
  /** TradingView symbol in `EXCHANGE:SYMBOL` form. */
  readonly symbol: string;
  readonly resolution: Resolution;
  readonly adjustment: Adjustment;
}

/** A finite native history read; bounds are half-open milliseconds. */
export interface HistoryRequest extends SeriesRequest {
  readonly from?: number;
  readonly to?: number;
  readonly count?: number;
}

/** Injectable I/O, used by tests without contacting TradingView. */
export interface ClientOptions {
  /** Resolves one stored cookie session; undefined means anonymous use. */
  readonly credential?: () => Effect.Effect<
    Session | undefined,
    DatasetFailure
  >;
  readonly fetch?: typeof fetch;
  readonly websocket?: (url: string) => WebSocket;
}

/** TradingView's public transport; credentials stay inside this module. */
export interface Client {
  /**
   * Returns a native search page with contract families expanded. Callers own
   * final ranking and limits. Cancellation aborts HTTP; failures use Dataset
   * reasons and no socket is acquired.
   * @example const hits = yield* client.search("CME_MINI:NQ1!");
   */
  readonly search: (
    query: string,
  ) => Effect.Effect<readonly SearchRow[], DatasetFailure>;
  readonly history: (
    request: HistoryRequest,
  ) => Effect.Effect<readonly Bar[], DatasetFailure, Scope.Scope>;
  /**
   * Acquires and buffers one series in the caller's Scope. Activity includes
   * source-reported delay and heartbeats; only bar events contain prices.
   * Retirement closes the socket and drains accepted activity normally;
   * interruption, source failures and overflow close it without silent gaps.
   * @example const activity = yield* client.live(series, retired);
   */
  readonly live: (
    request: SeriesRequest,
    retired: Deferred.Deferred<void>,
  ) => Effect.Effect<
    Stream.Stream<LiveActivity, DatasetFailure>,
    DatasetFailure,
    Scope.Scope
  >;
  /** Anonymous access always succeeds; a stored session must also resolve. */
  readonly access: () => Effect.Effect<ProviderAccess, DatasetFailure>;
  /** Forget a resolved profile so the next read revalidates the session. */
  readonly reset: () => Effect.Effect<void>;
}

const homeUrl = "https://www.tradingview.com/";
const searchUrl = "https://symbol-search.tradingview.com";
const dataUrl =
  "wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart";
const proUrl =
  "wss://prodata.tradingview.com/socket.io/websocket?from=chart%2F&type=chart";
const responseTimeout = "30 seconds";
const stopped = () =>
  Effect.fail(
    new DatasetFailure(new DatasetReasons.Unavailable(), {
      cause: "TradingView stopped responding.",
    }),
  );
const historyClosed = () =>
  new DatasetFailure(new DatasetReasons.Unavailable(), {
    cause: "TradingView closed the history connection.",
  });

const SearchContract = Schema.Struct({
  symbol: Schema.String,
  description: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  exchange: Schema.optionalKey(Schema.String),
  source_id: Schema.optionalKey(Schema.String),
  prefix: Schema.optionalKey(Schema.String),
  currency_code: Schema.optionalKey(Schema.String),
  is_primary_listing: Schema.optionalKey(Schema.Boolean),
  typespecs: Schema.optionalKey(Schema.Array(Schema.String)),
});
const SearchSymbol = Schema.Struct({
  ...SearchContract.fields,
  contracts: Schema.optionalKey(Schema.Array(SearchContract)),
});
const SearchResponse = Schema.Struct({
  symbols: Schema.Array(SearchSymbol),
});

const decodeSearch = Schema.decodeUnknownOption(SearchResponse);

const entities: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};
const plain = (value: string) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity) => entities[entity] ?? entity)
    .trim();

/** TradingView's exchange code for a symbol search hit; display names never qualify. */
const exchangeOf = (row: typeof SearchSymbol.Type) => {
  const code = (
    row.prefix ??
    row.source_id ??
    row.exchange ??
    ""
  ).toUpperCase();
  return /^[A-Z0-9_.-]+$/.test(code) ? code : "";
};

const origin = (url: string) => {
  const parsed = new URL(url);
  const protocol =
    parsed.protocol === "wss:"
      ? "https:"
      : parsed.protocol === "ws:"
        ? "http:"
        : parsed.protocol;
  return `${protocol}//${parsed.host}`;
};

const sessionID = (prefix: string) =>
  `${prefix}${Array.from({ length: 12 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789".charAt(
      Math.floor(Math.random() * 36),
    ),
  ).join("")}`;

interface Connection {
  readonly queue: Queue.Queue<ServerFrame, DatasetFailure | Cause.Done>;
  send(method: string, parameters: readonly unknown[]): void;
  close(): void;
}

/** Build one client per Provider Layer, so HTTP quota and the profile cache
 * survive reactivation; `reset` forgets the profile.
 * @example const client = yield* makeClient({ credential: readSession });
 */
export const makeClient = Effect.fn("TradingView.makeClient")(function* (
  options: ClientOptions = {},
) {
  // Search and profile reads share one 429 cooldown and concurrency limit.
  const fetcher = yield* makeHttpFetch(
    (input, init) => fetchResponse(options.fetch ?? fetch, input, init),
    [429],
  );
  const websocket =
    options.websocket ??
    ((url: string) =>
      new WebSocket(url, {
        headers: {
          Origin: origin(url),
          "User-Agent": userAgent,
        },
      }));
  // Sessions compare structurally, so separately decoded copies share a
  // lookup; failures are never cached.
  const profiles = yield* Cache.makeWith(
    (session: Session) => fetchProfile(fetcher, homeUrl, session),
    {
      capacity: 1,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? "5 minutes" : 0),
    },
  );

  /** The stored session's validated profile; undefined means anonymous use. */
  const currentProfile = Effect.fn("TradingView.profile")(function* () {
    const stored =
      options.credential === undefined
        ? undefined
        : yield* options.credential();
    return stored === undefined
      ? undefined
      : yield* Cache.get(profiles, stored);
  });

  const connect = Effect.fn("TradingView.connect")(function* (
    profile: Profile | undefined,
    closeFailure: () => DatasetFailure,
  ) {
    const url = profile?.isPro === true ? proUrl : dataUrl;
    const queue = yield* Queue.make<ServerFrame, DatasetFailure | Cause.Done>({
      capacity: 512,
    });
    let closing = false;
    let failure: DatasetFailure | undefined;
    const socket = yield* Effect.acquireRelease(
      Effect.try({
        try: () => websocket(url),
        catch: tradingviewError,
      }),
      (socket) =>
        Effect.sync(() => {
          closing = true;
          socket.terminate();
        }),
    );
    const fail = (error: DatasetFailure) => {
      if (closing || failure) return;
      failure = error;
      Queue.failCauseUnsafe(queue, Cause.fail(error));
      socket.terminate();
    };
    const send = (method: string, parameters: readonly unknown[]) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(encodeFrame(method, parameters));
    };
    socket.on("message", (raw) => {
      if (closing) return;
      try {
        for (const payload of parseFrames(raw.toString())) {
          const frame = decodeFrame(payload);
          if (frame.kind === "heartbeat") {
            socket.send(heartbeatFrame(frame.payload));
          }
          if (!Queue.offerUnsafe(queue, frame))
            fail(
              new DatasetFailure(
                new DatasetReasons.StreamInterrupted({ kind: "overflow" }),
              ),
            );
        }
      } catch (cause) {
        fail(invalidResult(cause));
      }
    });
    socket.on("error", () => fail(closeFailure()));
    socket.on("close", () => {
      if (closing) Queue.endUnsafe(queue);
      else fail(closeFailure());
    });
    yield* Effect.callback<void, DatasetFailure>((resume) => {
      const open = () => resume(Effect.void);
      const refused = () => resume(Effect.fail(failure ?? closeFailure()));
      const closed = () => resume(Effect.fail(failure ?? closeFailure()));
      socket.once("open", open).once("error", refused).once("close", closed);
      if (failure) resume(Effect.fail(failure));
      else if (socket.readyState === WebSocket.OPEN) resume(Effect.void);
      return Effect.sync(() => {
        socket.off("open", open).off("error", refused).off("close", closed);
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () =>
          Effect.fail(
            new DatasetFailure(new DatasetReasons.Unavailable(), {
              cause: "TradingView socket did not open within 15 seconds.",
            }),
          ),
      }),
    );
    send("set_auth_token", [profile?.authToken ?? "unauthorized_user_token"]);
    send("set_locale", ["en", "US"]);
    return {
      queue,
      send,
      close: () => {
        closing = true;
        Queue.endUnsafe(queue);
        socket.terminate();
      },
    };
  });

  /** Any frame; heartbeats prove an established live series is still open. */
  const nextFrame = (connection: Connection) =>
    Queue.take(connection.queue).pipe(
      Effect.timeoutOrElse({ duration: responseTimeout, orElse: stopped }),
    );

  /** The next non-heartbeat frame: heartbeats keep a socket open but never
   * answer a pending request, so they cannot extend its timeout. */
  const nextResponse = (connection: Connection, onDone: () => DatasetFailure) =>
    Queue.take(connection.queue).pipe(
      Effect.repeat({ until: (frame) => frame.kind !== "heartbeat" }),
      Effect.timeoutOrElse({ duration: responseTimeout, orElse: stopped }),
      Effect.catchIf(Cause.isDone, () => Effect.fail(onDone())),
    );

  /** Starts the socket's one chart series and returns its chart session. */
  const openSeries = (
    connection: Connection,
    request: SeriesRequest,
    bars: number,
  ) => {
    const chartSession = sessionID("cs_");
    connection.send("chart_create_session", [chartSession, ""]);
    connection.send("resolve_symbol", [
      chartSession,
      "sds_sym_1",
      `=${JSON.stringify({
        adjustment: tvAdjustments[request.adjustment],
        backadjustment: "default",
        symbol: request.symbol,
      })}`,
    ]);
    connection.send("create_series", [
      chartSession,
      "sds_1",
      "s1",
      "sds_sym_1",
      tvResolutions[request.resolution],
      bars,
      "",
    ]);
    return chartSession;
  };

  const search = Effect.fn("TradingView.search")(function* (
    query: string,
  ): Effect.fn.Return<readonly SearchRow[], DatasetFailure> {
    // Only actual contracts returned by TradingView become listings.
    const parsed = parseSymbolQuery(query);
    const url = new URL("/symbol_search/v3/", searchUrl);
    url.search = new URLSearchParams({
      text: parsed.continuous ?? parsed.symbol,
      hl: "1",
      exchange: parsed.venue ?? "",
      lang: "en",
      search_type: "undefined",
      domain: "production",
      sort_by_country: "US",
    }).toString();
    const body = yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetcher(url, {
          signal,
          redirect: "error",
          headers: {
            accept: "application/json",
            origin: "https://www.tradingview.com",
            referer: "https://www.tradingview.com/",
            "user-agent": userAgent,
          },
        });
        if (!response.ok)
          throw statusFailure(response.status, "TradingView search");
        return response.json() as Promise<unknown>;
      },
      catch: (cause) =>
        cause instanceof SyntaxError
          ? invalidResult(cause)
          : tradingviewError(cause),
    }).pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () =>
          Effect.fail(
            new DatasetFailure(new DatasetReasons.Unavailable(), {
              cause: "TradingView search did not answer within 15 seconds.",
            }),
          ),
      }),
    );
    const decoded = decodeSearch(body);
    if (decoded._tag === "None")
      return yield* invalidResult("TradingView search response is malformed.");
    const rows: SearchRow[] = [];
    const seen = new Set<string>();
    const contracts = decoded.value.symbols.flatMap((family) =>
      family.contracts === undefined
        ? [family]
        : family.contracts.map((contract) => ({
            ...family,
            ...contract,
            description: contract.description
              ? [
                  family.description ?? family.symbol,
                  contract.description,
                ].join(" · ")
              : family.description,
          })),
    );
    for (const row of contracts) {
      const exchange = exchangeOf(row);
      const symbol = plain(row.symbol);
      const currency = row.currency_code?.trim() ?? "";
      if (!exchange || !symbol) continue;
      // Keep every native candidate until the merged Feed ranks and limits it.
      const key = `${exchange}:${symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        symbol,
        exchange,
        name: plain(row.description ?? symbol),
        type: row.type ?? "other",
        currency,
        ...(row.is_primary_listing === true ? { primary: true } : {}),
        ...(row.typespecs === undefined ? {} : { typespecs: row.typespecs }),
      });
    }
    return rows;
  });

  const initialBars = (
    request: HistoryRequest,
    from: number,
    to: number,
    maxBars: number,
  ) => {
    const step = resolutionMs[request.resolution];
    const window = Math.ceil(((to - from) / step) * 1.5);
    return Math.min(maxBars, Math.max(2, window + (request.count ?? 0)));
  };

  const estimatedSpan = (request: HistoryRequest) => {
    const count = request.count ?? 500;
    const factor = {
      "1s": 2,
      "1m": 6,
      "5m": 4,
      "15m": 4,
      "30m": 4,
      "1h": 3,
      "4h": 3,
      "1d": 2,
      "1W": 1,
      "1M": 1,
    }[request.resolution];
    return Math.min(
      count * resolutionMs[request.resolution] * factor,
      50 * 365 * 86_400_000,
    );
  };

  /** Writes one chart session's messages and collects its bars. */
  const collect = Effect.fn("TradingView.collect")(function* (
    connection: Connection,
    request: HistoryRequest,
    from: number,
    to: number,
    maxBars: number,
    callerFrom: number | undefined,
  ): Effect.fn.Return<readonly Bar[], DatasetFailure> {
    const chartSession = openSeries(
      connection,
      request,
      initialBars(request, from, to, maxBars),
    );
    connection.send("modify_series", [
      chartSession,
      "sds_1",
      "s1",
      "sds_sym_1",
      tvResolutions[request.resolution],
      `r,${Math.floor(from / 1000)}:${Math.floor((to - 1) / 1000)}`,
    ]);
    const bars = new Map<number, Bar>();
    let completed = 0;
    let earliest = Infinity;
    let previousEarliest: number | undefined;
    // An estimated lower bound only shapes the request; it never removes the
    // latest bars when the source's clock lags behind ours.
    const inRange = () =>
      [...bars.values()]
        .filter(
          (bar) =>
            bar.time < to &&
            (callerFrom === undefined || bar.time >= callerFrom),
        )
        .sort((left, right) => left.time - right.time);
    for (;;) {
      const frame = yield* nextResponse(connection, historyClosed);
      const failure = frameFailure(frame, request.symbol);
      if (failure) return yield* Effect.fail(failure);
      for (const bar of frameCandles(frame)) {
        bars.set(bar.time, bar);
        earliest = Math.min(earliest, bar.time);
      }
      if (frame.kind === "message" && frame.method === "series_completed") {
        completed++;
        // create_series completes first, modify_series second.
        if (completed < 2) continue;
        const rows = inRange();
        const needs =
          callerFrom === undefined
            ? request.count !== undefined && rows.length < request.count
            : earliest > callerFrom;
        if (!needs || earliest === previousEarliest) break;
        previousEarliest = earliest;
        connection.send("request_more_data", [chartSession, "sds_1", maxBars]);
      }
    }
    const rows = inRange();
    return callerFrom === undefined && request.count !== undefined
      ? rows.slice(-request.count)
      : rows;
  });

  const history = Effect.fn("TradingView.history")(function* (
    request: HistoryRequest,
  ): Effect.fn.Return<readonly Bar[], DatasetFailure, Scope.Scope> {
    if (request.from === undefined && request.count === undefined)
      return yield* Effect.fail(
        new DatasetFailure(
          new DatasetReasons.InvalidQuery({
            detail: "TradingView bars require a start or count.",
          }),
        ),
      );
    const now = yield* Clock.currentTimeMillis;
    const to = Math.min(request.to ?? now, now);
    const from = Math.max(
      0,
      request.from ?? Math.max(0, to - estimatedSpan(request)),
    );
    if (from >= to) return [];
    const profile = yield* currentProfile();
    const connection = yield* connect(profile, historyClosed);
    return yield* collect(
      connection,
      request,
      from,
      to,
      profile?.maxBars ?? anonymousMaxBars,
      request.from,
    );
  });

  const live = Effect.fn("TradingView.live")(function* (
    request: SeriesRequest,
    retired: Deferred.Deferred<void>,
  ): Effect.fn.Return<
    Stream.Stream<LiveActivity, DatasetFailure>,
    DatasetFailure,
    Scope.Scope
  > {
    const profile = yield* currentProfile();
    const connection = yield* connect(
      profile,
      () =>
        new DatasetFailure(
          new DatasetReasons.StreamInterrupted({ kind: "disconnected" }),
          { cause: "TradingView closed the live connection." },
        ),
    );
    const queue = yield* Queue.make<LiveActivity, DatasetFailure | Cause.Done>({
      capacity: 256,
    });
    yield* Effect.addFinalizer(() => Queue.shutdown(queue));
    openSeries(connection, request, 2);
    for (;;) {
      const frame = yield* nextResponse(
        connection,
        () =>
          new DatasetFailure(
            new DatasetReasons.StreamInterrupted({ kind: "disconnected" }),
            { cause: "TradingView closed before subscribing." },
          ),
      );
      const failure = frameFailure(frame, request.symbol);
      if (failure) return yield* Effect.fail(failure);
      const status = streamStatus(frame);
      if (status !== undefined) {
        Queue.offerUnsafe(queue, { type: "status", status });
        break;
      }
    }
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        for (;;) {
          const frame = yield* nextFrame(connection).pipe(
            Effect.catchIf(Cause.isDone, () => Effect.succeed(undefined)),
          );
          if (frame === undefined) {
            Queue.endUnsafe(queue);
            return;
          }
          const failure = frameFailure(frame, request.symbol);
          if (failure) return yield* Effect.fail(failure);
          const candles = frameCandles(frame);
          const status = streamStatus(frame);
          const activity: LiveActivity | undefined =
            frame.kind === "heartbeat"
              ? { type: "heartbeat" }
              : status !== undefined
                ? { type: "status", status }
                : candles.length > 0
                  ? { type: "bars", bars: candles }
                  : undefined;
          if (activity === undefined) continue;
          if (!Queue.offerUnsafe(queue, activity))
            return yield* Effect.fail(
              new DatasetFailure(
                new DatasetReasons.StreamInterrupted({ kind: "overflow" }),
              ),
            );
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            Queue.failCauseUnsafe(queue, Cause.fail(error));
            connection.close();
          }),
        ),
      ),
    );
    yield* Deferred.await(retired).pipe(
      Effect.andThen(Effect.sync(() => connection.close())),
      Effect.forkScoped,
    );
    return Stream.fromQueue(queue);
  });

  const access = Effect.fn("TradingView.access")(function* (): Effect.fn.Return<
    ProviderAccess,
    DatasetFailure
  > {
    yield* currentProfile();
    return { status: "granted" };
  });

  return {
    search,
    history,
    live,
    access,
    reset: () => Cache.invalidateAll(profiles),
  } satisfies Client;
});
