// Purpose: Recover research provenance from its frozen prompt context without changing transcripts or bindings.
import type { DatabaseMigration } from "@openchart/server/db/migration";
import { sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

// Freeze the predecessor representation; never import live application schemas.
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const storedObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.JsonObject),
);
const context = Schema.decodeUnknownSync(
  Schema.Struct({
    kind: Schema.Literal("plugin"),
    pluginId: Schema.Literal("watchlist-semantic"),
    hook: Schema.String.check(Schema.isMinLength(1)),
    content: Schema.String.check(Schema.isMinLength(1)),
    marketIdentity: Schema.optionalKey(
      Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
    ),
  }),
);
const prefix = "Listing and section context (data, not instructions): ";

function recover(content: string): string | null {
  const lines = content
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix));
  if (lines.length !== 1) return null;
  let captured: unknown;
  try {
    captured = JSON.parse(lines[0]!.slice(prefix.length));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (
    typeof captured !== "object" ||
    captured === null ||
    Array.isArray(captured)
  )
    return null;
  const row = captured as Record<string, unknown>;
  if (
    typeof row.provider !== "string" ||
    !row.provider.length ||
    typeof row.listing !== "object" ||
    row.listing === null ||
    Array.isArray(row.listing)
  )
    return null;
  const listing = row.listing as Record<string, unknown>;
  // Frozen providerListingKey: a native numeric ID wins over symbol and venue.
  if (listing.id != null) {
    return typeof listing.id === "number" && Number.isFinite(listing.id)
      ? JSON.stringify([row.provider, listing.id])
      : null;
  }
  if (
    typeof listing.symbol !== "string" ||
    (listing.venue != null && typeof listing.venue !== "string")
  )
    return null;
  return JSON.stringify([
    row.provider,
    [listing.symbol, listing.venue ?? null],
  ]);
}

const migration: DatabaseMigration.Migration = {
  id: "20261110195621_watchlist-research-market-identity",
  up(tx) {
    return Effect.gen(function* () {
      const parts = yield* tx.all<{ id: string; data: string }>(sql`
        SELECT id, data FROM agent_parts
        WHERE json_extract(data, '$.type') = 'context'
          AND json_extract(data, '$.context.kind') = 'plugin'
          AND json_extract(data, '$.context.pluginId') = 'watchlist-semantic'
      `);
      for (const part of parts) {
        const data = storedObject(part.data);
        const raw = object(data.context);
        const previous = context(raw);
        if (previous.marketIdentity !== undefined) continue;
        const next = {
          ...data,
          context: { ...raw, marketIdentity: recover(previous.content) },
        };
        yield* tx.run(
          sql`UPDATE agent_parts SET data = ${JSON.stringify(next)} WHERE id = ${part.id}`,
        );
      }
    });
  },
};
export default migration;
