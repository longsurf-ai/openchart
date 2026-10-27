// Purpose: Own TradingView's socket.io framing and the few wire shapes the provider trusts.

import { Schema } from "effect";
import type { Adjustment, Resolution } from "@openchart/feed";

/** Chart resolutions accepted by TradingView's `create_series` message. */
export const tvResolutions: Readonly<Record<Resolution, string>> = {
  "1s": "1S",
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1W": "W",
  "1M": "M",
};

/** Price basis values accepted in `resolve_symbol`; `none` is unadjusted. */
export const tvAdjustments: Readonly<Record<Adjustment, string>> = {
  raw: "none",
  split: "splits",
  split_dividend: "dividends",
};

/** Message wrapping; TradingView counts JavaScript string length, not bytes. */
export function encodeFrame(method: string, parameters: readonly unknown[]) {
  const message = JSON.stringify({ m: method, p: parameters });
  return `~m~${message.length}~m~${message}`;
}

/** Echoes a heartbeat payload exactly as received. */
export function heartbeatFrame(payload: string) {
  return `~m~${payload.length}~m~${payload}`;
}

/**
 * Splits one socket.io frame batch into its payloads. TradingView may concatenate
 * several `~m~<length>~m~<payload>` records in a single WebSocket message.
 * @example
 * parseFrames('~m~5~m~~h~42~m~9~m~{"m":"x"}'); // ['~h~42', '{"m":"x"}']
 */
export function parseFrames(input: string): readonly string[] {
  const frames: string[] = [];
  let offset = 0;
  while (offset < input.length) {
    if (!input.startsWith("~m~", offset))
      throw new Error("TradingView frame has no length prefix");
    const marker = input.indexOf("~m~", offset + 3);
    if (marker < 0) throw new Error("TradingView frame length is unterminated");
    const length = Number(input.slice(offset + 3, marker));
    if (!Number.isSafeInteger(length) || length < 0)
      throw new Error("TradingView frame length is invalid");
    const start = marker + 3;
    if (start + length > input.length)
      throw new Error("TradingView frame is shorter than its length");
    frames.push(input.slice(start, start + length));
    offset = start + length;
  }
  return frames;
}

const prices = [
  Schema.Finite, // bar open time, seconds
  Schema.Finite, // open
  Schema.Finite, // high
  Schema.Finite, // low
  Schema.Finite, // close
] as const;
const Candle = Schema.Union([
  Schema.Tuple([
    ...prices,
    Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  ]),
  Schema.Tuple(prices), // Indices and yields may have no volume observation.
]);
const SeriesFrame = Schema.Struct({
  s: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
const SeriesPayload = Schema.Struct({
  sds_1: Schema.optionalKey(SeriesFrame),
});
const Envelope = Schema.Struct({
  m: Schema.optionalKey(Schema.String),
  p: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

/** One decoded server frame; handshake and heartbeats carry no prices. */
export type ServerFrame =
  | { readonly kind: "heartbeat"; readonly payload: string }
  | { readonly kind: "hello" }
  | {
      readonly kind: "message";
      readonly method: string;
      readonly parameters: readonly unknown[];
    };

const decodeEnvelope = Schema.decodeUnknownOption(Envelope);

/** Decodes one WebSocket payload from `parseFrames`; malformed JSON is a protocol failure. */
export function decodeFrame(payload: string): ServerFrame {
  if (payload.startsWith("~h~")) return { kind: "heartbeat", payload };
  const decoded = decodeEnvelope(JSON.parse(payload));
  if (decoded._tag === "None")
    throw new Error("TradingView sent an unrecognized frame");
  const message = decoded.value;
  if (message.m === undefined) return { kind: "hello" };
  return {
    kind: "message",
    method: message.m,
    parameters: message.p ?? [],
  };
}

/** One candle decoded from a `timescale_update` or `du` frame. */
export interface Candle {
  /** Bar open in Unix milliseconds. */
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  /** Missing for sources such as indices and yields; never replaced with zero. */
  readonly volume: number | null;
}

const decodeSeries = Schema.decodeUnknownOption(SeriesPayload);
const decodeCandle = Schema.decodeUnknownOption(Schema.Struct({ v: Candle }));

/**
 * Reads the `sds_1` candles from a data frame. Frames for other series or
 * frames without candles produce no rows; a partial price candle is dropped
 * alone so its valid siblings survive. Complete OHLC without a volume
 * observation retains a null volume cell.
 */
export function frameCandles(frame: ServerFrame): readonly Candle[] {
  if (frame.kind !== "message") return [];
  if (frame.method !== "timescale_update" && frame.method !== "du") return [];
  const series = decodeSeries(frame.parameters[1]);
  if (series._tag === "None") return [];
  const candles = series.value.sds_1?.s ?? [];
  return candles.flatMap((entry) => {
    const decoded = decodeCandle(entry);
    if (decoded._tag === "None") return [];
    const [seconds, open, high, low, close, volume] = decoded.value.v;
    const time = seconds * 1000;
    if (!Number.isSafeInteger(time)) return [];
    return [{ time, open, high, low, close, volume: volume ?? null }];
  });
}

/** Extracts string parameters from an error frame, ignoring non-string entries. */
export function frameStrings(frame: ServerFrame): readonly string[] {
  return frame.kind === "message"
    ? frame.parameters.flatMap((value) =>
        typeof value === "string" ? [value] : [],
      )
    : [];
}

/** The delay TradingView reports for a completed live-series subscription.
 * @example const status: StreamStatus = {mode: "delayed", delaySeconds: 600};
 */
export type StreamStatus =
  | { readonly mode: "live" }
  | { readonly mode: "delayed"; readonly delaySeconds: number }
  | { readonly mode: "unknown" };

const decodeStatus = Schema.decodeUnknownOption(Schema.String);

/**
 * Reads TradingView's explicit series mode; bar timestamps never establish delay.
 * Unrecognized completion modes remain unknown. Other messages have no status.
 * @example streamStatus({kind: "message", method: "series_completed", parameters: ["cs", "sds_1", "delayed_streaming_600"]}); // {mode: "delayed", delaySeconds: 600}
 */
export function streamStatus(frame: ServerFrame): StreamStatus | undefined {
  if (frame.kind !== "message" || frame.method !== "series_completed")
    return undefined;
  const mode = decodeStatus(frame.parameters[2]);
  if (mode._tag === "None") return { mode: "unknown" };
  if (mode.value === "streaming") return { mode: "live" };
  const delayed = /^delayed_streaming_(\d+)$/.exec(mode.value);
  const seconds = delayed === null ? undefined : Number(delayed[1]);
  return seconds !== undefined && Number.isSafeInteger(seconds) && seconds > 0
    ? { mode: "delayed", delaySeconds: seconds }
    : { mode: "unknown" };
}
