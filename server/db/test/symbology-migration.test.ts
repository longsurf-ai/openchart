// Purpose: Verify the new listing table upgrades an existing database without touching its Resources.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { symbologyTable } from "@openchart/server/resources/symbology/schema";
import { workspaceTable } from "@openchart/server/resources/workspace/schema";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

test("predecessor upgrade keeps existing rows and creates an empty unique listing index", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      const at = migrations.findIndex((migration) =>
        migration.id.endsWith("_symbology"),
      );
      expect(at).toBeGreaterThan(0);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db
        .insert(workspaceTable)
        .values({ id: "wsp_existing", root: "/tmp/existing", revision: 7 });
      const before = yield* db.select().from(workspaceTable);
      yield* DatabaseMigration.applyOnly(db, migrations);
      expect(yield* db.select().from(workspaceTable)).toEqual(before);
      expect(yield* db.select().from(symbologyTable)).toEqual([]);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  );
});
