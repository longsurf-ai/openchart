// Purpose: Map Workspace Dataset Resource reads and writes through the caller's transaction.
import type { ListFilter } from "@openchart/server/lib/resource/list-schema";
import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import type {
  Row,
  Store,
  StoreBody,
} from "@openchart/server/lib/resource/store";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import type { WorkspaceDatasetEntity } from "./entity";
import { workspaceDatasetTable } from "./schema";

type Body = StoreBody<typeof WorkspaceDatasetEntity>;

function toRow(row: typeof workspaceDatasetTable.$inferSelect): Row {
  const {
    id,
    revision,
    createdAt,
    updatedAt,
    workspaceId,
    path,
    timeColumn,
    ...rest
  } = row;
  return {
    id,
    revision,
    createdAt,
    updatedAt,
    body: {
      ...rest,
      source: { workspaceId, path },
      time: { column: timeColumn },
    },
  };
}

// Client writes omit approval; metadata saves preserve it and inserts store NULL.
function toColumns({ source, time, ...body }: Body) {
  return {
    ...body,
    workspaceId: source.workspaceId,
    path: source.path,
    timeColumn: time.column,
  };
}

function scriptExecution(
  source: { workspaceId: string; path: string },
  collection: Body["collection"],
) {
  return collection?.kind === "script"
    ? JSON.stringify([
        source.workspaceId,
        source.path,
        collection.path,
        collection.args ?? [],
      ])
    : null;
}

/**
 * Transaction-bound CRUD. Saves clear script approval when its arguments,
 * script path, output path, Workspace or collection kind changes; metadata
 * edits preserve approval. The explicit approval transition supplies a hash
 * only at the reviewed revision. The Resource framework owns validation,
 * revisions and commit events; database failures propagate to its transaction.
 * @example yield* workspaceDatasetStore.save(tx, id, write);
 */
export const workspaceDatasetStore: Store<
  Body,
  ListFilter<typeof WorkspaceDatasetEntity>
> = {
  load: (tx, id) =>
    tx
      .select()
      .from(workspaceDatasetTable)
      .where(eq(workspaceDatasetTable.id, id))
      .get()
      .pipe(Effect.map((row) => (row ? toRow(row) : undefined))),
  list: (tx, _filter, window) => {
    const page = listWindowSql(workspaceDatasetTable, window);
    return tx
      .select()
      .from(workspaceDatasetTable)
      .where(page.where)
      .orderBy(...page.orderBy)
      .limit(page.limit)
      .pipe(Effect.map((rows) => rows.map(toRow)));
  },
  insert: (tx, input) =>
    tx
      .insert(workspaceDatasetTable)
      .values({
        id: input.id,
        revision: input.revision,
        ...toColumns(input.body),
      })
      .returning()
      .get()
      .pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toRow(row))
            : Effect.die("Workspace Dataset insert returned no row"),
        ),
      ),
  save: (tx, id, input) =>
    Effect.gen(function* () {
      const previous = yield* tx
        .select()
        .from(workspaceDatasetTable)
        .where(eq(workspaceDatasetTable.id, id))
        .get();
      if (!previous)
        return yield* Effect.die("Workspace Dataset save found no row");
      const changed =
        scriptExecution(
          { workspaceId: previous.workspaceId, path: previous.path },
          previous.collection,
        ) !== scriptExecution(input.body.source, input.body.collection);
      const row = yield* tx
        .update(workspaceDatasetTable)
        .set({
          revision: input.revision,
          ...toColumns(input.body),
          ...(changed ? { approvedScriptHash: null } : {}),
        })
        .where(eq(workspaceDatasetTable.id, id))
        .returning()
        .get();
      if (!row)
        return yield* Effect.die("Workspace Dataset save returned no row");
      return toRow(row);
    }),
  remove: (tx, id) =>
    tx
      .delete(workspaceDatasetTable)
      .where(eq(workspaceDatasetTable.id, id))
      .pipe(Effect.asVoid),
};
