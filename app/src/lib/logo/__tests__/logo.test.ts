// Purpose: Map provider-native listings to the Elbstream identifiers that resolve them.
import { expect, test } from "vitest";
import { logoUrl } from "@openchart/app/lib/logo/logo";

const base = "https://api.elbstream.com/logos";

test("crypto pairs resolve their base asset", () => {
  expect(
    logoUrl({ symbol: "BTCUSDT", class: "crypto", currency: "USDT" }),
  ).toBe(`${base}/crypto/BTC`);
  expect(logoUrl({ symbol: "BTC-USD", class: "crypto", currency: "USD" })).toBe(
    `${base}/crypto/BTC`,
  );
});

test("other listings prefer ISIN, then the encoded native symbol", () => {
  expect(
    logoUrl({
      symbol: "AAPL",
      class: "stock",
      currency: "USD",
      instrument: { id: "1", isin: "US0378331005" },
    }),
  ).toBe(`${base}/isin/US0378331005`);
  expect(logoUrl({ symbol: "0700.HK", class: "stock", currency: "HKD" })).toBe(
    `${base}/symbol/0700.HK`,
  );
  expect(logoUrl({ symbol: "^GSPC", currency: "USD" })).toBe(
    `${base}/symbol/%5EGSPC`,
  );
});
