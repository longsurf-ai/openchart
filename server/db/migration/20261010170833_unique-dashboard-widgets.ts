// Purpose: Applies the 20261010170833_unique-dashboard-widgets forward-only SQLite migration.

import { sql } from "drizzle-orm";
import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20261010170833_unique-dashboard-widgets",
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
      // Preserve Chart resources and child IDs by moving extra grids to new dashboards.
      // Drawings are dashboard-scoped: copy them for moved grids; original IDs and
      // their alert references stay on the original dashboard.
      const dashboards = yield* tx.all<{ id: string; name: string }>("SELECT id, name FROM dashboard ORDER BY id");
      for (const dashboard of dashboards) {
        const widgets = yield* tx.all<{ id: string; kind: string; resource_id: string | null }>(sql`
          SELECT id, kind, resource_id FROM dashboard_widget WHERE dashboard_id = ${dashboard.id} ORDER BY position, id
        `);
        const charts = yield* tx.all<{ id: string }>(sql`
          SELECT id FROM chart WHERE dashboard_id = ${dashboard.id} ORDER BY created_at, id
        `);
        const placed = widgets.find((widget) => widget.kind === "chart" && charts.some((chart) => chart.id === widget.resource_id));
        if (placed) charts.sort((a, b) => Number(b.id === placed.resource_id) - Number(a.id === placed.resource_id));
        const movedWidgets = new Set<string>();
        for (const [index, chart] of charts.entries()) {
          if (index === 0) continue;
          const destination = `dsh_${crypto.randomUUID().replaceAll("-", "")}`;
          const name = `${dashboard.name.slice(0, 170)} (Chart ${index + 1})`;
          yield* tx.run(sql`INSERT INTO dashboard (id, name, favorite) SELECT ${destination}, ${name}, favorite FROM dashboard WHERE id = ${dashboard.id}`);
          yield* tx.run(sql`UPDATE chart SET dashboard_id = ${destination}, revision = revision + 1 WHERE id = ${chart.id}`);
          yield* tx.run(sql`
            INSERT INTO drawing (id, revision, created_at, updated_at, dashboard_id, provider, listing, data)
            SELECT 'drw_' || lower(hex(randomblob(16))), revision, created_at, updated_at, ${destination}, provider, listing, data
            FROM drawing WHERE dashboard_id = ${dashboard.id}
          `);
          const widget = widgets.find((item) => item.kind === "chart" && item.resource_id === chart.id);
          if (widget) {
            yield* tx.run(sql`UPDATE dashboard_widget SET dashboard_id = ${destination}, position = 0 WHERE id = ${widget.id}`);
            movedWidgets.add(widget.id);
          } else {
            const id = `wdg_${crypto.randomUUID().replaceAll("-", "")}`;
            yield* tx.run(sql`INSERT INTO dashboard_widget (id, dashboard_id, position, kind, x, y, w, h) VALUES (${id}, ${destination}, 0, 'chart', 0, 0, 12, 24)`);
          }
        }
        const kept = new Set<string>();
        // Prefer the placement of the retained Chart when historical references differ.
        const retained = widgets.find((widget) => widget.kind === "chart" && widget.resource_id === charts[0]?.id)
          ?? widgets.find((widget) => widget.kind === "chart" && !movedWidgets.has(widget.id));
        for (const widget of widgets) {
          if (movedWidgets.has(widget.id)) continue;
          if (widget.kind === "chart" && widget.id !== retained?.id) {
            // Duplicate views contain no Chart data; every Chart above remains intact.
            yield* tx.run(sql`DELETE FROM dashboard_widget WHERE id = ${widget.id}`);
          } else if (kept.has(widget.kind)) {
            // Preserve placement IDs, including their locally stored browser state.
            const destination = `dsh_${crypto.randomUUID().replaceAll("-", "")}`;
            const name = `${dashboard.name.slice(0, 150)} (${widget.kind.slice(0, 40)})`;
            yield* tx.run(sql`INSERT INTO dashboard (id, name, favorite) SELECT ${destination}, ${name}, favorite FROM dashboard WHERE id = ${dashboard.id}`);
            yield* tx.run(sql`UPDATE dashboard_widget SET dashboard_id = ${destination}, position = 0 WHERE id = ${widget.id}`);
          } else kept.add(widget.kind);
        }
        if (widgets.length || charts.length > 1)
          yield* tx.run(sql`UPDATE dashboard SET revision = revision + 1 WHERE id = ${dashboard.id}`);
      }
      yield* tx.run("PRAGMA foreign_keys=OFF;");
      yield* tx.run(`
        CREATE TABLE \`__new_dashboard_widget\` (
          \`id\` text PRIMARY KEY,
          \`dashboard_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`kind\` text NOT NULL,
          \`x\` integer NOT NULL,
          \`y\` integer NOT NULL,
          \`w\` integer NOT NULL,
          \`h\` integer NOT NULL,
          CONSTRAINT \`fk_dashboard_widget_dashboard_id_dashboard_id_fk\` FOREIGN KEY (\`dashboard_id\`) REFERENCES \`dashboard\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`dashboard_widget_position_unique\` UNIQUE(\`dashboard_id\`,\`position\`),
          CONSTRAINT \`dashboard_widget_kind_unique\` UNIQUE(\`dashboard_id\`,\`kind\`),
          CONSTRAINT "dashboard_widget_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "dashboard_widget_position_check" CHECK("position" >= 0),
          CONSTRAINT "dashboard_widget_kind_check" CHECK(length("kind") > 0),
          CONSTRAINT "dashboard_widget_x_check" CHECK(typeof("x") = 'integer' AND "x" >= 0),
          CONSTRAINT "dashboard_widget_y_check" CHECK(typeof("y") = 'integer' AND "y" >= 0),
          CONSTRAINT "dashboard_widget_w_check" CHECK(typeof("w") = 'integer' AND "w" >= 1),
          CONSTRAINT "dashboard_widget_h_check" CHECK(typeof("h") = 'integer' AND "h" >= 1),
          CONSTRAINT "dashboard_widget_width_check" CHECK("x" + "w" <= 12)
        );
      `);
      yield* tx.run(
        "INSERT INTO `__new_dashboard_widget`(`id`, `dashboard_id`, `position`, `kind`, `x`, `y`, `w`, `h`) SELECT `id`, `dashboard_id`, `position`, `kind`, `x`, `y`, `w`, `h` FROM `dashboard_widget`;",
      );
      yield* tx.run("DROP TABLE `dashboard_widget`;");
      yield* tx.run(
        "ALTER TABLE `__new_dashboard_widget` RENAME TO `dashboard_widget`;",
      );
      yield* tx.run("PRAGMA foreign_keys=ON;");
      yield* tx.run("DROP INDEX IF EXISTS `chart_dashboard_index`;");
      yield* tx.run(
        "CREATE UNIQUE INDEX `chart_dashboard_unique` ON `chart` (`dashboard_id`);",
      );
    });
  },
};

export default migration;
