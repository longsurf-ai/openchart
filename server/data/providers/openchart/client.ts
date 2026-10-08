// Purpose: Encapsulate the authenticated OpenChart API, wire decoding, and account-scoped I/O.
export * as OpenChart from "./client";
import { Integration } from "@openchart/server/access/integration";
import { OPENCHART_CLOUD } from "@openchart/server/access/integration/openchart-cloud";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Redacted,
  Stream,
  SubscriptionRef,
  Scope,
  Schema,
} from "effect";
import { makeLive } from "./live";
import { tableFromIPC } from "apache-arrow";
import { Listing } from "@openchart/market";
import { CalendarRows } from "@openchart/server/data/providers/local/market/calendar/data";
import {
  Capabilities,
  openchartBar,
  type Bar,
  type BarsSubscription,
  type Client,
} from "./contract";
import { connectionConfig as openchartConfig } from "./config";
import {
  OpenChartTimeout,
  OpenChartUnavailable,
  OpenChartInvalidResponse,
  OpenChartRejected,
  CredentialUnavailable,
} from "./errors";

type Parameters = Readonly<Record<string, string>>;
const SearchResponse = Schema.fromJsonString(
  Schema.Struct({ results: Schema.Array(Listing) }),
);
const CalendarResponse = Schema.fromJsonString(
  CalendarRows.mapFields(
    (fields) => ({ ...fields, calendar: Schema.NonEmptyString }),
    { unsafePreserveChecks: true }, // The referenced row fields are unchanged.
  ),
);
const CapabilitiesResponse = Schema.fromJsonString(
  Schema.Struct({
    ...Capabilities.fields,
    historyFormat: Schema.Literal("arrow"),
    queryTimeUnit: Schema.Literal("milliseconds"),
    liveTimeUnit: Schema.Literal("milliseconds"),
  }),
);
const WireRows = Schema.Array(
  Schema.Struct({
    listing_id: Schema.Int,
    ts_event: Schema.BigInt,
    open: Schema.BigInt,
    high: Schema.BigInt,
    low: Schema.BigInt,
    close: Schema.BigInt,
    volume: openchartBar.fields.volume,
    final: Schema.Boolean,
    as_of: Schema.BigInt,
  }),
);
const seriesParameters = (query: BarsSubscription): Parameters => ({
  listing: String(query.listing),
  resolution: query.resolution,
  adjustment: query.adjustment,
  session: query.session,
});
const decodeResponse = Effect.fn("OpenChart.decodeResponse")(function* <A>(
  schema: Schema.Decoder<A>,
  input: unknown,
) {
  return yield* Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => new OpenChartInvalidResponse({})),
  );
});
const decodeHistory = Effect.fn("OpenChart.decodeHistory")(function* (
  bytes: Uint8Array,
  listing: number,
) {
  const end = [255, 255, 255, 255, 0, 0, 0, 0];
  if (
    bytes.length < 8 ||
    end.some((value, i) => bytes[bytes.length - 8 + i] !== value)
  )
    return yield* new OpenChartInvalidResponse({});
  const rows = yield* Effect.try({
    try: () =>
      tableFromIPC(bytes)
        .toArray()
        .map((row) => row.toJSON()),
    catch: () => new OpenChartInvalidResponse({}),
  });
  const values = yield* decodeResponse(WireRows, rows);
  const result: Bar[] = [];
  for (const row of values) {
    if (row.listing_id !== listing)
      return yield* new OpenChartInvalidResponse({});
    result.push({
      time: Number(row.ts_event / 1_000_000n),
      open: Number(row.open) / 1e9,
      high: Number(row.high) / 1e9,
      low: Number(row.low) / 1e9,
      close: Number(row.close) / 1e9,
      volume: row.volume,
      final: row.final,
      asOf: Number(row.as_of / 1_000_000n),
    });
  }
  return result;
});
/** Shared transport for Auth and the OpenChart Provider. @example const openchart = yield* OpenChartClient; */
export class OpenChartClient extends Context.Service<OpenChartClient, Client>()(
  "OpenChartClient",
) {}

