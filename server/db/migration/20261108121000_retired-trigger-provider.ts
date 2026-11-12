// Purpose: Removes Triggers whose agent prompt targets a retired provider that can no longer resolve a model.

import type { DatabaseMigration } from "@openchart/server/db/migration";
import { sql } from "drizzle-orm";
import { Effect } from "effect";

/** Providers removed from the model registry; their stored prompt targets cannot run. */
const RETIRED_PROVIDERS = ["omp"];

const migration: DatabaseMigration.Migration = {
  id: "20261108121000_retired-trigger-provider",
  /**
   * Deletes unusable agent-prompt Triggers inside the runner-owned transaction.
   * Notification Targets are untouched.
   *
   * @example
   * ```ts
   * yield* migration.up(transaction);
   * ```
   */
  up(tx) {
    return Effect.gen(function* () {
      const retired = sql.join(
        RETIRED_PROVIDERS.map((provider) => sql`${provider}`),
        sql`, `,
      );
      yield* tx.run(sql`
        DELETE FROM trigger
        WHERE json_extract(target_json, '$.kind') = 'agent_prompt'
          AND json_extract(target_json, '$.prompt.model.providerID')
            IN (${retired})
      `);
      yield* tx.run(sql`
        DELETE FROM agent_schedule
        WHERE json_extract(target_json, '$.kind') = 'agent_prompt'
          AND json_extract(target_json, '$.prompt.model.providerID')
            IN (${retired})
      `);
    });
  },
};

export default migration;
