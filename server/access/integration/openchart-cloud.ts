// Purpose: Register the API key credential method for OpenChart cloud services.
import { Integration } from "./integration";

/** API key registration for OpenChart cloud; Integration owns local persistence. */
export const OPENCHART_CLOUD: Integration.ApiKeyImplementation = {
  integrationID: Integration.IntegrationID.make("openchart-cloud"),
  method: { type: "key", label: "API key" },
};
