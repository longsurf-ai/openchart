// Purpose: Keep company/crypto branding tied to the actual market and reject ambiguous multi-symbol rules.
import { expect, test } from "vitest";
import { ProviderId, type Listing } from "@openchart/market";
import type * as Tea from "@openchart/tea";
import { alertLogoUrl } from "@openchart/app/features/alerts/lib/alert-logo-url";
import { logoUrl } from "@openchart/app/lib/logo/logo";
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

test("uses the market logo and skips missing inputs", () => {
  expect(alertLogoUrl(input("yfinance", "AAPL", "USD", "stock"))).toBe(
    logoUrl(input("yfinance", "AAPL", "USD", "stock").listing),
  );
  expect(alertLogoUrl(undefined)).toBeUndefined();
});

test("same-market Bars inputs, request children included, retain the logo; another market uses the alert initial", () => {
  const apple = input("yfinance", "AAPL", "USD", "stock");
  const msft = input("yfinance", "MSFT", "USD", "stock");
  expect(
    alertLogoUrl(
      apple,
      config(apple, { study: config(apple, { nested: config(apple) }) }),
    ),
  ).toBe(logoUrl(apple.listing));
  // A followed Indicator's root names no inputs; its market is `input`.
  expect(alertLogoUrl(apple, { requests: { study: config(apple) } })).toBe(
    logoUrl(apple.listing),
  );
  expect(
    alertLogoUrl(
      apple,
      config(apple, { study: config(apple, { nested: config(msft) }) }),
    ),
  ).toBeUndefined();
  expect(
    alertLogoUrl(
      apple,
      config(apple, { other: config(input("other", "AAPL", "USD", "stock")) }),
    ),
  ).toBeUndefined();
  const root = config(apple);
  expect(
    alertLogoUrl(apple, {
      ...root,
      inputs: { ...root.inputs, other: config(msft).inputs.bars! },
    }),
  ).toBeUndefined();
});
