// Purpose: Keep the alert migration after main's existing history and preserve existing Resources.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { alertEvents } from "@openchart/server/resources/alert-event/schema";
import { alertRules } from "@openchart/server/resources/alert-rule/schema";
import { triggers } from "@openchart/server/resources/trigger/schema";
import { workspaceTable } from "@openchart/server/resources/workspace/schema";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("upgrades the pre-alert history without changing existing Resources", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const at = migrations.findIndex((migration) =>
        migration.id.endsWith("_alert-trigger"),
      );
      expect(migrations[at - 1]?.id).toBe("20260921231958_symbology");
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db
        .insert(workspaceTable)
        .values({ id: "wsp_existing", root: "/tmp/existing", revision: 7 });
      const before = yield* db.select().from(workspaceTable);
      yield* DatabaseMigration.applyOnly(db, migrations);
      expect(yield* db.select().from(workspaceTable)).toEqual(before);
      expect(yield* db.select().from(alertRules)).toEqual([]);
      expect(yield* db.select().from(alertEvents)).toEqual([]);
      expect(yield* db.select().from(triggers)).toEqual([]);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  );
});
