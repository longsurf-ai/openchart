import { describe, expect, test } from "vitest";
import {
  decodeFrame,
  encodeFrame,
  frameCandles,
  heartbeatFrame,
  parseFrames,
  streamStatus,
} from "./protocol";

describe("TradingView socket.io framing", () => {
  test("encodes one method with its JavaScript string length", () => {
    expect(encodeFrame("set_auth_token", ["token"])).toBe(
      `~m~${'{"m":"set_auth_token","p":["token"]}'.length}~m~{"m":"set_auth_token","p":["token"]}`,
    );
  });

  test("splits concatenated frames and echoes heartbeats exactly", () => {
    const batch = `${heartbeatFrame("~h~42")}${encodeFrame("x", [1])}`;
    expect(parseFrames(batch)).toEqual(["~h~42", '{"m":"x","p":[1]}']);
    expect(decodeFrame("~h~42")).toEqual({
      kind: "heartbeat",
      payload: "~h~42",
    });
  });

  test("reads the handshake as hello and named messages as commands", () => {
    expect(decodeFrame('{"session_id":"abc"}')).toEqual({ kind: "hello" });
    expect(decodeFrame('{"m":"series_completed","p":["cs","sds_1"]}')).toEqual({
      kind: "message",
      method: "series_completed",
      parameters: ["cs", "sds_1"],
    });
  });

  test("rejects truncated and unterminated lengths", () => {
    expect(() => parseFrames("~m~10~m~short")).toThrow(/shorter/);
    expect(() => parseFrames("~m~4")).toThrow(/unterminated/);
    expect(() => parseFrames("nope")).toThrow(/length prefix/);
  });
});

test.each([
  ["streaming", { mode: "live" }],
  ["delayed_streaming_600", { mode: "delayed", delaySeconds: 600 }],
  ["delayed_streaming_900", { mode: "delayed", delaySeconds: 900 }],
  ["delayed_streaming_nope", { mode: "unknown" }],
  ["end_of_data", { mode: "unknown" }],
  [undefined, { mode: "unknown" }],
])(
  "reads explicit completion status %s without inferring real-time access",
  (mode, expected) => {
    expect(
      streamStatus({
        kind: "message",
        method: "series_completed",
        parameters: ["cs", "sds_1", mode],
      }),
    ).toEqual(expected);
  },
);

describe("TradingView candle frames", () => {
  const update = (method: string, candles: unknown[]) =>
    decodeFrame(
      JSON.stringify({
        m: method,
        p: ["cs", { sds_1: { s: candles.map((v) => ({ v })) } }],
      }),
    );

  test("converts candle seconds to milliseconds and keeps OHLCV", () => {
    expect(
      frameCandles(
        update("timescale_update", [[1_700_000_000, 1, 2, 0.5, 1.5, 10]]),
      ),
    ).toEqual([
      {
        time: 1_700_000_000_000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
      },
    ]);
  });

  test("streams du updates and ignores incomplete candles", () => {
    expect(
      frameCandles(
        update("du", [
          [1_700_000_060, 2, 3, 1, 2.5, 4],
          [1_700_000_120, 2, 3],
        ]),
      ),
    ).toEqual([
      {
        time: 1_700_000_060_000,
        open: 2,
        high: 3,
        low: 1,
        close: 2.5,
        volume: 4,
      },
    ]);
  });

  test("indices retain complete OHLC with missing volume instead of disappearing", () => {
    const rows = frameCandles(
      update("timescale_update", [
        [1_700_000_000, 1, 2, 0.5, 1.5],
        [1_700_000_060, 2, 3, 1.5, 2.5, null],
        [1_700_000_120, 3, 4, 2.5, 3.5, 0],
        [1_700_000_180, 3, 4, 2.5, 3.5, -1],
      ]),
    );
    expect(rows.map(({ close, volume }) => [close, volume])).toEqual([
      [1.5, null],
      [2.5, null],
      [3.5, 0],
    ]);
  });

  test("non-data methods and malformed payloads produce no candles", () => {
    expect(frameCandles(update("series_completed", []))).toEqual([]);
    expect(
      frameCandles(decodeFrame('{"m":"timescale_update","p":["cs",42]}')),
    ).toEqual([]);
  });
});
