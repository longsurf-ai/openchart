// Purpose: Keep Desktop's customer-management endpoint in its Clerk environment.

/** Public endpoints only; credentials remain in Clerk and the backend credential store. */
export const cloudEndpoints = {
  development: {
    billingUrl: "https://billing.sandbox.longsurf.ai",
  },
  production: {
    billingUrl: "https://billing.longsurf.ai",
  },
} as const;

/**
 * Shared development test user for `just desktop test-account`. Clerk's test
 * mode accepts the fixed code 424242 for `+clerk_test` addresses; production
 * keeps test mode off, so this address cannot sign in there.
 */
export const developmentTestAccount = "openchart-dev+clerk_test@longsurf.ai";
