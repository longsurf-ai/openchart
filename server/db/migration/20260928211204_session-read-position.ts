// Purpose: Applies the 20260928211204_session-read-position forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20260928211204_session-read-position",
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
      yield* tx.run(
        "ALTER TABLE `agent_sessions` ADD `last_read_run_id` text REFERENCES agent_run(id) ON DELETE RESTRICT;",
      );
      yield* tx.run(
        "CREATE INDEX `agent_run_session_id_idx` ON `agent_run` (`session_id`,`id`);",
      );
    });
  },
};

export default migration;
