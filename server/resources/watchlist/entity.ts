// Purpose: Derives the watchlist entity and its recursive section tree, and validates column, section, and listing identity.

import { defineId } from "@openchart/identifier";
import { ProviderListing, providerListingKey } from "@openchart/market";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import {
  type InvariantContext,
  withInvariants,
} from "@openchart/server/lib/resource/invariant";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Effect, Schema } from "effect";

import { WatchlistColumn } from "./column";
import {
  WATCHLIST_NAME_MAX_LENGTH,
  WATCHLIST_NAME_MIN_LENGTH,
  watchlistItemTable,
  watchlistSectionTable,
  watchlistTable,
} from "./schema";

export { WatchlistColumn, WatchlistColumnId, WatchlistMetric } from "./column";

/** Identifier of a watchlist, with the `wtl_` prefix. */
export const WatchlistId = defineId("wtl", "Watchlist.ID");

/** Identifier of a watchlist. */
export type WatchlistId = typeof WatchlistId.Type;

/** Identifier of a section inside a watchlist, with the `wsc_` prefix. */
export const WatchlistSectionId = defineId("wsc", "WatchlistSection.ID");

/** Identifier of a listing row inside a watchlist, with the `wit_` prefix. */
export const WatchlistItemId = defineId("wit", "WatchlistItem.ID");

const watchlistColumns = createSelectSchema(watchlistTable, {
  columns: Schema.Array(WatchlistColumn),
});
const sectionColumns = createSelectSchema(watchlistSectionTable, {
  id: WatchlistSectionId,
  name: (schema) =>
    schema.check(
      Schema.isMinLength(WATCHLIST_NAME_MIN_LENGTH),
      Schema.isMaxLength(WATCHLIST_NAME_MAX_LENGTH),
    ),
});
const itemColumns = createSelectSchema(watchlistItemTable, {
  id: WatchlistItemId,
  ...ProviderListing.fields,
});

/** One provider-scoped listing row; its column values come from Feed. */
export const WatchlistItem = Schema.Struct({
  id: itemColumns.fields.id,
  provider: itemColumns.fields.provider,
  listing: itemColumns.fields.listing,
});

/** One listing row inside a watchlist section. */
export type WatchlistItem = typeof WatchlistItem.Type;

/** One section inside the watchlist entity, without its own revision. */
export type WatchlistSection = {
  readonly id: typeof WatchlistSectionId.Type;
  readonly name?: string;
  readonly items: ReadonlyArray<WatchlistItem>;
  readonly sections: ReadonlyArray<WatchlistSection>;
};

/** A section as JSON. */
export type WatchlistSectionEncoded = {
  readonly id: typeof WatchlistSectionId.Encoded;
  readonly name?: string;
  readonly items: ReadonlyArray<typeof WatchlistItem.Encoded>;
  readonly sections: ReadonlyArray<WatchlistSectionEncoded>;
};

/**
 * A run of rows that may contain child sections to any depth. Rows and child
 * sections are ordered by array order. Sections carry no columns or collapse
 * state; an omitted name is a section shown without a heading. Both arrays
 * are required: a codec such as a decoding default inside the recursion would
 * stop Effect from documenting the write schema as JSON Schema for the Agent.
 */
export const WatchlistSection: Schema.Codec<
  WatchlistSection,
  WatchlistSectionEncoded
> = Schema.Struct({
  id: sectionColumns.fields.id,
  // NULL in storage is represented by an omitted name in the entity.
  name: Schema.optionalKey(sectionColumns.fields.name.members[0]),
  items: Schema.Array(WatchlistItem),
  sections: Schema.Array(Schema.suspend(() => WatchlistSection)),
}).annotate({ identifier: "WatchlistSection" });

// Visits every section depth-first with its scoped diagnostic context.
function eachSection(
  sections: ReadonlyArray<WatchlistSection>,
  scope: (index: number) => InvariantContext<WatchlistSection>,
  visit: (
    section: WatchlistSection,
    context: InvariantContext<WatchlistSection>,
  ) => void,
): void {
  sections.forEach((section, s) => {
    const context = scope(s);
    visit(section, context);
    eachSection(section.sections, (i) => context.at(["sections", i]), visit);
  });
}

/**
 * The complete watchlist with one server-managed envelope. Columns, sections,
 * and items default to empty collections, and an empty watchlist is valid.
 * Sections nest to any depth. Each listing appears at most once across the
 * whole tree. Moving a row or a section with its subtree is one RFC 6902 `move`.
 *
 * @example
 * ```ts
 * Schema.decodeUnknownSync(WatchlistEntity)({
 *   ...envelope,
 *   name: "Tech",
 *   columns: [{ id: "wcl_…", metric: { kind: "changePercent" } }],
 *   sections: [{
 *     id: "wsc_a",
 *     name: "Crypto",
 *     items: [{ id: "wit_…", provider: "binance", listing: { symbol: "BTCUSDT", currency: "USDT" } }],
 *     sections: [{ id: "wsc_b", name: "Layer 2" }],
 *   }],
 * });
 * ```
 */
export const WatchlistEntity = withInvariants(
  Schema.Struct({
    ...envelopeFields(WatchlistId),
    name: watchlistColumns.fields.name.check(
      Schema.isMinLength(WATCHLIST_NAME_MIN_LENGTH),
      Schema.isMaxLength(WATCHLIST_NAME_MAX_LENGTH),
    ),
    columns: watchlistColumns.fields.columns.pipe(
      Schema.withDecodingDefault(
        Effect.succeed(
          Schema.decodeUnknownSync(watchlistColumns.fields.columns)(
            watchlistTable.columns.default,
          ),
        ),
      ),
    ),
    sections: Schema.Array(WatchlistSection).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
  }),
  (invariant) => [
    invariant(
      "Column, section, and item ids must be unique within the watchlist",
      (watchlist, { expect, at }) => {
        const columns = new Set<string>();
        const sections = new Set<string>();
        const items = new Set<string>();
        watchlist.columns.forEach((column, c) => {
          expect(columns.has(column.id), { path: ["columns", c, "id"] }).toBe(
            false,
          );
          columns.add(column.id);
        });
        eachSection(
          watchlist.sections,
          (s) => at(["sections", s]),
          (section, context) => {
            context
              .expect(sections.has(section.id), { path: ["id"] })
              .toBe(false);
            sections.add(section.id);
            section.items.forEach((item, i) => {
              context
                .expect(items.has(item.id), { path: ["items", i, "id"] })
                .toBe(false);
              items.add(item.id);
            });
          },
        );
      },
      { code: "watchlist.unique_ids" },
    ),
    invariant(
      "Each metric may appear at most once per watchlist",
      (watchlist, { expect }) => {
        const shown = new Set<string>();
        watchlist.columns.forEach((column, c) => {
          expect(shown.has(column.metric.kind), {
            path: ["columns", c, "metric", "kind"],
          }).toBe(false);
          shown.add(column.metric.kind);
        });
      },
      { code: "watchlist.unique_column" },
    ),
    invariant(
      "A listing may appear at most once per watchlist",
      (watchlist, { at }) => {
        const listings = new Set<string>();
        eachSection(
          watchlist.sections,
          (s) => at(["sections", s]),
          (section, context) =>
            section.items.forEach((item, i) => {
              const key = providerListingKey(item);
              context
                .expect(listings.has(key), { path: ["items", i, "listing"] })
                .toBe(false);
              listings.add(key);
            }),
        );
      },
      { code: "watchlist.unique_listing" },
    ),
  ],
);

/** The full watchlist returned by Resource reads. */
export type WatchlistEntity = typeof WatchlistEntity.Type;
