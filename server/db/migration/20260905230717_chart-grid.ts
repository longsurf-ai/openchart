// Purpose: Applies the 20260905230717_chart-grid forward-only SQLite migration.

import {Effect} from 'effect';
import type {DatabaseMigration} from '../migration';

const migration: DatabaseMigration.Migration = {
  id: '20260905230717_chart-grid',
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
        CREATE TABLE \`chart_cell\` (
          \`id\` text PRIMARY KEY,
          \`chart_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`resolution\` text DEFAULT '1d' NOT NULL,
          \`session\` text DEFAULT 'extended' NOT NULL,
          CONSTRAINT \`fk_chart_cell_chart_id_chart_id_fk\` FOREIGN KEY (\`chart_id\`) REFERENCES \`chart\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_cell_position_unique\` UNIQUE(\`chart_id\`,\`position\`),
          CONSTRAINT \`chart_cell_chart_id_unique\` UNIQUE(\`chart_id\`,\`id\`),
          CONSTRAINT "chart_cell_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_cell_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "chart_cell_resolution_check" CHECK("resolution" in ('1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1W', '1M')),
          CONSTRAINT "chart_cell_session_check" CHECK("session" in ('regular', 'extended'))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`chart_indicator\` (
          \`id\` text PRIMARY KEY,
          \`cell_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          CONSTRAINT \`fk_chart_indicator_cell_id_chart_cell_id_fk\` FOREIGN KEY (\`cell_id\`) REFERENCES \`chart_cell\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_indicator_position_unique\` UNIQUE(\`cell_id\`,\`position\`),
          CONSTRAINT \`chart_indicator_cell_id_unique\` UNIQUE(\`cell_id\`,\`id\`),
          CONSTRAINT "chart_indicator_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_indicator_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`chart_link\` (
          \`id\` text PRIMARY KEY,
          \`chart_id\` text NOT NULL,
          \`from_cell_id\` text NOT NULL,
          \`to_cell_id\` text NOT NULL,
          \`sync_listing\` integer DEFAULT false NOT NULL,
          \`sync_crosshair\` integer DEFAULT false NOT NULL,
          \`sync_time_scale\` integer DEFAULT false NOT NULL,
          CONSTRAINT \`fk_chart_link_chart_id_chart_id_fk\` FOREIGN KEY (\`chart_id\`) REFERENCES \`chart\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_link_from_cell_fk\` FOREIGN KEY (\`chart_id\`,\`from_cell_id\`) REFERENCES \`chart_cell\`(\`chart_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_link_to_cell_fk\` FOREIGN KEY (\`chart_id\`,\`to_cell_id\`) REFERENCES \`chart_cell\`(\`chart_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_link_endpoints_unique\` UNIQUE(\`chart_id\`,\`from_cell_id\`,\`to_cell_id\`),
          CONSTRAINT "chart_link_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_link_distinct_cells_check" CHECK("from_cell_id" <> "to_cell_id"),
          CONSTRAINT "chart_link_sync_listing_check" CHECK("sync_listing" IN (0, 1)),
          CONSTRAINT "chart_link_sync_crosshair_check" CHECK("sync_crosshair" IN (0, 1)),
          CONSTRAINT "chart_link_sync_time_scale_check" CHECK("sync_time_scale" IN (0, 1))
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`chart_market_source\` (
          \`id\` text PRIMARY KEY,
          \`cell_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`listing\` integer NOT NULL,
          CONSTRAINT \`fk_chart_market_source_cell_id_chart_cell_id_fk\` FOREIGN KEY (\`cell_id\`) REFERENCES \`chart_cell\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_market_source_position_unique\` UNIQUE(\`cell_id\`,\`position\`),
          CONSTRAINT \`chart_market_source_cell_id_unique\` UNIQUE(\`cell_id\`,\`id\`),
          CONSTRAINT "chart_market_source_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_market_source_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "chart_market_source_listing_check" CHECK(typeof("listing") = 'integer' AND "listing" >= 1 AND "listing" <= 2147483647)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`chart_pane\` (
          \`id\` text PRIMARY KEY,
          \`cell_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          CONSTRAINT \`fk_chart_pane_cell_id_chart_cell_id_fk\` FOREIGN KEY (\`cell_id\`) REFERENCES \`chart_cell\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_pane_position_unique\` UNIQUE(\`cell_id\`,\`position\`),
          CONSTRAINT \`chart_pane_cell_id_unique\` UNIQUE(\`cell_id\`,\`id\`),
          CONSTRAINT "chart_pane_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_pane_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`chart_series\` (
          \`id\` text PRIMARY KEY,
          \`cell_id\` text NOT NULL,
          \`pane_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`role\` text DEFAULT 'normal' NOT NULL,
          \`market_source_id\` text,
          \`indicator_id\` text,
          \`output\` text,
          CONSTRAINT \`chart_series_pane_fk\` FOREIGN KEY (\`cell_id\`,\`pane_id\`) REFERENCES \`chart_pane\`(\`cell_id\`,\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`chart_series_market_source_fk\` FOREIGN KEY (\`cell_id\`,\`market_source_id\`) REFERENCES \`chart_market_source\`(\`cell_id\`,\`id\`),
          CONSTRAINT \`chart_series_indicator_fk\` FOREIGN KEY (\`cell_id\`,\`indicator_id\`) REFERENCES \`chart_indicator\`(\`cell_id\`,\`id\`),
          CONSTRAINT \`chart_series_position_unique\` UNIQUE(\`pane_id\`,\`position\`),
          CONSTRAINT "chart_series_id_check" CHECK("id" IS NOT NULL AND length("id") > 0),
          CONSTRAINT "chart_series_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0),
          CONSTRAINT "chart_series_role_check" CHECK("role" in ('main', 'normal')),
          CONSTRAINT "chart_series_source_check" CHECK((
                "market_source_id" IS NOT NULL
                AND "indicator_id" IS NULL AND "output" IS NULL
              ) OR (
                "market_source_id" IS NULL AND "indicator_id" IS NOT NULL
                AND "output" IS NOT NULL AND length("output") > 0
              )),
          CONSTRAINT "chart_series_main_market_check" CHECK("role" <> 'main' OR "market_source_id" IS NOT NULL)
        );
      `);
      yield* tx.run(`
        CREATE TABLE \`chart\` (
          \`id\` text PRIMARY KEY,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`created_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`updated_at\` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
          \`dashboard_id\` text NOT NULL,
          \`preset\` text DEFAULT '1' NOT NULL,
          CONSTRAINT \`fk_chart_dashboard_id_dashboard_id_fk\` FOREIGN KEY (\`dashboard_id\`) REFERENCES \`dashboard\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT "chart_id_check" CHECK("id" IS NOT NULL),
          CONSTRAINT "chart_revision_check" CHECK("revision" >= 1),
          CONSTRAINT "chart_created_at_check" CHECK("created_at" >= 0),
          CONSTRAINT "chart_updated_at_check" CHECK("updated_at" >= 0),
          CONSTRAINT "chart_preset_check" CHECK("preset" in ('1', '1x2', '1x3', '1x4', '2x1', '2x2', '2x3', '2x4', '3x1', '3x2', '3x3', '3x4', '4x1', '4x2', '4x3', '4x4'))
        );
      `);
      yield* tx.run(
        'CREATE INDEX `chart_link_target_index` ON `chart_link` (`chart_id`,`to_cell_id`);',
      );
      yield* tx.run(
        'CREATE UNIQUE INDEX `chart_series_main_unique` ON `chart_series` (`cell_id`) WHERE "chart_series"."role" = \'main\';',
      );
      yield* tx.run(
        'CREATE INDEX `chart_series_market_source_index` ON `chart_series` (`cell_id`,`market_source_id`);',
      );
      yield* tx.run(
        'CREATE INDEX `chart_series_indicator_index` ON `chart_series` (`cell_id`,`indicator_id`);',
      );
      yield* tx.run(
        'CREATE INDEX `chart_dashboard_index` ON `chart` (`dashboard_id`);',
      );
    });
  },
};

export default migration;
