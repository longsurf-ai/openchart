// Purpose: Persist and query saved listings exclusively through caller transactions.
import { Listing, type ProviderListing } from "@openchart/market";
import type { SymbolSearchRequest, SymbolIndexRequest } from "@openchart/feed";
import type { ListFilter } from "@openchart/server/lib/resource/list-schema";
import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import type {
  Row,
  Store,
  StoreBody,
  Tx,
} from "@openchart/server/lib/resource/store";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SymbologyEntity, SymbologyId } from "./entity";
import { symbologyTable as table } from "./schema";

function toRow(row: typeof table.$inferSelect): Row {
  const { id, revision, createdAt, updatedAt, provider, listing } = row;
  const body = { provider, listing };
  return { id, revision, createdAt, updatedAt, body };
}
const written = (row: typeof table.$inferSelect | undefined) =>
  row
    ? Effect.succeed(toRow(row))
    : Effect.die("Symbology write returned no row");
const sameListing = Schema.toEquivalence(Listing);
const key = (listing: Listing) =>
  JSON.stringify([listing.symbol, listing.venue ?? null]);

/** Framework CRUD remains complete internally; readOnly controls the public surface. */
export const symbologyStore: Store<
  StoreBody<typeof SymbologyEntity>,
  ListFilter<typeof SymbologyEntity>
> = {
  load: (tx, id) =>
    tx
      .select()
      .from(table)
      .where(eq(table.id, id))
      .get()
      .pipe(Effect.map((row) => (row ? toRow(row) : undefined))),
  list: (tx, filter, window) => {
    const page = listWindowSql(table, window);
    return tx
      .select()
      .from(table)
      .where(
        and(
          page.where,
          filter.provider === undefined
            ? undefined
            : eq(table.provider, filter.provider),
        ),
      )
      .orderBy(...page.orderBy)
      .limit(page.limit)
      .pipe(Effect.map((rows) => rows.map(toRow)));
  },
  insert: (tx, input) =>
    tx
      .insert(table)
      .values({ id: input.id, revision: input.revision, ...input.body })
      .returning()
      .get()
      .pipe(Effect.flatMap(written)),
  save: (tx, id, input) =>
    tx
      .update(table)
      .set({ revision: input.revision, ...input.body })
      .where(eq(table.id, id))
      .returning()
      .get()
      .pipe(Effect.flatMap(written)),
  remove: (tx, id) =>
    tx.delete(table).where(eq(table.id, id)).pipe(Effect.asVoid),
};

/** Read matching rows; Feed supplies currently available providers. @example searchListings(tx, request, ['binance']); */
export function searchListings(
  tx: Tx,
  request: SymbolSearchRequest,
  providers: readonly string[],
) {
  if (providers.length === 0) return Effect.succeed([] as Row[]);
  const text = request.query.trim().toLowerCase();
  // ponytail: substring scans selected providers; add a trigram index if larger catalogs make search slow.
  return tx
    .select()
    .from(table)
    .where(
      and(
        inArray(table.provider, [...providers]),
        sql`(instr(lower(json_extract(${table.listing}, '$.symbol')), ${text}) > 0 OR instr(lower(coalesce(json_extract(${table.listing}, '$.name'), '')), ${text}) > 0)`,
        request.assetClass === undefined
          ? undefined
          : sql`json_extract(${table.listing}, '$.class') = ${request.assetClass}`,
      ),
    )
    .pipe(Effect.map((rows) => rows.map(toRow)));
}

/** Counts committed listings, regardless of provider availability. @example countListings(tx); */
export function countListings(tx: Tx) {
  return tx
    .select({ provider: table.provider, count: sql<number>`count(*)` })
    .from(table)
    .groupBy(table.provider);
}

/** Upsert observations or atomically reconcile a complete scope. Caller owns transaction. @example writeListings(tx, hits); */
export const writeListings = Effect.fn("Symbology.writeListings")(function* (
  tx: Tx,
  hits: readonly ProviderListing[],
  scope?: SymbolIndexRequest,
) {
  const providers = scope
    ? [scope.providerId]
    : [...new Set(hits.map((hit) => hit.provider))];
  if (providers.length === 0) return 0;
  const existing = yield* tx
    .select()
    .from(table)
    .where(inArray(table.provider, providers));
  const identities = new Map(
    existing.map((row) => [
      JSON.stringify([row.provider, row.listingKey]),
      row,
    ]),
  );
  const seen = new Set<string>();
  for (const hit of hits) {
    if (
      scope &&
      (hit.provider !== scope.providerId ||
        (scope.filter.quoteAsset !== undefined &&
          hit.listing.currency !== scope.filter.quoteAsset))
    )
      return yield* Effect.die(
        "Symbology snapshot contains an out-of-scope listing",
      );
    const identity = JSON.stringify([hit.provider, key(hit.listing)]);
    if (seen.has(identity))
      return yield* Effect.die(
        "Symbology source returned duplicate identities",
      );
    seen.add(identity);
    const previous = identities.get(identity);
    if (!previous)
      yield* symbologyStore.insert(tx, {
        id: SymbologyId.create(),
        revision: 1,
        body: hit,
      });
    else if (!sameListing(previous.listing, hit.listing))
      yield* symbologyStore.save(tx, previous.id, {
        revision: previous.revision + 1,
        body: hit,
      });
  }
  if (scope)
    for (const row of existing) {
      if (
        (scope.filter.quoteAsset === undefined ||
          row.listing.currency === scope.filter.quoteAsset) &&
        !seen.has(JSON.stringify([row.provider, row.listingKey]))
      )
        yield* symbologyStore.remove(tx, row.id);
    }
  return seen.size;
});
