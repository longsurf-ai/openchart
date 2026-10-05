// Purpose: Applies the 20260917065130_widget-layout forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20260917065130_widget-layout",
  /**
   * Applies this migration inside the runner-owned transaction.
   *
   * @example
   * ```ts
   * yield* migration.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`__new_dashboard_widget\` (
          \`id\` text PRIMARY KEY,
          \`dashboard_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`kind\` text NOT NULL,
          \`resource_id\` text,
          \`x\` integer NOT NULL,
          \`y\` integer NOT NULL,
          \`w\` integer NOT NULL,
          \`h\` integer NOT NULL,
          CONSTRAINT \`fk_dashboard_widget_dashboard_id_dashboard_id_fk\` FOREIGN KEY (\`dashboard_id\`) REFERENCES \`dashboard\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`dashboard_widget_position_unique\` UNIQUE(\`dashboard_id\`,\`position\`),
          CONSTRAINT "dashboard_widget_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "dashboard_widget_position_check" CHECK("position" >= 0),
          CONSTRAINT "dashboard_widget_kind_check" CHECK(length("kind") > 0),
          CONSTRAINT "dashboard_widget_resource_id_check" CHECK("resource_id" IS NULL OR length("resource_id") > 0),
          CONSTRAINT "dashboard_widget_x_check" CHECK(typeof("x") = 'integer' AND "x" >= 0),
          CONSTRAINT "dashboard_widget_y_check" CHECK(typeof("y") = 'integer' AND "y" >= 0),
          CONSTRAINT "dashboard_widget_w_check" CHECK(typeof("w") = 'integer' AND "w" >= 1),
          CONSTRAINT "dashboard_widget_h_check" CHECK(typeof("h") = 'integer' AND "h" >= 1),
          CONSTRAINT "dashboard_widget_width_check" CHECK("x" + "w" <= 12)
        );
      `);
      yield* tx.run(`
        INSERT INTO __new_dashboard_widget (id, dashboard_id, position, kind, resource_id, x, y, w, h)
        SELECT id, dashboard_id, position, kind, resource_id,
          0, 16 * (row_number() OVER (PARTITION BY dashboard_id ORDER BY position, id) - 1), 12, 16
        FROM dashboard_widget;
      `);
      yield* tx.run("DROP TABLE `dashboard_widget`;");
      yield* tx.run(
        "ALTER TABLE `__new_dashboard_widget` RENAME TO `dashboard_widget`;",
      );
      // Existing Chart Resources become visible placements without changing any
      // Chart/Cell/Series/Drawing identity, revision, or local preference key.
      yield* tx.run(`
        WITH missing AS (
          SELECT chart.id, chart.dashboard_id,
            row_number() OVER (PARTITION BY chart.dashboard_id ORDER BY chart.created_at, chart.id) - 1 AS offset
          FROM chart
          WHERE NOT EXISTS (
            SELECT 1 FROM dashboard_widget AS widget
            WHERE widget.dashboard_id = chart.dashboard_id AND widget.kind = 'chart' AND widget.resource_id = chart.id
          )
        ), existing AS (
          SELECT dashboard_id, max(position) + 1 AS next_position, max(y + h) AS bottom
          FROM dashboard_widget GROUP BY dashboard_id
        )
        INSERT INTO dashboard_widget (id, dashboard_id, position, kind, resource_id, x, y, w, h)
        SELECT 'wdg_' || lower(hex(randomblob(16))), missing.dashboard_id,
          coalesce(existing.next_position, 0) + missing.offset, 'chart', missing.id,
          0, coalesce(existing.bottom, 0) + 16 * missing.offset, 12, 16
        FROM missing LEFT JOIN existing ON existing.dashboard_id = missing.dashboard_id;
      `);
      yield* tx.run(`
        UPDATE dashboard SET revision = revision + 1,
          updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
        WHERE EXISTS (SELECT 1 FROM dashboard_widget WHERE dashboard_id = dashboard.id);
      `);
    });
  },
};

export default migration;
