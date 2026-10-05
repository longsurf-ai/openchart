// Purpose: Map Indicator Resource reads and writes through the caller's transaction.
import type { ListFilter } from "@openchart/server/lib/resource/list-schema";
import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import type {
  Row,
  Store,
  StoreBody,
} from "@openchart/server/lib/resource/store";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { IndicatorEntity } from "./entity";
import { indicatorTable } from "./schema";

type Body = StoreBody<typeof IndicatorEntity>;

function toRow(row: typeof indicatorTable.$inferSelect): Row {
  const {
    id,
    revision,
    createdAt,
    updatedAt,
    workspaceId,
    scriptPath,
    ...rest
  } = row;
  return {
    id,
    revision,
    createdAt,
    updatedAt,
    body: { ...rest, source: { workspaceId, path: scriptPath } },
  };
}

function toColumns({ source, ...body }: Body) {
  return { ...body, workspaceId: source.workspaceId, scriptPath: source.path };
}

/** Transaction-bound CRUD; the Resource framework owns validation, revisions and commit events. */
export const indicatorStore: Store<Body, ListFilter<typeof IndicatorEntity>> = {
  load: (tx, id) =>
    tx
      .select()
      .from(indicatorTable)
      .where(eq(indicatorTable.id, id))
      .get()
      .pipe(Effect.map((row) => (row ? toRow(row) : undefined))),
  list: (tx, filter, window) => {
    const page = listWindowSql(indicatorTable, window);
    return tx
      .select()
      .from(indicatorTable)
      .where(
        and(
          page.where,
          filter.chartId === undefined
            ? undefined
            : eq(indicatorTable.chartId, filter.chartId),
        ),
      )
      .orderBy(...page.orderBy)
      .limit(page.limit)
      .pipe(Effect.map((rows) => rows.map(toRow)));
  },
  insert: (tx, input) =>
    tx
      .insert(indicatorTable)
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
            : Effect.die("Indicator insert returned no row"),
        ),
      ),
  save: (tx, id, input) =>
    tx
      .update(indicatorTable)
      .set({ revision: input.revision, ...toColumns(input.body) })
      .where(eq(indicatorTable.id, id))
      .returning()
      .get()
      .pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toRow(row))
            : Effect.die("Indicator save returned no row"),
        ),
      ),
  remove: (tx, id) =>
    tx
      .delete(indicatorTable)
      .where(eq(indicatorTable.id, id))
      .pipe(Effect.asVoid),
};
