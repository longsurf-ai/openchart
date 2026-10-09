// Purpose: Persists and assembles complete watchlists and their section trees within the Resource transaction.

import type {
  Row,
  Store,
  StoreBody,
  Tx,
} from "@openchart/server/lib/resource/store";
import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import { asc, eq, inArray } from "drizzle-orm";
import { Array as Arr, Effect } from "effect";

import type { WatchlistEntity } from "./entity";
import {
  watchlistItemTable,
  watchlistSectionTable,
  watchlistTable,
} from "./schema";

type WatchlistRow = typeof watchlistTable.$inferSelect;
type WatchlistWrite = StoreBody<typeof WatchlistEntity>;

function readRows(tx: Tx, roots: readonly WatchlistRow[]) {
  return Effect.gen(function* () {
    if (!roots.length) return [];
    const ids = roots.map((root) => root.id);
    const sections = yield* tx
      .select()
      .from(watchlistSectionTable)
      .where(inArray(watchlistSectionTable.watchlistId, ids))
      .orderBy(asc(watchlistSectionTable.position));
    const items = yield* tx
      .select()
      .from(watchlistItemTable)
      .where(inArray(watchlistItemTable.watchlistId, ids))
      .orderBy(asc(watchlistItemTable.position));
    // Top-level sections are children of their watchlist. Watchlist and
    // section ids never collide, so one map serves every level of every tree.
    const children = Arr.groupBy(
      sections,
      (row) => row.parentSectionId ?? row.watchlistId,
    );
    const rows = Arr.groupBy(items, (row) => row.sectionId);
    const tree = (sectionRows: typeof sections): unknown[] =>
      sectionRows.map((section) => ({
        id: section.id,
        ...(section.name === null ? {} : { name: section.name }),
        items: (rows[section.id] ?? []).map((item) => ({
          id: item.id,
          provider: item.provider,
          listing: item.listing,
        })),
        sections: tree(children[section.id] ?? []),
      }));
    return roots.map((root): Row => ({
      id: root.id,
      revision: root.revision,
      createdAt: root.createdAt,
      updatedAt: root.updatedAt,
      body: {
        name: root.name,
        columns: root.columns,
        sections: tree(children[root.id] ?? []),
      },
    }));
  });
}

function insertChildren(tx: Tx, watchlistId: string, body: WatchlistWrite) {
  return Effect.gen(function* () {
    const sections: Array<typeof watchlistSectionTable.$inferInsert> = [];
    const items: Array<typeof watchlistItemTable.$inferInsert> = [];
    // Depth-first order inserts every parent before its children.
    const flatten = (
      nodes: WatchlistWrite["sections"],
      parentSectionId: string | null,
    ): void =>
      nodes.forEach((section, position) => {
        sections.push({
          id: section.id,
          watchlistId,
          parentSectionId,
          position,
          name: section.name ?? null,
        });
        section.items.forEach((item, itemPosition) =>
          items.push({
            id: item.id,
            watchlistId,
            sectionId: section.id,
            position: itemPosition,
            provider: item.provider,
            listing: item.listing,
          }),
        );
        flatten(section.sections, section.id);
      });
    flatten(body.sections, null);
    if (sections.length)
      yield* tx.insert(watchlistSectionTable).values(sections);
    if (items.length) yield* tx.insert(watchlistItemTable).values(items);
  });
}

function readWritten(tx: Tx, root: WatchlistRow) {
  return readRows(tx, [root]).pipe(
    Effect.flatMap((rows) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.die("Watchlist assembly returned no row"),
    ),
  );
}

/**
 * Maps the watchlist, section, and item tables to one Resource. Sections
 * nest through `parentSectionId`, and every sibling list and row list keeps
 * its array order as `position`. List pages roots in SQL before batching child
 * reads. Save replaces the section tree with its supplied ids and order; the
 * section foreign keys cascade to descendants and items. All work uses the
 * caller's transaction, and every write returns the row as stored.
 */
export const watchlistStore: Store<WatchlistWrite> = {
  load: (tx, id) =>
    Effect.gen(function* () {
      const root = yield* tx
        .select()
        .from(watchlistTable)
        .where(eq(watchlistTable.id, id))
        .get();
      if (!root) return undefined;
      return yield* readWritten(tx, root);
    }),
  list: (tx, _filter, window) =>
    Effect.gen(function* () {
      const page = listWindowSql(watchlistTable, window);
      const roots = yield* tx
        .select()
        .from(watchlistTable)
        .where(page.where)
        .orderBy(...page.orderBy)
        .limit(page.limit);
      return yield* readRows(tx, roots);
    }),
  insert: (tx, input) =>
    Effect.gen(function* () {
      const root = yield* tx
        .insert(watchlistTable)
        .values({
          id: input.id,
          revision: input.revision,
          name: input.body.name,
          columns: input.body.columns,
        })
        .returning()
        .get();
      if (!root) return yield* Effect.die("Watchlist insert returned no row");
      yield* insertChildren(tx, root.id, input.body);
      return yield* readWritten(tx, root);
    }),
  save: (tx, id, input) =>
    Effect.gen(function* () {
      const root = yield* tx
        .update(watchlistTable)
        .set({
          revision: input.revision,
          name: input.body.name,
          columns: input.body.columns,
        })
        .where(eq(watchlistTable.id, id))
        .returning()
        .get();
      if (!root) return yield* Effect.die("Watchlist save returned no row");
      // Replacing within the transaction avoids transient position collisions
      // when an RFC 6902 move swaps sections or rows.
      yield* tx
        .delete(watchlistSectionTable)
        .where(eq(watchlistSectionTable.watchlistId, id));
      yield* insertChildren(tx, id, input.body);
      return yield* readWritten(tx, root);
    }),
  remove: (tx, id) =>
    tx
      .delete(watchlistTable)
      .where(eq(watchlistTable.id, id))
      .pipe(Effect.asVoid),
};
