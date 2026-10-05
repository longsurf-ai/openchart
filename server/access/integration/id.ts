// Purpose: Owns Integration identifiers without service dependencies.

import { defineId } from "@openchart/identifier";
import { Schema } from "effect";

/** Stable name of an external integration, independent of its providers. */
export const IntegrationID = Schema.String.pipe(Schema.brand("Integration.ID"));
export type IntegrationID = typeof IntegrationID.Type;

/** Identifies one OAuth method within an integration. */
export const MethodID = Schema.String.pipe(
  Schema.brand("Integration.MethodID"),
);
export type MethodID = typeof MethodID.Type;

/** Identifies one pending or recently completed OAuth attempt. */
export const OAuthAttemptID = defineId("con", "Integration.AttemptID");
export type OAuthAttemptID = typeof OAuthAttemptID.Type;
