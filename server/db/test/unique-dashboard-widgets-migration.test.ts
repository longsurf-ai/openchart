// Purpose: Preserve existing grids and browser placements while making each kind and Chart unique per Dashboard.
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { DatabaseMigration } from "@openchart/server/db/migration";
import { migrations } from "@openchart/server/db/migration.gen";
import { sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-sqlite-node";
import { Effect } from "effect";
import { expect, test } from "vitest";

const at = migrations.findIndex(({ id }) =>
  id.endsWith("_unique-dashboard-widgets"),
);

test("upgrade moves extra Charts without losing children, Indicators, drawings or browser placement IDs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* makeWithDefaults();
      expect(at).toBeGreaterThan(0);
      yield* DatabaseMigration.applyOnly(db, migrations.slice(0, at));
      yield* db.run(
        "INSERT INTO dashboard (id, name, favorite) VALUES ('dsh_saved', 'Research', 1)",
      );
      for (const id of ["cht_unplaced", "cht_visible", "cht_extra"])
        yield* db.run(
          sql`INSERT INTO chart (id, dashboard_id, preset) VALUES (${id}, 'dsh_saved', '1')`,
        );
      yield* db.run(
        "INSERT INTO chart_cell (id, chart_id, position, resolution, session, adjustment) VALUES ('ccl_saved', 'cht_extra', 0, '1d', 'regular', 'raw')",
      );
      yield* db.run(`INSERT INTO indicator (id, chart_id, cell_id, workspace_id, script_path, snapshot, parameter_overrides)
      VALUES ('ind_saved', 'cht_extra', 'ccl_saved', 'wsp_saved', 'study.tea', '{}', '{}')`);
      yield* db.run(`INSERT INTO drawing (id, dashboard_id, provider, listing, data)
      VALUES ('drw_saved', 'dsh_saved', 'test', '{"symbol":"AAPL"}', '{"id":"gesture","type":"horizontal_line","anchors":[{"time":1,"price":100}]}')`);
      const indicators = yield* db.all("SELECT * FROM indicator");
      const cells = yield* db.all("SELECT * FROM chart_cell");
      const drawing = yield* db.all("SELECT * FROM drawing");
      const widgets = [
        ["wdg_visible", "chart", "cht_visible"],
        ["wdg_extra", "chart", "cht_extra"],
        ["wdg_duplicate", "chart", "cht_visible"],
        ["wdg_lists", "watchlist", null],
        ["wdg_lists_extra", "watchlist", null],
      ] as const;
      for (const [position, [id, kind, resourceId]] of widgets.entries())
        yield* db.run(sql`INSERT INTO dashboard_widget (id, dashboard_id, position, kind, resource_id, x, y, w, h)
        VALUES (${id}, 'dsh_saved', ${position}, ${kind}, ${resourceId}, 0, ${position * 8}, 12, 8)`);
      yield* DatabaseMigration.applyOnly(db, migrations);
      const charts = yield* db.all<{ id: string; dashboard_id: string }>(
        "SELECT id, dashboard_id FROM chart ORDER BY id",
      );
      expect(charts).toHaveLength(3);
      expect(new Set(charts.map((chart) => chart.dashboard_id)).size).toBe(3);
      expect(
        charts.find((chart) => chart.id === "cht_visible")?.dashboard_id,
      ).toBe("dsh_saved");
      expect(yield* db.all("SELECT * FROM chart_cell")).toEqual(cells);
      expect(yield* db.all("SELECT * FROM indicator")).toEqual(indicators);
      expect(
        yield* db.all("SELECT * FROM drawing WHERE id = 'drw_saved'"),
      ).toEqual(drawing);
      expect(yield* db.all("SELECT id FROM drawing")).toHaveLength(3);
      const placements = yield* db.all<{
        id: string;
        dashboard_id: string;
        kind: string;
      }>("SELECT id, dashboard_id, kind FROM dashboard_widget");
      expect(placements.map(({ id }) => id)).toEqual(
        expect.arrayContaining([
          "wdg_visible",
          "wdg_extra",
          "wdg_lists",
          "wdg_lists_extra",
        ]),
      );
      expect(placements.some(({ id }) => id === "wdg_duplicate")).toBe(false);
      expect(
        placements.find(({ id }) => id === "wdg_extra")?.dashboard_id,
      ).toBe(charts.find(({ id }) => id === "cht_extra")?.dashboard_id);
      expect(
        new Set(
          placements.map(({ dashboard_id, kind }) => `${dashboard_id}:${kind}`),
        ).size,
      ).toBe(placements.length);
      expect(
        (yield* db.all<{ name: string }>(
          "PRAGMA table_info(dashboard_widget)",
        )).map(({ name }) => name),
      ).not.toContain("resource_id");
      expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([]);
      const dashboards = yield* db.all("SELECT * FROM dashboard");
      yield* DatabaseMigration.applyOnly(db, migrations);
      expect(yield* db.all("SELECT * FROM dashboard")).toEqual(dashboards);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  ));

test.each(["fresh", "replay"])(
  "%s enforces one widget of each kind and one Chart per Dashboard",
  (mode) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeWithDefaults();
        if (mode === "fresh") yield* DatabaseMigration.apply(db);
        else yield* DatabaseMigration.applyOnly(db, migrations);
        yield* db.run(
          "INSERT INTO dashboard (id, name) VALUES ('dsh_one', 'One')",
        );
        yield* db.run(
          "INSERT INTO chart (id, dashboard_id) VALUES ('cht_one', 'dsh_one')",
        );
        expect(
          (yield* db
            .run(
              "INSERT INTO chart (id, dashboard_id) VALUES ('cht_two', 'dsh_one')",
            )
            .pipe(Effect.result))._tag,
        ).toBe("Failure");
        yield* db.run(
          "INSERT INTO dashboard_widget (id, dashboard_id, position, kind, x, y, w, h) VALUES ('wdg_one', 'dsh_one', 0, 'future', 0, 0, 12, 8)",
        );
        expect(
          (yield* db
            .run(
              "INSERT INTO dashboard_widget (id, dashboard_id, position, kind, x, y, w, h) VALUES ('wdg_two', 'dsh_one', 1, 'future', 0, 8, 12, 8)",
            )
            .pipe(Effect.result))._tag,
        ).toBe("Failure");
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
    ),
);
