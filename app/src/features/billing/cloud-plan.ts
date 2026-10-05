// Purpose: Keep the single Cloud offer consistent across purchase and management UI.
/** Display prices in USD; Cloud resolves the actual Stripe price at checkout. */
export const cloudPlan = {
  id: "openchart",
  name: "OpenChart Cloud",
  prices: { month: 9, year: 99 },
} as const;

/** Billing periods offered by the Cloud plan. */
export type BillingInterval = keyof typeof cloudPlan.prices;
