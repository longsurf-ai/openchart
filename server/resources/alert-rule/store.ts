// Purpose: Maps Alert Rule Resource reads and writes through the caller's transaction.

import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import { ResourceStateInvalid } from "@openchart/server/lib/resource/errors";
import type {
  Row,
  Store,
  StoreBody,
} from "@openchart/server/lib/resource/store";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import type { AlertRuleEntity } from "./entity";
import { alertRules } from "./schema";

function toRow(row: typeof alertRules.$inferSelect): Row {
  const { id, revision, createdAt, updatedAt, ...body } = row;
  return { id, revision, createdAt, updatedAt, body };
}

/** Transaction-bound CRUD; the Resource framework owns validation, revisions and commit events. */
export const alertRuleStore: Store<StoreBody<typeof AlertRuleEntity>> = {
  load: (tx, id) =>
    tx
      .select()
      .from(alertRules)
      .where(eq(alertRules.id, id))
      .get()
      .pipe(Effect.map((row) => (row ? toRow(row) : undefined))),
  list: (tx, _filter, window) => {
    const page = listWindowSql(alertRules, window);
    return tx
      .select()
      .from(alertRules)
      .where(page.where)
      .orderBy(...page.orderBy)
      .limit(page.limit)
      .pipe(Effect.map((rows) => rows.map(toRow)));
  },
  insert: (tx, input) =>
    Effect.gen(function* () {
      if (!("alertable" in input.body))
        return yield* new ResourceStateInvalid({
          resource: "alert_rule",
          reason:
            "Create Alert Rules through save so their definition is validated.",
          issues: [
            {
              code: "alert_rule.definition_required",
              path: "/alertable",
              message: "Use alert_rule.save or the save_alert_rule tool.",
            },
          ],
        });
      const row = yield* tx
        .insert(alertRules)
        .values({ id: input.id, revision: input.revision, ...input.body })
        .returning()
        .get();
      if (!row) return yield* Effect.die("Alert rule insert returned no row");
      return toRow(row);
    }),
  save: (tx, id, input) =>
    tx
      .update(alertRules)
      .set({ revision: input.revision, ...input.body })
      .where(eq(alertRules.id, id))
      .returning()
      .get()
      .pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toRow(row))
            : Effect.die("Alert rule save returned no row"),
        ),
      ),
  remove: (tx, id) =>
    tx.delete(alertRules).where(eq(alertRules.id, id)).pipe(Effect.asVoid),
};
