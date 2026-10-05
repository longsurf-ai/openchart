// Purpose: The first chart window covers everything the saved zoom shows.
import { BarsSeries, resolutionMs } from "@openchart/feed";
import { Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { initialBarsRequest } from "@openchart/app/lib/chart/data";

const series = Schema.decodeUnknownSync(BarsSeries)({
  provider: "binance",
  listing: {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    class: "crypto",
    venue: "BINANCE",
    currency: "USDT",
  },
  resolution: "1d",
  session: "24h",
  adjustment: "raw",
});

afterEach(() => {
  vi.useRealTimers();
});

it("requests a power of two covering a quarter more than the bars that fit at the saved spacing", () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 3) });
  // A zoomed-out chart: 1016 px at 1.3 px per bar shows about 780 bars.
  const zoomedOut = initialBarsRequest(
    series,
    { viewport: null, barSpacing: 1.3 },
    1016,
  );
  expect(zoomedOut).toMatchObject({ countBack: 1024, to: "now" });
  expect(zoomedOut.from).toBe(Date.now() - 1024 * resolutionMs["1d"]);
  // A width still settling while the chart mounts asks for the same window.
  expect(
    initialBarsRequest(series, { viewport: null, barSpacing: 1.3 }, 1040)
      .countBack,
  ).toBe(1024);
  expect(
    initialBarsRequest(series, { viewport: null, barSpacing: 6 }, 1016)
      .countBack,
  ).toBe(256);
  expect(
    initialBarsRequest(series, { viewport: null, barSpacing: 50 }, 1016)
      .countBack,
  ).toBe(128);
});
