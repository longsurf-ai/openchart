// Purpose: Own the durable provider-scoped listing index.
import type { Listing } from "@openchart/market";
import { listingKeySql } from "@openchart/server/lib/listing-key";
import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** One saved listing per provider/native ID, or symbol/venue when no ID exists. */
export const symbologyTable = sqliteTable(
  "symbology",
  {
    ...resourceEnvelopeColumns(),
    provider: text("provider").notNull(),
    listing: text("listing", { mode: "json" }).$type<Listing>().notNull(),
    listingKey: text("listing_key")
      .notNull()
      .generatedAlwaysAs(listingKeySql(sql`listing`), { mode: "stored" }),
  },
  (table) => [
    ...resourceEnvelopeChecks("symbology", table),
    check("symbology_provider_check", sql`length(${table.provider}) > 0`),
    check(
      "symbology_listing_check",
      sql`json_valid(${table.listing}) AND json_type(${table.listing}) = 'object'`,
    ),
    uniqueIndex("symbology_provider_listing_unique").on(
      table.provider,
      table.listingKey,
    ),
    index("symbology_created_id_index").on(table.createdAt, table.id),
  ],
);
