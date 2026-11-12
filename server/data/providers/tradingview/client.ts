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
  Semaphore,
  Stream,
  SynchronizedRef,
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

/** One native bar with a millisecond open time and client-local receipt order.
 * The sequence spans this client's sockets, before buffering. It orders local
 * observations, not upstream revisions, exchange timestamps or finality.
 * @example if (next.receivedSequence > previous.receivedSequence) consume(next);
 */
export type Bar = Candle & { readonly receivedSequence: number };

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
  /** Physical sockets shared by chart sessions; defaults to three. */
  readonly sockets?: number;
  /** Chart sessions one socket carries before another opens; defaults to eight. */
  readonly sessions?: number;
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
  /**
   * Reads one native history window and releases its chart session before
   * returning; the session shares a multiplexed socket with other reads.
   * Callers own paging and range filtering.
   * @example const bars = yield* client.history({symbol: "NASDAQ:AAPL", resolution: "1m", adjustment: "split", count: 500});
   */
  readonly history: (
    request: HistoryRequest,
  ) => Effect.Effect<readonly Bar[], DatasetFailure>;
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
  /** Forget the profile and close multiplexed sockets so the next read
   * revalidates the stored session and opens with its token. */
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

interface ReceivedFrame {
  readonly frame: ServerFrame;
  readonly receivedSequence: number;
}

/** Frames one chart session buffers before its consumer is considered stalled. */
const sessionFrames = 512;
/** Physical sockets shared by every chart session. TradingView refuses bursts
 * of roughly six concurrent WebSocket upgrades with HTTP 429, so a dashboard's
 * series are multiplexed instead of opening one socket per read. */
const defaultSocketLimit = 3;
/** Chart sessions one socket carries before another socket is opened. */
const defaultSessionsPerSocket = 8;
/** How long a refused upgrade keeps new connections from reaching TradingView. */
const admissionCooldown = 1_000;

/** One chart series on a shared socket; frames are routed by chart session id. */
interface Channel {
  readonly chartSession: string;
  readonly queue: Queue.Queue<ReceivedFrame, DatasetFailure | Cause.Done>;
  send(method: string, parameters: readonly unknown[]): void;
  end(): void;
  ended: boolean;
  deleted: boolean;
}

/** One physical socket multiplexing chart sessions. */
interface Socket {
  readonly socket: WebSocket;
  readonly channels: Map<string, Channel>;
  closing: boolean;
  failure: DatasetFailure | undefined;
}

