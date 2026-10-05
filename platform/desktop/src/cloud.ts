// Purpose: Keep Desktop's billing and data endpoints in the same Clerk environment.

/** Public endpoints only; credentials remain in Clerk and the backend credential store. */
export const cloudEndpoints = {
  development: {
    billingUrl: "https://ysufdj6lyh.execute-api.us-west-2.amazonaws.com",
    openchartUrl: "https://api.sandbox.longsurf.ai",
  },
  production: {
    billingUrl: "https://8i7jbmb44d.execute-api.us-west-2.amazonaws.com",
    openchartUrl: "https://api.alpha.longsurf.ai",
  },
} as const;

/**
 * Shared development test user for `just desktop test-account`. Clerk's test
 * mode accepts the fixed code 424242 for `+clerk_test` addresses; production
 * keeps test mode off, so this address cannot sign in there.
 */
export const developmentTestAccount = "openchart-dev+clerk_test@longsurf.ai";
