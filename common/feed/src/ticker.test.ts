// Purpose: Ticker ids name one listing per provider and round-trip through syminfo.tickerid.
import { Schema } from "effect";
import { ProviderListing } from "@openchart/market";
import { describe, expect, test } from "vitest";
import { parseTickerId, tickerId } from "./ticker";

const listing = (provider: string, symbol: string, venue?: string) =>
  Schema.decodeUnknownSync(ProviderListing)({
    provider,
    listing: { symbol, currency: "USD", ...(venue && { venue }) },
  });

describe("ticker ids", () => {
  test.each([
    ["binance", "ETHUSDT"],
    ["openchart", "AAPL"],
    ["yfinance", "AAPL"],
  ])(
    "a %s listing's ticker id reads back as that listing",
    (provider, symbol) => {
      const one = listing(provider, symbol);
      const id = tickerId(one)!;
      expect(id).toBe(`${provider}:${symbol}`);
      expect(parseTickerId(id)?.names(one)).toBe(true);
    },
  );

  test("the provider and symbol match ignoring case, but only on that provider", () => {
    const ticker = parseTickerId("BINANCE:ethusdt")!;
    expect(ticker).toMatchObject({ provider: "binance", symbol: "ethusdt" });
    expect(ticker.names(listing("binance", "ETHUSDT"))).toBe(true);
    expect(ticker.names(listing("binance", "ETHUSDC"))).toBe(false);
    expect(ticker.names(listing("yfinance", "ETHUSDT"))).toBe(false);
  });

  test.each(["ETHUSDT", ":ETHUSDT", "binance:", "nowhere:ETHUSDT"])(
    "%s is not a ticker id",
    (text) => expect(parseTickerId(text)).toBeUndefined(),
  );

  test("a provider without ticker ids gives no ticker id", () => {
    expect(tickerId(listing("nowhere", "ETHUSDT"))).toBeUndefined();
  });
});

describe("TradingView ticker ids keep the venue", () => {
  test.each([
    ["BITSTAMP", "BTCUSD"],
    ["CME_MINI", "NQ1!"],
  ])("a listing at %s reads back as that listing only", (venue, symbol) => {
    const one = listing("tradingview", symbol, venue);
    const id = tickerId(one)!;
    expect(id).toBe(`tradingview:${venue}:${symbol}`);
    const ticker = parseTickerId(id)!;
    expect(ticker.symbol).toBe(`${venue}:${symbol}`);
    expect(ticker.names(one)).toBe(true);
    expect(ticker.names(listing("tradingview", symbol, "OTHER"))).toBe(false);
    expect(ticker.names(listing("tradingview", symbol))).toBe(false);
  });

  test("venue and symbol match ignoring case", () => {
    expect(
      parseTickerId("TRADINGVIEW:bitstamp:btcusd")!.names(
        listing("tradingview", "BTCUSD", "BITSTAMP"),
      ),
    ).toBe(true);
  });

  test("an already qualified symbol is written as it is", () => {
    const qualified = listing("tradingview", "BITSTAMP:BTCUSD", "BITSTAMP");
    expect(tickerId(qualified)).toBe("tradingview:BITSTAMP:BTCUSD");
    expect(parseTickerId(tickerId(qualified)!)!.names(qualified)).toBe(true);
  });

  test("a listing without a venue has no ticker id, and a symbol without one names no listing", () => {
    expect(tickerId(listing("tradingview", "BTCUSD"))).toBeUndefined();
    const bare = parseTickerId("tradingview:BTCUSD")!;
    expect(bare.names(listing("tradingview", "BTCUSD", "BITSTAMP"))).toBe(
      false,
    );
    expect(bare.names(listing("tradingview", "BTCUSD"))).toBe(false);
  });
});
