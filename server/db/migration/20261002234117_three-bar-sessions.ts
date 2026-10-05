// Purpose: Applies the 20261002234117_three-bar-sessions forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const migration: DatabaseMigration.Migration = {
  id: "20261002234117_three-bar-sessions",
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
      // Preserve cascade children while rebuilding constrained tables inside the transaction.
      const children = ["alert_event", "chart_market_source", "chart_pane", "chart_series", "chart_link"];
      for (const table of children) yield* tx.run(`CREATE TEMP TABLE session_coverage_${table} AS SELECT * FROM ${table}`);
      // Save each cell's actual listing class before temporarily removing its sources.
      yield* tx.run(`CREATE TEMP TABLE session_coverage_cells AS
        SELECT cell.id, CASE
          WHEN cell.session IN ('regular', 'extended', '24h') THEN cell.session
          WHEN cell.session IN ('pre', 'post') THEN 'extended'
          WHEN cell.session = 'overnight' THEN '24h'
          WHEN EXISTS (SELECT 1 FROM chart_market_source source WHERE source.cell_id = cell.id AND json_extract(source.listing, '$.class') = 'crypto') THEN '24h'
          ELSE 'regular' END AS session FROM chart_cell cell`);
      for (const table of [...children].reverse()) yield* tx.run(`DELETE FROM ${table}`);
      // A changed alert coverage must be reviewed before it can fire on a wider series.
      yield* tx.run(`UPDATE alert_rule SET
        enabled = 0, revision = revision + 1,
        alertable_json = json_set(alertable_json, '$.inputs.session',
          CASE json_extract(alertable_json, '$.inputs.session')
            WHEN 'pre' THEN 'extended' WHEN 'post' THEN 'extended' WHEN 'overnight' THEN '24h'
            ELSE CASE WHEN json_extract(alertable_json, '$.inputs.listing.class') = 'crypto' THEN '24h' ELSE 'regular' END END)
        WHERE json_extract(alertable_json, '$.kind') = 'drawing'
          AND json_extract(alertable_json, '$.inputs.session') NOT IN ('regular', 'extended', '24h')`);


      yield* tx.run(`
        CREATE TABLE \`__new_alert_rule\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`name\` text NOT NULL,
          \`enabled\` integer DEFAULT true NOT NULL,
          \`repeat\` integer DEFAULT false NOT NULL,
          \`alertable_json\` text NOT NULL,
          CONSTRAINT "alert_rule_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "alert_rule_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "alert_rule_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "alert_rule_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chk_alert_rules_name" CHECK(length(trim("name")) BETWEEN 1 AND 160),
          CONSTRAINT "chk_alert_rules_alertable" CHECK(json_valid("alertable_json") AND json_type("alertable_json") IS 'object'
                AND ((json_extract("alertable_json", '$.kind') IS 'tea'
                AND json_type("alertable_json", '$.source') IS 'text'
                AND length(json_extract("alertable_json", '$.source')) BETWEEN 1 AND 65536
                AND json_type("alertable_json", '$.config') IS 'object')
                OR (json_extract("alertable_json", '$.kind') IS 'drawing'
                AND json_type("alertable_json", '$.drawingId') IS 'text'
                AND substr(json_extract("alertable_json", '$.drawingId'), 1, 4) = 'drw_'
                AND json_type("alertable_json", '$.operator') IS 'text'
                AND json_extract("alertable_json", '$.operator') IN ('crossing', 'crossing_up', 'crossing_down', 'entering_channel', 'exiting_channel', 'inside_channel', 'outside_channel', 'touching')
                AND json_type("alertable_json", '$.inputs') IS 'object'
                AND json_type("alertable_json", '$.inputs.provider') IS 'text'
                AND length(json_extract("alertable_json", '$.inputs.provider')) > 0
                AND json_type("alertable_json", '$.inputs.listing') IS 'object'
                AND json_type("alertable_json", '$.inputs.listing.symbol') IS 'text'
                AND json_type("alertable_json", '$.inputs.listing.currency') IS 'text'
                AND json_type("alertable_json", '$.inputs.resolution') IS 'text'
                AND json_extract("alertable_json", '$.inputs.resolution') IN ('1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1W', '1M')
                AND json_type("alertable_json", '$.inputs.session') IS 'text'
                AND json_extract("alertable_json", '$.inputs.session') in ('regular', 'extended', '24h')
                AND json_type("alertable_json", '$.inputs.adjustment') IS 'text'
                AND json_extract("alertable_json", '$.inputs.adjustment') IN ('raw', 'split', 'split_dividend'))))
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_alert_rule`(`id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `repeat`, `alertable_json`) SELECT `id`, `revision`, `created_at`, `updated_at`, `name`, `enabled`, `repeat`, `alertable_json` FROM `alert_rule`;",
      );
      yield* tx.run("DROP TABLE `alert_rule`;");
      yield* tx.run("ALTER TABLE `__new_alert_rule` RENAME TO `alert_rule`;");


      yield* tx.run(`
        CREATE TABLE \`__new_chart_cell\` (
          \`id\` text PRIMARY KEY,
          \`chart_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`resolution\` text DEFAULT '1d' NOT NULL,
          \`session\` text DEFAULT 'extended' NOT NULL,
          \`adjustment\` text DEFAULT 'raw' NOT NULL,
          CONSTRAINT \`fk_chart_cell_chart_id_chart_id_fk\` FOREIGN KEY (\`chart_id\`) REFERENCES \`chart\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_cell_position_unique\` UNIQUE(\`chart_id\`,\`position\`),
          CONSTRAINT \`chart_cell_chart_id_unique\` UNIQUE(\`chart_id\`,\`id\`),
          CONSTRAINT "chart_cell_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_cell_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "chart_cell_resolution_check" CHECK("resolution" in ('1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1W', '1M')),
          CONSTRAINT "chart_cell_session_check" CHECK("session" in ('regular', 'extended', '24h')),
          CONSTRAINT "chart_cell_adjustment_check" CHECK("adjustment" in ('raw', 'split', 'split_dividend'))
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_chart_cell`(`id`, `chart_id`, `position`, `resolution`, `session`, `adjustment`) SELECT cell.id, cell.chart_id, cell.position, cell.resolution, selected.session, cell.adjustment FROM chart_cell cell JOIN session_coverage_cells selected ON selected.id = cell.id;",
      );
      yield* tx.run("DROP TABLE `chart_cell`;");
      yield* tx.run("ALTER TABLE `__new_chart_cell` RENAME TO `chart_cell`;");
      for (const table of children) {
        yield* tx.run(`INSERT INTO ${table} SELECT * FROM session_coverage_${table}`);
        yield* tx.run(`DROP TABLE session_coverage_${table}`);
      }
      yield* tx.run("DROP TABLE session_coverage_cells");
      if ((yield* tx.all("PRAGMA foreign_key_check")).length) return yield* Effect.die("Session coverage migration violated foreign keys");

    });
  },
};

export default migration;