/** Build one client per Provider Layer, so HTTP quota, the profile cache and
 * multiplexed sockets survive reactivation; `reset` forgets the profile and
 * closes the sockets.
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
  // Shared by every session; stamp before a channel queue can delay
  // consumption. A dequeue counter would make an old buffered frame look new.
  let receivedSequence = 0;
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

  // Physical sockets opened for this client; a socket lives while any session
  // uses it and closes with its last session. `admissions` serializes socket
  // creation so a dashboard load can never exceed TradingView's upgrade burst.
  const sockets = yield* SynchronizedRef.make<readonly Socket[]>([]);
  const admissions = yield* Semaphore.make(1);
  const socketLimit = Math.max(1, options.sockets ?? defaultSocketLimit);
  const sessionsPerSocket = Math.max(
    1,
    options.sessions ?? defaultSessionsPerSocket,
  );
  let refusedUntil = 0;
  // Bumped by `reset`; a read that resolved its profile before a reset must not
  // register a socket for the superseded credential.
  let credentialGeneration = 0;
  // Readers between admission and registration. A socket with sessions but no
  // pending acquire is idle and closes; a pending read may still reuse it.
  let pending = 0;

  const disconnected = () =>
    new DatasetFailure(
      new DatasetReasons.StreamInterrupted({ kind: "disconnected" }),
      {
        cause: "TradingView closed the connection.",
      },
    );

  const endChannel = (channel: Channel) => {
    if (channel.ended) return;
    channel.ended = true;
    Queue.endUnsafe(channel.queue);
  };

  /** Ends the upstream chart session while the socket still serves others. */
  const deleteUpstream = (socket: Socket, channel: Channel) => {
    if (channel.deleted) return;
    channel.deleted = true;
    if (!socket.closing && socket.socket.readyState === WebSocket.OPEN)
      socket.socket.send(
        encodeFrame("chart_delete_session", [channel.chartSession]),
      );
  };

  const failChannel = (
    socket: Socket,
    channel: Channel,
    failure: DatasetFailure,
  ) => {
    if (channel.ended) return;
    channel.ended = true;
    deleteUpstream(socket, channel);
    socket.channels.delete(channel.chartSession);
    Queue.failCauseUnsafe(channel.queue, Cause.fail(failure));
  };

  const endSocket = (socket: Socket) => {
    if (socket.closing) return;
    socket.closing = true;
    for (const channel of [...socket.channels.values()]) endChannel(channel);
    socket.socket.terminate();
  };

  const failSocket = (socket: Socket, failure: DatasetFailure) => {
    if (socket.closing) return;
    socket.closing = true;
    socket.failure = failure;
    for (const channel of [...socket.channels.values()])
      failChannel(socket, channel, failure);
    socket.socket.terminate();
  };

  /** Opens one physical socket and shares it with every chart session. */
  const openSocket = Effect.fn("TradingView.openSocket")(function* (
    profile: Profile | undefined,
  ) {
    const url = profile?.isPro === true ? proUrl : dataUrl;
    const raw = yield* Effect.try({
      try: () => websocket(url),
      catch: tradingviewError,
    });
    const socket: Socket = {
      socket: raw,
      channels: new Map(),
      closing: false,
      failure: undefined,
    };
    raw.on("message", (data) => {
      if (socket.closing) return;
      try {
        for (const payload of parseFrames(data.toString())) {
          const frame = decodeFrame(payload);
          if (frame.kind === "heartbeat") {
            if (raw.readyState === WebSocket.OPEN)
              raw.send(heartbeatFrame(frame.payload));
            // Liveness belongs to each established series, not only the socket.
            for (const channel of socket.channels.values()) {
              if (channel.ended) continue;
              if (
                !Queue.offerUnsafe(channel.queue, {
                  frame,
                  receivedSequence: ++receivedSequence,
                })
              ) {
                failChannel(
                  socket,
                  channel,
                  new DatasetFailure(
                    new DatasetReasons.StreamInterrupted({ kind: "overflow" }),
                    {
                      cause: "TradingView session buffer overflowed.",
                    },
                  ),
                );
              }
            }
            continue;
          }
          if (frame.kind === "hello") continue;
          // A protocol failure can corrupt every series on this socket; a
          // critical error that names a session fails only that series.
          if (
            frame.method === "critical_error" ||
            frame.method === "protocol_error"
          ) {
            const id = frame.parameters[0];
            const channel =
              frame.method === "critical_error" && typeof id === "string"
                ? socket.channels.get(id)
                : undefined;
            const failure = new DatasetFailure(
              new DatasetReasons.Unavailable(),
              { cause: frame },
            );
            if (channel === undefined) {
              failSocket(socket, failure);
              return;
            }
            failChannel(socket, channel, failure);
            if (socket.channels.size === 0) endSocket(socket);
            continue;
          }
          const id = frame.parameters[0];
          const channel =
            typeof id === "string" ? socket.channels.get(id) : undefined;
          if (channel === undefined || channel.ended) continue;
          if (
            !Queue.offerUnsafe(channel.queue, {
              frame,
              receivedSequence: ++receivedSequence,
            })
          ) {
            // Only the stalled session fails; other charts keep their socket.
            failChannel(
              socket,
              channel,
              new DatasetFailure(
                new DatasetReasons.StreamInterrupted({ kind: "overflow" }),
                {
                  cause: "TradingView session buffer overflowed.",
                },
              ),
            );
            if (socket.channels.size === 0) endSocket(socket);
          }
        }
      } catch (cause) {
        failSocket(socket, invalidResult(cause));
      }
    });
    raw.on("unexpected-response", (_request, response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      if (status === 429) refusedUntil = Date.now() + admissionCooldown;
      failSocket(
        socket,
        statusFailure(status, "TradingView refused the WebSocket upgrade."),
      );
    });
    raw.on("error", () => failSocket(socket, disconnected()));
    raw.on("close", () => {
      if (!socket.closing) failSocket(socket, disconnected());
    });
    yield* Effect.callback<void, DatasetFailure>((resume) => {
      const open = () => resume(Effect.void);
      const refused = () =>
        resume(Effect.fail(socket.failure ?? disconnected()));
      const closed = () =>
        resume(Effect.fail(socket.failure ?? disconnected()));
      raw.once("open", open).once("error", refused).once("close", closed);
      if (socket.failure) resume(Effect.fail(socket.failure));
      else if (raw.readyState === WebSocket.OPEN) resume(Effect.void);
      return Effect.sync(() => {
        raw.off("open", open).off("error", refused).off("close", closed);
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
      Effect.onError(() =>
        Effect.sync(() => failSocket(socket, disconnected())),
      ),
      Effect.onInterrupt(() =>
        Effect.sync(() => failSocket(socket, disconnected())),
      ),
    );
    if (raw.readyState === WebSocket.OPEN) {
      raw.send(
        encodeFrame("set_auth_token", [
          profile?.authToken ?? "unauthorized_user_token",
        ]),
      );
      raw.send(encodeFrame("set_locale", ["en", "US"]));
    }
    yield* SynchronizedRef.update(sockets, (list) => [...list, socket]);
    return socket;
  });

  const credentialsChanged = () =>
    new DatasetFailure(
      new DatasetReasons.StreamInterrupted({ kind: "disconnected" }),
      { cause: "TradingView credentials changed." },
    );

  /** Registers one chart session on the least loaded socket, opening another
   * only when every live socket carries its share. The session ends with the
   * caller's Scope; the last session closes its socket. */
  const acquireChannel = Effect.fn("TradingView.channel")(function* (
    profile: Profile | undefined,
    generation: number,
  ) {
    pending++;
    return yield* Effect.gen(function* () {
      const socket = yield* admissions.withPermit(
        Effect.gen(function* () {
          if (generation !== credentialGeneration)
            return yield* Effect.fail(credentialsChanged());
          const current = yield* SynchronizedRef.get(sockets);
          const live = current.filter(
            (entry) => !entry.closing && entry.failure === undefined,
          );
          yield* SynchronizedRef.set(sockets, live);
          const room = live.find(
            (entry) => entry.channels.size < sessionsPerSocket,
          );
          if (room !== undefined) return room;
          if (live.length >= socketLimit) return live[0]!;
          // Only a new upgrade is subject to the refusal cooldown; healthy
          // sockets above already had their chance to serve this session.
          if (Date.now() < refusedUntil)
            return yield* Effect.fail(
              new DatasetFailure(new DatasetReasons.RateLimited(), {
                cause:
                  "TradingView is refusing new connections; retrying shortly.",
              }),
            );
          return yield* openSocket(profile);
        }),
      );
      const chartSession = sessionID("cs_");
      const queue = yield* Queue.make<
        ReceivedFrame,
        DatasetFailure | Cause.Done
      >({ capacity: sessionFrames });
      const channel: Channel = {
        chartSession,
        queue,
        ended: false,
        deleted: false,
        send: (method, parameters) => {
          if (!channel.ended && socket.socket.readyState === WebSocket.OPEN)
            socket.socket.send(encodeFrame(method, parameters));
        },
        end: () => endChannel(channel),
      };
      return yield* Effect.acquireRelease(
        Effect.suspend(() => {
          if (socket.closing)
            return Effect.fail(socket.failure ?? disconnected());
          socket.channels.set(chartSession, channel);
          return Effect.succeed(channel);
        }),
        (channel) =>
          Effect.sync(() => {
            deleteUpstream(socket, channel);
            socket.channels.delete(chartSession);
            endChannel(channel);
            if (socket.channels.size === 0 && pending === 0) endSocket(socket);
          }),
      );
    }).pipe(
      // Hold the reservation through registration so a finishing session
      // cannot close the socket this read is about to join.
      Effect.ensuring(
        Effect.sync(() => {
          pending--;
        }),
      ),
    );
  });

  /** Any frame; heartbeats prove an established live series is still open. */
  const nextFrame = (channel: Channel) =>
    Queue.take(channel.queue).pipe(
      Effect.timeoutOrElse({ duration: responseTimeout, orElse: stopped }),
    );

  /** The next non-heartbeat frame: heartbeats keep a socket open but never
   * answer a pending request, so they cannot extend its timeout. */
  const nextResponse = (channel: Channel, onDone: () => DatasetFailure) =>
    Queue.take(channel.queue).pipe(
      Effect.repeat({ until: ({ frame }) => frame.kind !== "heartbeat" }),
      Effect.timeoutOrElse({ duration: responseTimeout, orElse: stopped }),
      Effect.catchIf(Cause.isDone, () => Effect.fail(onDone())),
    );

  /** Starts one chart series on its session. */
  const openSeries = (
    channel: Channel,
    request: SeriesRequest,
    bars: number,
  ) => {
    const chartSession = channel.chartSession;
    channel.send("chart_create_session", [chartSession, ""]);
    channel.send("resolve_symbol", [
      chartSession,
      "sds_sym_1",
      `=${JSON.stringify({
        adjustment: tvAdjustments[request.adjustment],
        backadjustment: "default",
        symbol: request.symbol,
      })}`,
    ]);
    channel.send("create_series", [
      chartSession,
      "sds_1",
      "s1",
      "sds_sym_1",
      tvResolutions[request.resolution],
      bars,
      "",
    ]);
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
    channel: Channel,
    request: HistoryRequest,
    from: number,
    to: number,
    maxBars: number,
    callerFrom: number | undefined,
  ): Effect.fn.Return<readonly Bar[], DatasetFailure> {
    openSeries(channel, request, initialBars(request, from, to, maxBars));
    const chartSession = channel.chartSession;
    channel.send("modify_series", [
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
      const { frame, receivedSequence } = yield* nextResponse(
        channel,
        historyClosed,
      );
      const failure = frameFailure(frame, request.symbol);
      if (failure) return yield* Effect.fail(failure);
      for (const bar of frameCandles(frame)) {
        bars.set(bar.time, { ...bar, receivedSequence });
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
        channel.send("request_more_data", [chartSession, "sds_1", maxBars]);
      }
    }
    const rows = inRange();
    return callerFrom === undefined && request.count !== undefined
      ? rows.slice(-request.count)
      : rows;
  });

  const history = Effect.fn("TradingView.history")(function* (
    request: HistoryRequest,
  ): Effect.fn.Return<readonly Bar[], DatasetFailure> {
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
    // Captured before the profile so a reset during resolution stops this read
    // from opening a socket for the superseded credential.
    const generation = credentialGeneration;
    const profile = yield* currentProfile();
    // A finite read owns its session and releases it, closing the socket when
    // no other chart still uses it.
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const channel = yield* acquireChannel(profile, generation);
        return yield* collect(
          channel,
          request,
          from,
          to,
          profile?.maxBars ?? anonymousMaxBars,
          request.from,
        );
      }),
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
    const generation = credentialGeneration;
    const profile = yield* currentProfile();
    const channel = yield* acquireChannel(profile, generation);
    const queue = yield* Queue.make<LiveActivity, DatasetFailure | Cause.Done>({
      capacity: 256,
    });
    yield* Effect.addFinalizer(() => Queue.shutdown(queue));
    const offer = (activity: LiveActivity) =>
      Queue.offerUnsafe(queue, activity)
        ? Effect.void
        : Effect.fail(
            new DatasetFailure(
              new DatasetReasons.StreamInterrupted({ kind: "overflow" }),
              {
                cause: "TradingView live session buffer overflowed.",
              },
            ),
          );
    openSeries(channel, request, 2);
    // Candles can precede the subscription acknowledgement; keep them in order
    // because the caller's history snapshot may already have ended.
    for (;;) {
      const { frame, receivedSequence } = yield* nextResponse(
        channel,
        () =>
          new DatasetFailure(
            new DatasetReasons.StreamInterrupted({ kind: "disconnected" }),
            {
              cause: "TradingView closed before subscribing.",
            },
          ),
      );
      const failure = frameFailure(frame, request.symbol);
      if (failure) return yield* Effect.fail(failure);
      const candles = frameCandles(frame).map((bar) => ({
        ...bar,
        receivedSequence,
      }));
      if (candles.length > 0) yield* offer({ type: "bars", bars: candles });
      const status = streamStatus(frame);
      if (status !== undefined) {
        yield* offer({ type: "status", status });
        break;
      }
    }
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        for (;;) {
          const received = yield* nextFrame(channel).pipe(
            Effect.catchIf(Cause.isDone, () => Effect.succeed(undefined)),
          );
          if (received === undefined) {
            Queue.endUnsafe(queue);
            return;
          }
          const { frame, receivedSequence } = received;
          const failure = frameFailure(frame, request.symbol);
          if (failure) return yield* Effect.fail(failure);
          const candles = frameCandles(frame).map((bar) => ({
            ...bar,
            receivedSequence,
          }));
          const status = streamStatus(frame);
          const activity: LiveActivity | undefined =
            frame.kind === "heartbeat"
              ? { type: "heartbeat" }
              : status !== undefined
                ? { type: "status", status }
                : candles.length > 0
                  ? { type: "bars", bars: candles }
                  : undefined;
          if (activity !== undefined) yield* offer(activity);
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            Queue.failCauseUnsafe(queue, Cause.fail(error));
            channel.end();
          }),
        ),
      ),
    );
    yield* Deferred.await(retired).pipe(
      Effect.andThen(Effect.sync(() => channel.end())),
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
    reset: () =>
      // Serialize with admissions so an upgrade cannot register after the
      // drain with the superseded credential.
      admissions.withPermit(
        Effect.gen(function* () {
          credentialGeneration++;
          yield* Cache.invalidateAll(profiles);
          // A stored session changes the socket's auth token, so no socket may
          // survive it. Existing readers fail retryably and reopen with the new
          // credential.
          const current = yield* SynchronizedRef.modify(sockets, (list) => [
            list,
            [] as readonly Socket[],
          ]);
          for (const socket of current)
            failSocket(socket, credentialsChanged());
        }),
      ),
  } satisfies Client;
});
