// Purpose: Project provider-native listing identity into SQLite constraints.
import { sql, type SQLWrapper } from "drizzle-orm";

/**
 * SQLite counterpart of common/market's providerListingKey, excluding the
 * separately indexed provider column. A native ID takes precedence over symbol
 * and venue; reference metadata is not identity. The caller supplies a valid
 * Listing JSON column and owns query execution and failures. No I/O occurs here.
 * @example uniqueIndex("listing_unique").on(table.provider, listingKeySql(table.listing));
 */
export function listingKeySql(listing: SQLWrapper) {
  return sql`case when json_extract(${listing}, '$.id') is not null then json_array(json_extract(${listing}, '$.id')) else json_array(json_extract(${listing}, '$.symbol'), json_extract(${listing}, '$.venue')) end`;
}
