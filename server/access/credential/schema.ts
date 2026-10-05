// Purpose: Defines internal credential storage with millisecond timestamps.

import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { Credential } from "./credential";

/** Internal credential storage, without a public Resource envelope or events. */
export const CredentialTable = sqliteTable(
  "credential",
  {
    id: text().$type<Credential.ID>().primaryKey(),
    integration_id: text().$type<Credential.Info["integrationID"]>(),
    label: text().notNull(),
    /** Host-encrypted complete Credential.Value, including metadata. */
    value: text().notNull(),
    connector_id: text(),
    method_id: text(),
    /** Local permission to use this credential; independent of remote validity. */
    active: integer({ mode: "boolean" }).notNull().default(true),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$onUpdate(() => Date.now()),
  },
  (table) => [
    check("credential_active_boolean", sql`${table.active} IN (0, 1)`),
  ],
);
