// Purpose: Keep company/crypto branding tied to the actual market and reject ambiguous multi-symbol rules.
import { expect, test } from "vitest";
import { ProviderId, type Listing } from "@openchart/market";
import type * as Tea from "@openchart/tea";
import { alertLogoIdentifier } from "@openchart/app/features/alerts/lib/alert-logo-identifier";
import { encodedBarsInputs } from "@openchart/app/lib/tea";

const input = (
  provider: string,
  symbol: string,
  currency: string,
  assetClass?: Listing["class"],
) => ({
  provider: ProviderId.make(provider),
  listing: { symbol, currency, class: assetClass },
});
const config = (
  market: ReturnType<typeof input>,
  requests: Tea.NodeConfigEncoded["requests"] = {},
): Tea.NodeConfigEncoded => ({
  ...encodedBarsInputs({
    ...market,
    resolution: "1d",
    session: "regular",
    adjustment: "raw",
  }),
  parameters: {},
  requests,
});

test("passes source symbols unchanged and skips missing inputs", () => {
  expect(alertLogoIdentifier(input("binance", "BTCUSDT", "USDT"))).toBe(
    "BTCUSDT",
  );
  expect(alertLogoIdentifier(input("yfinance", "AAPL", "USD"))).toBe("AAPL");
  expect(alertLogoIdentifier(undefined)).toBeUndefined();
  expect(alertLogoIdentifier(input("yfinance", "ABT", "USD", "stock"))).toBe(
    "stock:ABT",
  );
  expect(alertLogoIdentifier(input("coinbase", "ABT", "USD", "crypto"))).toBe(
    "crypto:ABT",
  );
});

test("same-market Bars inputs, request children included, retain the logo; another market uses the alert initial", () => {
  const apple = input("yfinance", "AAPL", "USD", "stock");
  const msft = input("yfinance", "MSFT", "USD", "stock");
  expect(
    alertLogoIdentifier(
      apple,
      config(apple, { study: config(apple, { nested: config(apple) }) }),
    ),
  ).toBe("stock:AAPL");
  // A followed Indicator's root names no inputs; its market is `input`.
  expect(
    alertLogoIdentifier(apple, { requests: { study: config(apple) } }),
  ).toBe("stock:AAPL");
  expect(
    alertLogoIdentifier(
      apple,
      config(apple, { study: config(apple, { nested: config(msft) }) }),
    ),
  ).toBeUndefined();
  expect(
    alertLogoIdentifier(
      apple,
      config(apple, { other: config(input("other", "AAPL", "USD", "stock")) }),
    ),
  ).toBeUndefined();
  const root = config(apple);
  expect(
    alertLogoIdentifier(apple, {
      ...root,
      inputs: { ...root.inputs, other: config(msft).inputs.bars! },
    }),
  ).toBeUndefined();
});
