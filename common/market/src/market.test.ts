// Purpose: Lock provider-scoped listing decoding and atomic session interval checks.

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Listing, ProviderId, TradingDay, providerListingKey } from "./index";

describe("market vocabulary", () => {
  it("uses provider and native listing ID independently of display metadata", () => {
    const first = {
      provider: ProviderId.make("openchart"),
      listing: { id: 10244, symbol: "SPCX", venue: "NASDAQ", currency: "USD" },
    };
    expect(providerListingKey(first)).not.toBe(
      providerListingKey({
        ...first,
        listing: { ...first.listing, id: 55090 },
      }),
    );
    expect(providerListingKey(first)).toBe(
      providerListingKey({
        ...first,
        listing: {
          ...first.listing,
          symbol: "RENAMED",
          venue: "NEW",
          currency: "CAD",
        },
      }),
    );
    expect(providerListingKey(first)).not.toBe(
      providerListingKey({
        ...first,
        provider: ProviderId.make("another"),
      }),
    );
    const withoutId = {
      ...first,
      listing: { symbol: "SPCX", venue: "NASDAQ", currency: "USD" },
    };
    expect(providerListingKey(first)).not.toBe(providerListingKey(withoutId));
    expect(providerListingKey(withoutId)).not.toBe(
      providerListingKey({
        ...withoutId,
        listing: { ...withoutId.listing, venue: "NYSE" },
      }),
    );
    expect(providerListingKey(withoutId)).toBe(
      providerListingKey({
        ...withoutId,
        listing: { ...withoutId.listing, currency: "CAD", name: "New name" },
      }),
    );
  });

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
