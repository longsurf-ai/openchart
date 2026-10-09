// Purpose: Owns the watchlist tables: columns and nested sections of provider-scoped listings.

import type { Listing } from "@openchart/market";
import { listingKeySql } from "@openchart/server/lib/listing-key";
import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { WatchlistColumn } from "./column";

/** Minimum persisted length of watchlist and section names. */
export const WATCHLIST_NAME_MIN_LENGTH = 1;

/** Maximum persisted length of watchlist and section names. */
export const WATCHLIST_NAME_MAX_LENGTH = 200;

function orderedChildChecks(
  name: string,
  table: { id: AnySQLiteColumn; position: AnySQLiteColumn },
) {
  return [
    // Drizzle Kit omits NOT NULL on SQLite text primary keys.
    check(
      `${name}_id_check`,
      sql`${table.id} IS NOT NULL AND length(${table.id}) > 0`,
    ),
    check(
      `${name}_position_check`,
      sql`typeof(${table.position}) = 'integer' AND ${table.position} >= 0`,
    ),
  ];
}

/**
 * One independent watchlist. Dashboards place it by reference and never own
 * it. Only this table carries an envelope; column, section, and item writes
 * share its revision. Columns are what the watchlist tracks; column widths,
 * sorting, and collapsed sections are frontend view state. Market values come
 * from Feed and are never stored.
 *
 * @see [Resource ownership](../../../docs/architecture/resource.md)
 */
export const watchlistTable = sqliteTable(
  "watchlist",
  {
    ...resourceEnvelopeColumns(),
    name: text("name").notNull(),
    columns: text("columns", { mode: "json" })
      .$type<readonly WatchlistColumn[]>()
      .notNull()
      .default([]),
  },
  (table) => [
    ...resourceEnvelopeChecks("watchlist", table),
    check(
      "watchlist_name_check",
      sql`length(${table.name}) BETWEEN ${WATCHLIST_NAME_MIN_LENGTH} AND ${WATCHLIST_NAME_MAX_LENGTH}`.inlineParams(),
    ),
  ],
);

/**
 * The watchlist's section tree, one row per section. A NULL parentSectionId
 * marks a root section; positions are unique among siblings. A NULL name is a
 * section shown without a heading. Sections share the watchlist's columns
 * and revision. Deleting a section deletes its descendants and their items.
 * The Store writes rows from the entity's nesting, so ancestor cycles cannot
 * be written; the database also rejects direct self-parenting.
 */
export const watchlistSectionTable = sqliteTable(
  "watchlist_section",
  {
    id: text("id").primaryKey().notNull(),
    watchlistId: text("watchlist_id")
      .notNull()
      .references(() => watchlistTable.id, { onDelete: "cascade" }),

    // When parentSectionId is NULL, the section is a root section, and its position

    parentSectionId: text("parent_section_id"),
    position: integer("position").notNull(),
    name: text("name"),
  },
  (table) => [
    ...orderedChildChecks("watchlist_section", table),
    check(
      "watchlist_section_name_check",
      sql`${table.name} IS NULL OR length(${table.name}) BETWEEN ${WATCHLIST_NAME_MIN_LENGTH} AND ${WATCHLIST_NAME_MAX_LENGTH}`.inlineParams(),
    ),
    check(
      "watchlist_section_parent_check",
      sql`${table.parentSectionId} IS NULL OR ${table.parentSectionId} != ${table.id}`,
    ),
    // SQLite treats NULLs as distinct, so roots need their own unique index.
    uniqueIndex("watchlist_section_root_position_unique")
      .on(table.watchlistId, table.position)
      .where(sql`${table.parentSectionId} IS NULL`),
    uniqueIndex("watchlist_section_child_position_unique")
      .on(table.watchlistId, table.parentSectionId, table.position)
      .where(sql`${table.parentSectionId} IS NOT NULL`),
    // Composite FKs keep parent sections and items in the same watchlist.
    unique("watchlist_section_watchlist_id_unique").on(
      table.watchlistId,
      table.id,
    ),
    foreignKey({
      name: "watchlist_section_parent_fk",
      columns: [table.watchlistId, table.parentSectionId],
      foreignColumns: [table.watchlistId, table.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Ordered listings inside a section. Listing identity is scoped to its
 * provider, as in Chart market sources and Drawings, with no application FK.
 *
 * @agent invariant: A listing appears at most once per watchlist, across all
 * sections, so a section partitions rows rather than tagging them. Identity
 * follows `providerListingKey`: a native ID, otherwise symbol and venue.
 */
export const watchlistItemTable = sqliteTable(
  "watchlist_item",
  {
    id: text("id").primaryKey().notNull(),
    watchlistId: text("watchlist_id").notNull(),
    sectionId: text("section_id").notNull(),
    position: integer("position").notNull(),
    provider: text("provider").notNull(),
    listing: text("listing", { mode: "json" }).$type<Listing>().notNull(),
  },
  (table) => [
    ...orderedChildChecks("watchlist_item", table),
    unique("watchlist_item_position_unique").on(
      table.sectionId,
      table.position,
    ),
    uniqueIndex("watchlist_item_listing_unique").on(
      table.watchlistId,
      table.provider,
      listingKeySql(table.listing),
    ),
    foreignKey({
      name: "watchlist_item_section_fk",
      columns: [table.watchlistId, table.sectionId],
      foreignColumns: [
        watchlistSectionTable.watchlistId,
        watchlistSectionTable.id,
      ],
    }).onDelete("cascade"),
    check("watchlist_item_provider_check", sql`length(${table.provider}) > 0`),
    check(
      "watchlist_item_listing_check",
      sql`COALESCE(
        json_type(${table.listing}) = 'object'
        AND json_type(${table.listing}, '$.symbol') = 'text'
        AND json_type(${table.listing}, '$.currency') = 'text',
        0
      )`,
    ),
  ],
);
