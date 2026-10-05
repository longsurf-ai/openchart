// Purpose: Aggregates account and provider access tRPC routers.

import { billingRouter } from "@openchart/server/access/billing/router";
import { authRouter } from "@openchart/server/access/auth/router";
import { integrationRouter } from "@openchart/server/access/integration/router";
import { trpc } from "@openchart/server/lib/trpc";

/**
 * Groups access routes by service under the root router's `access` namespace.
 * Child routers own their procedures and service calls.
 *
 * @example
 * const integrations = await client.access.integration.listIntegrations.query();
 */
export const accessRouter = trpc.router({
  integration: integrationRouter,
  auth: authRouter,
  billing: billingRouter,
});
