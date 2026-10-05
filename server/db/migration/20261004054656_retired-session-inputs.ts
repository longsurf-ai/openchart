// Purpose: Rewrite retired session values that the three-session migration left in Tea alert configs and Chart Explain inputs.
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

const CURRENT = new Set(["regular", "extended", "24h"]);

/**
 * The three-session migration's mapping: pre and post keep their extended
 * hours, overnight becomes 24h, and anything else (the retired "provider")
 * becomes 24h for crypto and regular otherwise.
 */
function coverage(session: string, listingClass: unknown): string {
  if (session === "pre" || session === "post") return "extended";
  if (session === "overnight") return "24h";
  return listingClass === "crypto" ? "24h" : "regular";
}

/** The `class` of a stored listing object, if it has one. */
function listingClassOf(listing: unknown): unknown {
  return typeof listing === "object" && listing !== null && "class" in listing
    ? listing.class
    : undefined;
}

/** Rewrites, in place, every retired Bars input session at any depth of a stored Tea config; true when something changed. */
function rewriteBarsSessions(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  let changed = false;
  if (
    !Array.isArray(value) &&
    "_tag" in value &&
    value._tag === "Bars" &&
    "session" in value &&
    typeof value.session === "string" &&
    !CURRENT.has(value.session)
  ) {
    const listing = "listing" in value ? value.listing : undefined;
    (value as { session: string }).session = coverage(
      value.session,
      listingClassOf(listing),
    );
    changed = true;
  }
  for (const child of Object.values(value))
    changed = rewriteBarsSessions(child) || changed;
  return changed;
}

const migration: DatabaseMigration.Migration = {
  id: "20261004054656_retired-session-inputs",
  /**
   * Inside the runner-owned transaction, rewrites retired sessions in the
   * strictly decoded places the three-session migration did not cover:
   * - Tea alert configs: every Bars input at any depth, including followed
   *   Indicator requests. Like drawing alerts there, a rule whose coverage
   *   changes is disabled and its revision bumped, so it is reviewed before it
   *   fires on a wider series.
   * - Chart Explain inputs in transcript parts and in run prompts; the crypto
   *   rule reads the class of the drawing they explain.
   * Alert event history and tool parts are read loosely and stay as recorded.
   *
   * @example yield* migration.up(tx);
   */
  up(tx) {
    return Effect.gen(function* () {
      const teaRules = yield* tx.all<{ id: string; config: string }>(sql`
        SELECT id, json_extract(alertable_json, '$.config') AS config
        FROM alert_rule WHERE json_extract(alertable_json, '$.kind') = 'tea'
      `);
      for (const rule of teaRules) {
        const config: unknown = JSON.parse(rule.config);
        if (!rewriteBarsSessions(config)) continue;
        yield* tx.run(sql`
          UPDATE alert_rule
          SET alertable_json = json_set(alertable_json, '$.config', json(${JSON.stringify(config)})),
            enabled = 0,
            revision = revision + 1
          WHERE id = ${rule.id}
        `);
      }

      const parts = yield* tx.all<{
        id: string;
        session: string;
        listingClass: string | null;
      }>(sql`
        SELECT agent_parts.id AS id,
          json_extract(agent_parts.data, '$.input.session') AS session,
          json_extract(drawing.listing, '$.class') AS listingClass
        FROM agent_parts
        LEFT JOIN drawing ON drawing.id = json_extract(agent_parts.data, '$.input.drawingId')
        WHERE json_extract(agent_parts.data, '$.type') = 'plugin_input'
          AND json_extract(agent_parts.data, '$.input.type') = 'chart_explain'
          AND json_extract(agent_parts.data, '$.input.session') NOT IN ('regular', 'extended', '24h')
      `);
      for (const part of parts) {
        yield* tx.run(sql`
          UPDATE agent_parts
          SET data = json_set(data, '$.input.session', ${coverage(part.session, part.listingClass)})
          WHERE id = ${part.id}
        `);
      }

      const runParts = yield* tx.all<{
        id: string;
        key: number;
        session: string;
        listingClass: string | null;
      }>(sql`
        SELECT agent_run.id AS id, part.key AS key,
          json_extract(part.value, '$.input.session') AS session,
          json_extract(drawing.listing, '$.class') AS listingClass
        FROM agent_run, json_each(agent_run.input, '$.parts') AS part
        LEFT JOIN drawing ON drawing.id = json_extract(part.value, '$.input.drawingId')
        WHERE json_extract(part.value, '$.type') = 'plugin_input'
          AND json_extract(part.value, '$.input.type') = 'chart_explain'
          AND json_extract(part.value, '$.input.session') NOT IN ('regular', 'extended', '24h')
      `);
      for (const part of runParts) {
        yield* tx.run(sql`
          UPDATE agent_run
          SET input = json_set(input, ${`$.parts[${part.key}].input.session`}, ${coverage(part.session, part.listingClass)})
          WHERE id = ${part.id}
        `);
      }
    });
  },
};

export default migration;
