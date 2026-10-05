// Purpose: Ticker ids name one listing per provider and round-trip through syminfo.tickerid.
import { Schema } from "effect";
import { ProviderListing } from "@openchart/market";
import { describe, expect, test } from "vitest";
import { parseTickerId, tickerId } from "./ticker";

const listing = (provider: string, symbol: string) =>
  Schema.decodeUnknownSync(ProviderListing)({
    provider,
    listing: { symbol, currency: "USD" },
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
