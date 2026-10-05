// Purpose: Map Drawing Resource reads and writes through the caller's transaction.
import type { ListFilter } from "@openchart/server/lib/resource/list-schema";
import { ResourceStateInvalid } from "@openchart/server/lib/resource/errors";
import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import type {
  Row,
  Store,
  StoreBody,
} from "@openchart/server/lib/resource/store";
import { and, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Option } from "effect";
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError";

import type { DrawingEntity } from "./entity";
import { drawingTable } from "./schema";

function toRow(row: typeof drawingTable.$inferSelect): Row {
  const { id, revision, createdAt, updatedAt, ...body } = row;
  return { id, revision, createdAt, updatedAt, body };
}

function writeError(error: SqlError | EffectDrizzleQueryError) {
  const wrapped =
    error._tag === "EffectDrizzleQueryError" ? error.cause : error;
  const cause = Cause.isCause(wrapped)
    ? Option.getOrUndefined(Cause.findErrorOption(wrapped))
    : wrapped;
  if (
    isSqlError(cause) &&
    cause.reason._tag === "UniqueViolation" &&
    cause.reason.constraint === "index 'drawing_scope_gesture_unique'"
  ) {
    const reason =
      "Drawing data.id must be unique within its dashboard, provider and listing (symbol, venue, currency). Update the existing Drawing Resource or choose a new data.id.";
    return new ResourceStateInvalid({
      resource: "drawing",
      reason,
      issues: [
        { code: "drawing.unique_identity", path: "/data/id", message: reason },
      ],
    });
  }
  return error;
}

/** Transaction-bound CRUD; the Resource framework owns validation, revisions and commit events. */
export const drawingStore: Store<
  StoreBody<typeof DrawingEntity>,
  ListFilter<typeof DrawingEntity>
> = {
  load: (tx, id) =>
    tx
      .select()
      .from(drawingTable)
      .where(eq(drawingTable.id, id))
      .get()
      .pipe(Effect.map((row) => (row ? toRow(row) : undefined))),
  list: (tx, filter, window) => {
    const page = listWindowSql(drawingTable, window);
    return tx
      .select()
      .from(drawingTable)
      .where(
        and(
          page.where,
          filter.dashboardId === undefined
            ? undefined
            : eq(drawingTable.dashboardId, filter.dashboardId),
          filter.provider === undefined
            ? undefined
            : eq(drawingTable.provider, filter.provider),
        ),
      )
      .orderBy(...page.orderBy)
      .limit(page.limit)
      .pipe(Effect.map((rows) => rows.map(toRow)));
  },
  insert: (tx, input) =>
    tx
      .insert(drawingTable)
      .values({ id: input.id, revision: input.revision, ...input.body })
      .returning()
      .get()
      .pipe(
        Effect.mapError(writeError),
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toRow(row))
            : Effect.die("Drawing insert returned no row"),
        ),
      ),
  save: (tx, id, input) =>
    tx
      .update(drawingTable)
      .set({ revision: input.revision, ...input.body })
      .where(eq(drawingTable.id, id))
      .returning()
      .get()
      .pipe(
        Effect.mapError(writeError),
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toRow(row))
            : Effect.die("Drawing save returned no row"),
        ),
      ),
  remove: (tx, id) =>
    tx.delete(drawingTable).where(eq(drawingTable.id, id)).pipe(Effect.asVoid),
};
