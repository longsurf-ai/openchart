// Purpose: Stable tRPC/Hose access with request-owned cancellation and observable completion.
import {
  BarsCapabilities,
  BarsChannelRequest,
  BarsMessage,
  ClientFailure,
  ClientFailures,
  FeedVersion,
  FeedError,
  FeedReason,
  FeedReasons,
  SymbolSearchResult,
  SymbolIndexAccepted,
  SymbolIndexStatus,
  LogoResult,
  CalendarResult,
} from "@openchart/feed";
import { HoseError, type HoseErrorCode } from "@openchart/hose";
import { TRPCClientError } from "@trpc/client";
import { Result, Schema } from "effect";
import {
  EMPTY,
  catchError,
  defer,
  distinctUntilChanged,
  finalize,
  filter,
  from,
  map,
  switchMap,
  throwError,
  type Observable,
} from "rxjs";

import type { AppTransport } from "@openchart/app/lib/transport/transport";

import { observeBars, shareBarsViews } from "./bars";
import type { FeedClient, RequestOptions } from "./client";

const decodeVersion = Schema.decodeUnknownSync(FeedVersion);
const decodeCapabilities = Schema.decodeUnknownSync(BarsCapabilities);
const decodeMessage = Schema.decodeUnknownSync(BarsMessage);
const decodeSymbolSearchResult = Schema.decodeUnknownSync(SymbolSearchResult);
const decodeBarsChannelRequest = Schema.decodeUnknownResult(BarsChannelRequest);

const isClientFailure = Schema.is(ClientFailure);
const decodeFeedError = Schema.decodeUnknownResult(FeedError);
/** Hose codes for a socket that dropped or that the app disconnected. */
const connectionLost: ReadonlySet<HoseErrorCode> = new Set([
  "disconnected",
  "socket_failed",
  "socket_closed",
]);

/**
 * Classify any failure. A public error body (tRPC `data.error`, Hose error
 * `body`) decodes to FeedError; everything else becomes a ClientFailure, so
 * server and upstream text never reach the UI.
 * @example const failure = feedError(error); if (failure.isRetryable) offerRetry();
 */
export function feedError(error: unknown): FeedError | ClientFailure {
  if (error instanceof FeedError || isClientFailure(error)) return error;
  if (error instanceof Error && error.name === "AbortError")
    return new ClientFailures.Cancelled();
  const body: unknown =
    error instanceof HoseError
      ? error.body
      : error instanceof TRPCClientError
        ? error.data?.error
        : undefined;
  if (body !== undefined && body !== null) {
    const decoded = decodeFeedError(body);
    return Result.isSuccess(decoded)
      ? decoded.success
      : new ClientFailures.InvalidResponse();
  }
  if (
    (error instanceof HoseError && connectionLost.has(error.code)) ||
    // No tRPC error response arrived: the request never reached the server.
    (error instanceof TRPCClientError && error.data === undefined)
  )
    return new ClientFailures.Disconnected();
  if (
    Schema.isSchemaError(error) ||
    (error instanceof HoseError &&
      (error.code === "protocol_error" || error.code === "empty_response"))
  )
    return new ClientFailures.InvalidResponse();
  return new ClientFailures.Internal();
}

/**
 * Whether the UI offers Retry: only failures that may succeed on retry, except
 * rate limits, whose wording already says to wait.
 * @example retry: offersRetry(failure) ? bars.retry : undefined
 */
export function offersRetry(
  failure: FeedError | FeedReason | ClientFailure,
): boolean {
  const reason = failure._tag === "FeedError" ? failure.reason : failure;
  return reason.isRetryable && reason._tag !== "Feed.RateLimited";
}

