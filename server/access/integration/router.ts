// Purpose: Exposes provider discovery and API-key management through the shared tRPC boundary.

import { trpc } from "@openchart/server/lib/trpc";
import { Schema } from "effect";

import { Integration } from "./integration";
import { OPENCHART_CLOUD } from "./openchart-cloud";

const parseOptions = { onExcessProperty: "error" } as const;
const ProviderIntegrationID = Integration.IntegrationID.check(
  Schema.makeFilter((id) => id !== OPENCHART_CLOUD.integrationID, {
    message: "Account credentials must be managed through Auth",
  }),
);

/**
 * First-phase management routes mounted under `access.integration` by the access router.
 * Inputs are parsed once and forwarded to the shared Integration service.
 * Only provider listing, API-key saving, and disconnect are public.
 * Single-provider lookup, enablement, OAuth, and credential resolution stay internal.
 * First-party account credentials are managed exclusively through Auth.
 *
 * @example
 * const integrations = await client.access.integration.listIntegrations.query();
 * await client.access.integration.connection.setApiKey.mutate({
 *   integrationID: 'example-provider',
 *   key: suppliedKey,
 * });
 */
export const integrationRouter = trpc.router({
  listIntegrations: trpc.procedure.query(({ ctx }) =>
    ctx.runtime.runPromise(
      Integration.Service.use((integrations) =>
        integrations.listIntegrations(),
      ),
    ),
  ),
  connection: trpc.router({
    setApiKey: trpc.procedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({
            integrationID: ProviderIntegrationID,
            key: Schema.String,
            label: Schema.optionalKey(Schema.String),
          }),
          { parseOptions },
        ),
      )
      .mutation(({ ctx, input }) =>
        ctx.runtime.runPromise(
          Integration.Service.use((integrations) =>
            integrations.connection.setApiKey(input),
          ),
        ),
      ),
    disconnect: trpc.procedure
      .input(
        Schema.toStandardSchemaV1(
          Schema.Struct({ integrationID: ProviderIntegrationID }),
          { parseOptions },
        ),
      )
      .mutation(({ ctx, input }) =>
        ctx.runtime.runPromise(
          Integration.Service.use((integrations) =>
            integrations.connection.disconnect(input.integrationID),
          ),
        ),
      ),
  }),
});
