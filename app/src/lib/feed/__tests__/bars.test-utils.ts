// Purpose: Shared Bars request and immutable native-column frames for cache tests.
import { BarsRequest, type BarsMessage } from "@openchart/feed";
import { BarColumns } from "@openchart/market";
import { defineDataFrame } from "@openchart/timeseries";
import { Schema } from "effect";

export const request = Schema.decodeUnknownSync(BarsRequest)({
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "BINANCE",
    currency: "USDT",
  },
  resolution: "1m",
  session: "24h",
  adjustment: "raw",
  from: 0,
  to: "now",
  countBack: 1,
});
// Native columns sit beside the required Bar vocabulary.
const NativeBars = defineDataFrame({
  ...BarColumns,
  final: Schema.Boolean,
  asOf: Schema.Finite,
});
export const frame = (close = 2, times = [1]) =>
  NativeBars.create({
    labels: { symbol: "BTCUSDT" },
    rows: times.map((time) => ({
      time,
      open: 1,
      high: 2,
      low: 1,
      close,
      volume: 1,
      final: false,
      asOf: 10,
    })),
  });
export const snapshot = {
  type: "snapshot",
  snapshot: { data: frame(), range: { from: 0, to: 10 }, hasMoreBefore: false },
} satisfies BarsMessage;
