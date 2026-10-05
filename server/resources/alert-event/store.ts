// Purpose: Persists backend-authored Alert Events and lists them by Rule through the caller's transaction.

import type { ListFilter } from "@openchart/server/lib/resource/list-schema";
import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import type {
  Row,
  Store,
  StoreBody,
} from "@openchart/server/lib/resource/store";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { AlertEventEntity } from "./entity";
import { alertEvents } from "./schema";

function toRow(row: typeof alertEvents.$inferSelect): Row {
  const { id, revision, createdAt, updatedAt, ...body } = row;
  return { id, revision, createdAt, updatedAt, body };
}

/** Full backend CRUD; the read-only API never narrows this Store. */
export const alertEventStore: Store<
  StoreBody<typeof AlertEventEntity>,
  ListFilter<typeof AlertEventEntity>
> = {
  load: (tx, id) =>
    tx
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.id, id))
      .get()
      .pipe(Effect.map((row) => (row ? toRow(row) : undefined))),
  list: (tx, filter, window) => {
    const page = listWindowSql(alertEvents, window);
    return tx
      .select()
      .from(alertEvents)
      .where(
        and(
          page.where,
          filter.ruleId === undefined
            ? undefined
            : eq(alertEvents.ruleId, filter.ruleId),
        ),
      )
      .orderBy(...page.orderBy)
      .limit(page.limit)
      .pipe(Effect.map((rows) => rows.map(toRow)));
  },
  insert: (tx, input) =>
    Effect.gen(function* () {
      // Every field is server-managed, so the client-writable body is empty.
      if (!("ruleId" in input.body)) {
        return yield* Effect.die(
          "Alert event creation requires the complete backend body",
        );
      }
      const row = yield* tx
        .insert(alertEvents)
        .values({
          id: input.id,
          revision: input.revision,
          ruleId: input.body.ruleId,
          condition: input.body.condition,
          time: input.body.time,
          detail: input.body.detail,
        })
        .returning()
        .get();
      if (!row) return yield* Effect.die("Alert event insert returned no row");
      return toRow(row);
    }),
  save: (tx, id, input) =>
    tx
      .update(alertEvents)
      .set({ revision: input.revision, ...input.body })
      .where(eq(alertEvents.id, id))
      .returning()
      .get()
      .pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toRow(row))
            : Effect.die("Alert event save returned no row"),
        ),
      ),
  remove: (tx, id) =>
    tx.delete(alertEvents).where(eq(alertEvents.id, id)).pipe(Effect.asVoid),
};
