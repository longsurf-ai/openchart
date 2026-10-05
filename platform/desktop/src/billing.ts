// Purpose: Own Desktop's fixed billing endpoints and permitted browser handoff.
import { z } from "zod";

/** Parse renderer input before opening Stripe in the system browser. */
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

/** Return links trigger refresh only, never payment claims. @example isBillingReturn(url, true); */
export function isBillingReturn(value: string, development: boolean): boolean {
  return (
    value === `${development ? "openchart-dev" : "openchart"}://billing/return`
  );
}