/** Long-lived transports; version events never close data clients or their sessions. */
export class FeedTransport {
  private readonly rpc;
  /** Uses the application's shared RPC, SSE and Hose connections. @example const feed = new FeedTransport(transport); */
  constructor(private readonly transport: AppTransport) {
    this.rpc = transport.rpc;
  }
  /** Reads the version after shared SSE connects and after Feed invalidations; unsubscribe cancels both. @example transport.watchVersion().subscribe(console.log); */
  watchVersion(): Observable<FeedVersion> {
    return this.transport.events.pipe(
      map((frame) => {
        if (
          frame.kind === "ready" ||
          (frame.kind === "event" &&
            frame.event.type === "feed.version.changed")
        )
          return true;
        return frame.kind === "connecting" ? false : undefined;
      }),
      filter((refresh): refresh is boolean => refresh !== undefined),
      switchMap((refresh) =>
        refresh
          ? defer(() => {
              const controller = new AbortController();
              return from(
                this.rpc.feed.version.query(undefined, {
                  signal: controller.signal,
                }),
              ).pipe(finalize(() => controller.abort()));
            })
          : EMPTY,
      ),
      map((value) => decodeVersion(value)),
      distinctUntilChanged(),
      catchError((error) => throwError(() => feedError(error))),
    );
  }
  /** Creates an application-owned client with no requests until used. @example const client = transport.client(); */
  client(): FeedClient {
    const lifetime = new AbortController();
    const hose = this.transport.hose;
    // Supported browsers have AbortSignal.any; the app's TypeScript DOM types predate it.
    const nativeSignal = AbortSignal as typeof AbortSignal & {
      any(signals: AbortSignal[]): AbortSignal;
    };
    const run = async <A>(
      options: RequestOptions = {},
      operation: (signal: AbortSignal) => Promise<A>,
    ): Promise<A> => {
      const signal = options.signal
        ? nativeSignal.any([lifetime.signal, options.signal])
        : lifetime.signal;
      try {
        signal.throwIfAborted();
        const result = await operation(signal);
        signal.throwIfAborted();
        return result;
      } catch (error) {
        throw feedError(signal.aborted ? signal.reason : error);
      }
    };
    return {
      close: () => {
        lifetime.abort(new ClientFailures.Cancelled());
      },
      logos: {
        getLogo: (request, options) =>
          run(options, async (signal) =>
            Schema.decodeUnknownSync(LogoResult)(
              await this.rpc.feed.logos.get.query(request, { signal }),
            ),
          ),
      },
      calendar: {
        getCalendar: (request, options) =>
          run(options, async (signal) =>
            Schema.decodeUnknownSync(CalendarResult)(
              await this.rpc.feed.calendar.get.query(request, { signal }),
            ),
          ),
      },
      symbology: {
        index: (request, options) =>
          run(options, async (signal) =>
            Schema.decodeUnknownSync(SymbolIndexAccepted)(
              await this.rpc.feed.symbology.index.mutate(request, { signal }),
            ),
          ),
        indexStatus: (options) =>
          run(options, async (signal) =>
            Schema.decodeUnknownSync(SymbolIndexStatus)(
              await this.rpc.feed.symbology.indexStatus.query(undefined, {
                signal,
              }),
            ),
          ),
        search: (request, options) =>
          run(options, async (signal) =>
            decodeSymbolSearchResult(
              await this.rpc.feed.symbology.search.query(request, { signal }),
            ),
          ),
      },
      bars: {
        getCapabilities: (request, options) =>
          run(options, async (signal) =>
            decodeCapabilities(
              await hose.request(
                { type: "bars.capabilities", request },
                { signal },
              ),
            ),
          ),
        observe: shareBarsViews((request) =>
          defer(() => {
            lifetime.signal.throwIfAborted();
            const parsed = decodeBarsChannelRequest({
              type: "bars.open",
              request,
            });
            if (Result.isFailure(parsed))
              throw new FeedError({
                reason: new FeedReasons.InvalidRequest({
                  detail: "The bars request is invalid.",
                }),
              });
            return observeBars(
              hose.observe(parsed.success, { signal: lifetime.signal }).pipe(
                map((value) => decodeMessage(value)),
                catchError((error) => throwError(() => feedError(error))),
              ),
              request,
            );
          }).pipe(catchError((error) => throwError(() => feedError(error)))),
        ),
      },
    };
  }
}
