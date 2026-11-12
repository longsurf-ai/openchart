// Purpose: Stores and resolves API-provider keys through encrypted Credential records.
import { Credential } from "@openchart/server/access/credential";
import { Integration } from "@openchart/server/access/integration";
import { Effect } from "effect";

const integrationID = (providerID: string) =>
  Integration.IntegrationID.make(providerID);

/** Reads the active key for one provider, or undefined when none is saved. */
export const readModelKey = (
  credentials: Credential.Interface,
  providerID: string,
) =>
  credentials.list(integrationID(providerID), true).pipe(
    Effect.map((rows) => {
      const value = rows[0]?.value;
      return value?.type === "key" ? value.key : undefined;
    }),
  );

/** Atomically replaces the provider's key. */
export const writeModelKey = (
  credentials: Credential.Interface,
  providerID: string,
  key: string,
) =>
  credentials
    .create({
      integrationID: integrationID(providerID),
      value: Credential.Key.make({ type: "key", key }),
    })
    .pipe(Effect.asVoid);

/** Removes the provider's key without reading it. */
export const clearModelKey = (
  credentials: Credential.Interface,
  providerID: string,
) => credentials.clear(integrationID(providerID));
