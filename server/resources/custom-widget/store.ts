// Purpose: Map Custom Widget Resource reads and writes through the caller's transaction.
import { ResourceStateInvalid } from "@openchart/server/lib/resource/errors";
import type { ListFilter } from "@openchart/server/lib/resource/list-schema";
import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import type {
  Row,
  Store,
  StoreBody,
} from "@openchart/server/lib/resource/store";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { CustomWidgetEntity } from "./entity";
import { customWidgetTable } from "./schema";

type Body = StoreBody<typeof CustomWidgetEntity>;

function toRow(row: typeof customWidgetTable.$inferSelect): Row {
  const { id, revision, createdAt, updatedAt, workspaceId, path, ...rest } =
    row;
  return {
    id,
    revision,
    createdAt,
    updatedAt,
    body: { ...rest, source: { workspaceId, path } },
  };
}

function toColumns({ source, ...body }: Body) {
  return source
    ? { ...body, workspaceId: source.workspaceId, path: source.path }
    : body;
}

/** Transaction-bound CRUD; `save` is the only path that supplies a body, so intrinsic create is refused. */
export const customWidgetStore: Store<
  Body,
  ListFilter<typeof CustomWidgetEntity>
> = {
  load: (tx, id) =>
    tx
      .select()
      .from(customWidgetTable)
      .where(eq(customWidgetTable.id, id))
      .get()
      .pipe(Effect.map((row) => (row ? toRow(row) : undefined))),
  list: (tx, filter, window) => {
    const page = listWindowSql(customWidgetTable, window);
    return tx
      .select()
      .from(customWidgetTable)
      .where(
        and(
          page.where,
          filter.kind === undefined
            ? undefined
            : eq(customWidgetTable.kind, filter.kind),
        ),
      )
      .orderBy(...page.orderBy)
      .limit(page.limit)
      .pipe(Effect.map((rows) => rows.map(toRow)));
  },
  insert: (tx, input) =>
    Effect.gen(function* () {
      const { kind, title, source, snapshot } = input.body;
      if (
        kind === undefined ||
        title === undefined ||
        source === undefined ||
        snapshot === undefined
      )
        return yield* new ResourceStateInvalid({
          resource: "custom_widget",
          reason:
            "Use custom_widget.save or the save_widget tool, which checks the source before creating a widget.",
          issues: [
            {
              code: "custom_widget.save_required",
              path: "/snapshot",
              message: "Use custom_widget.save or the save_widget tool.",
            },
          ],
        });
      const row = yield* tx
        .insert(customWidgetTable)
        .values({
          id: input.id,
          revision: input.revision,
          kind,
          title,
          snapshot,
          workspaceId: source.workspaceId,
          path: source.path,
        })
        .returning()
        .get();
      if (!row)
        return yield* Effect.die("Custom widget insert returned no row");
      return toRow(row);
    }),
  save: (tx, id, input) =>
    tx
      .update(customWidgetTable)
      .set({ revision: input.revision, ...toColumns(input.body) })
      .where(eq(customWidgetTable.id, id))
      .returning()
      .get()
      .pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toRow(row))
            : Effect.die("Custom widget save returned no row"),
        ),
      ),
  remove: (tx, id) =>
    tx
      .delete(customWidgetTable)
      .where(eq(customWidgetTable.id, id))
      .pipe(Effect.asVoid),
};
