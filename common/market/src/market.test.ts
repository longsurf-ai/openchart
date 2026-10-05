// Purpose: Lock provider-scoped listing decoding and atomic session interval checks.

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Listing, ProviderId, TradingDay } from "./index";

describe("market vocabulary", () => {
  it("decodes listings and branded provider ids", () => {
    const listing = Schema.decodeUnknownSync(Listing)({
      symbol: "BTCUSDT",
      class: "crypto",
      currency: "USDT",
    });
    expect(listing.symbol).toBe("BTCUSDT");
    expect(Schema.decodeUnknownSync(ProviderId)("binance")).toBe("binance");
    expect(Schema.is(ProviderId)("")).toBe(false);
  });

  it("accepts only atomic sessions with start before end", () => {
    const accepts = Schema.is(TradingDay);
    expect(
      accepts({ date: 0, sessions: [{ type: "regular", start: 1, end: 2 }] }),
    ).toBe(true);
    expect(
      accepts({ date: 0, sessions: [{ type: "regular", start: 2, end: 2 }] }),
    ).toBe(false);
    expect(
      accepts({ date: 0, sessions: [{ type: "extended", start: 1, end: 2 }] }),
    ).toBe(false);
  });
});
