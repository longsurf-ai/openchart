// Purpose: Pin the Stripe-only browser handoff and separate test/live return schemes.
import { expect, test } from "vitest";
import { BillingLink, isBillingReturn } from "./billing";

test("only Stripe Checkout and Portal HTTPS links cross the host boundary", () => {
  for (const url of [
    "https://checkout.stripe.com/c/pay/cs_test_fixture",
    "https://billing.stripe.com/p/session/test_fixture",
  ])
    expect(BillingLink.parse(url)).toBe(url);
  for (const url of [
    "http://checkout.stripe.com/a",
    "https://checkout.stripe.com.evil.test/a",
    "https://user@checkout.stripe.com/a",
    "https://checkout.stripe.com:123/a",
    "file:///tmp/a",
    "openchart://billing/return",
  ])
    expect(BillingLink.safeParse(url).success).toBe(false);
});

test("returns are exact, environment-specific signals without payment claims", () => {
  expect(isBillingReturn("openchart://billing/return", false)).toBe(true);
  expect(isBillingReturn("openchart-dev://billing/return", true)).toBe(true);
  expect(isBillingReturn("openchart://billing/return", true)).toBe(false);
  expect(isBillingReturn("openchart-dev://billing/return", false)).toBe(false);
  for (const url of [
    "openchart://billing/return?success=true",
    "openchart://billing/return#paid",
    "openchart://billing/other",
  ])
    expect(isBillingReturn(url, false)).toBe(false);
});
