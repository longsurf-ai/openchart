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

// Client writes omit the managed approval; Drizzle skips absent keys, so saves
// keep it and inserts store NULL. Only the approve transition supplies it.
function toColumns({ source, time, ...body }: Body) {
  return {
    ...body,
    workspaceId: source.workspaceId,
    path: source.path,
    timeColumn: time.column,
  };
}

/** Transaction-bound CRUD; the Resource framework owns validation, revisions and commit events. */
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
    tx
      .update(workspaceDatasetTable)
      .set({ revision: input.revision, ...toColumns(input.body) })
      .where(eq(workspaceDatasetTable.id, id))
      .returning()
      .get()
      .pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toRow(row))
            : Effect.die("Workspace Dataset save returned no row"),
        ),
      ),
  remove: (tx, id) =>
    tx
      .delete(workspaceDatasetTable)
      .where(eq(workspaceDatasetTable.id, id))
      .pipe(Effect.asVoid),
};