/** Build one transport; all secrets stay in Authorization headers. @example layer().pipe(Layer.provide(integrations)); */
export const layer = (baseUrl?: string) =>
  Layer.effect(
    OpenChartClient,
    Effect.gen(function* () {
      const config = yield* openchartConfig(baseUrl);
      const integrations = yield* Integration.Service;
      const generation = yield* SubscriptionRef.make(0);
      let controller = new AbortController();
      let closed = false;
      const changed = () => new CredentialUnavailable({ reason: "changed" });
      const invalidated = (signal: AbortSignal) =>
        Effect.callback<never, CredentialUnavailable>((resume) => {
          const abort = () => resume(Effect.fail(changed()));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
          return Effect.sync(() => signal.removeEventListener("abort", abort));
        });
      const credential = Effect.fn("OpenChart.credential")(function* () {
        if (closed)
          return yield* new CredentialUnavailable({ reason: "closed" });
        const owner = controller.signal;
        const value = yield* integrations.connection
          .resolveCredential(OPENCHART_CLOUD.integrationID)
          .pipe(
            Effect.mapError(
              () => new CredentialUnavailable({ reason: "unavailable" }),
            ),
            Effect.raceFirst(invalidated(owner)),
          );
        if (owner.aborted) return yield* changed();
        if (!value)
          return yield* new CredentialUnavailable({ reason: "missing" });
        if (value.type !== "key")
          return yield* new CredentialUnavailable({ reason: "unavailable" });
        return Redacted.make(value.key);
      });
      const invalidate = Effect.sync(() => {
        controller.abort();
        controller = new AbortController();
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closed = true;
          controller.abort();
        }),
      );
      const urlFor = (path: string, parameters: Parameters) => {
        const url = new URL(path, config.baseUrl);
        if (url.origin !== config.baseUrl.origin)
          throw new Error(
            "OpenChart endpoint must stay on the configured origin",
          );
        url.search = new URLSearchParams(parameters).toString();
        return url;
      };
      const withRequestTimeout = Effect.timeoutOrElse({
        duration: config.requestTimeout,
        orElse: () => Effect.fail(new OpenChartTimeout({})),
      });
      const request = Effect.fn("OpenChart.request")(function* <Body, A>(
        path: string,
        parameters: Parameters,
        read: (response: Response) => Promise<Body>,
        decode: (body: Body) => Effect.Effect<A, OpenChartInvalidResponse>,
      ) {
        const owner = controller.signal;
        const token = yield* credential();
        const body = yield* Effect.tryPromise({
          try: async (signal) => {
            const response = await fetch(urlFor(path, parameters), {
              headers: { Authorization: `Bearer ${Redacted.value(token)}` },
              redirect: "error",
              signal: AbortSignal.any([signal, owner]),
            });
            if (!response.ok)
              throw new OpenChartRejected({ status: response.status });
            return await read(response);
          },
          catch: (cause) =>
            owner.aborted
              ? changed()
              : cause instanceof OpenChartRejected ||
                  cause instanceof OpenChartInvalidResponse
                ? cause
                : new OpenChartUnavailable({}),
        });
        const value = yield* decode(body);
        if (owner.aborted) return yield* changed();
        return value;
      }, withRequestTimeout);
      const liveUrl = urlFor("/marketfeed/live", {});
      liveUrl.protocol = liveUrl.protocol === "https:" ? "wss:" : "ws:";
      const subscribe = yield* makeLive(
        liveUrl,
        credential,
        () => controller.signal,
      );
      return {
        changes: SubscriptionRef.changes(generation).pipe(
          Stream.map(() => undefined),
        ),
        reset: () =>
          invalidate.pipe(
            Effect.andThen(SubscriptionRef.update(generation, (n) => n + 1)),
          ),
        getCapabilities: () =>
          request(
            "/marketfeed/capabilities",
            {},
            (response) => response.text(),
            (body) =>
              decodeResponse(CapabilitiesResponse, body).pipe(
                Effect.map((value) => ({
                  resolutions: value.resolutions,
                  historyAdjustments: value.historyAdjustments,
                  liveAdjustments: value.liveAdjustments,
                  adjustedLiveResolutions: value.adjustedLiveResolutions,
                  sessions: value.sessions,
                  maxHistoryRows: value.maxHistoryRows,
                  maxConnectionSeconds: value.maxConnectionSeconds,
                })),
              ),
          ),
        searchListings: (query) =>
          request(
            "/symbology/search",
            { query: query.query, limit: String(query.limit ?? 200) },
            (response) => response.text(),
            (body) =>
              decodeResponse(SearchResponse, body).pipe(
                Effect.map((value) => value.results),
              ),
          ),
        readCalendar: (listing) =>
          request(
            "/calendar",
            { listing: String(listing) },
            (response) => response.text(),
            (body) => decodeResponse(CalendarResponse, body),
          ),
        readBarsPage: (query) =>
          request(
            "/marketfeed/bars.arrow",
            {
              ...seriesParameters(query),
              start: String(query.start),
              end: String(query.end),
              limit: String(query.limit),
              order: query.order,
            },
            async (response) => {
              if (
                !response.headers
                  .get("content-type")
                  ?.startsWith("application/vnd.apache.arrow.stream")
              )
                throw new OpenChartInvalidResponse({});
              return new Uint8Array(await response.arrayBuffer());
            },
            (body) => decodeHistory(body, query.listing),
          ),
        subscribeBars: Effect.fn("OpenChart.subscribeBars")(
          function* (
            query: BarsSubscription,
            retired?: Deferred.Deferred<void>,
          ) {
            return yield* subscribe(query, retired);
          },
          (acquire) =>
            Effect.gen(function* () {
              const scope = yield* Scope.fork(yield* Effect.scope);
              return yield* acquire.pipe(
                Scope.provide(scope),
                withRequestTimeout,
                Effect.onError((cause) =>
                  Scope.close(scope, Exit.failCause(cause)),
                ),
              );
            }),
        ),
      } satisfies Client;
    }),
  );
