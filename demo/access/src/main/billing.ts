// Purpose: Validate the narrow browser and return capabilities owned by the demo host.
import { z } from "zod";

/** Stripe hosts only; renderer-controlled values cannot open arbitrary applications. */
export const BillingLink = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    ["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
  );
}, "Expected a Stripe billing URL");

/** Accept only the fixed billing return, without interpreting payment claims. @example isBillingReturn('openchart://billing/return'); */
export function isBillingReturn(value: string): boolean {
  return value === "openchart://billing/return";
}
