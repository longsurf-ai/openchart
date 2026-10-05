// Purpose: Maps Trigger Resource reads and writes through the caller's transaction.

import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import type {
  Row,
  Store,
  StoreBody,
} from "@openchart/server/lib/resource/store";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import type { TriggerEntity } from "./entity";
import { triggers } from "./schema";

function toRow(row: typeof triggers.$inferSelect): Row {
  const { id, revision, createdAt, updatedAt, ...body } = row;
  return { id, revision, createdAt, updatedAt, body };
}

/** Transaction-bound CRUD; the Resource framework owns validation, revisions and commit events. */
export const triggerStore: Store<StoreBody<typeof TriggerEntity>> = {
  load: (tx, id) =>
    tx
      .select()
      .from(triggers)
      .where(eq(triggers.id, id))
      .get()
      .pipe(Effect.map((row) => (row ? toRow(row) : undefined))),
  list: (tx, _filter, window) => {
    const page = listWindowSql(triggers, window);
    return tx
      .select()
      .from(triggers)
      .where(page.where)
      .orderBy(...page.orderBy)
      .limit(page.limit)
      .pipe(Effect.map((rows) => rows.map(toRow)));
  },
  insert: (tx, input) =>
    tx
      .insert(triggers)
      .values({ id: input.id, revision: input.revision, ...input.body })
      .returning()
      .get()
      .pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toRow(row))
            : Effect.die("Trigger insert returned no row"),
        ),
      ),
  save: (tx, id, input) =>
    tx
      .update(triggers)
      .set({ revision: input.revision, ...input.body })
      .where(eq(triggers.id, id))
      .returning()
      .get()
      .pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toRow(row))
            : Effect.die("Trigger save returned no row"),
        ),
      ),
  remove: (tx, id) =>
    tx.delete(triggers).where(eq(triggers.id, id)).pipe(Effect.asVoid),
};
