// Purpose: Applies the 20260925183938_drawing-state-constraints forward-only SQLite migration.

import { Effect } from "effect";
import type { DatabaseMigration } from "../migration";

const migration: DatabaseMigration.Migration = {
  id: "20260925183938_drawing-state-constraints",
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
        "CREATE UNIQUE INDEX `drawing_scope_gesture_unique` ON `drawing` (`dashboard_id`,`provider`,json_array(json_extract(\"listing\", '$.symbol'), json_extract(\"listing\", '$.venue'), json_extract(\"listing\", '$.currency')),json_extract(\"data\", '$.id'));",
      );
    });
  },
};

export default migration;
