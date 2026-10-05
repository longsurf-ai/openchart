// Purpose: Canonicalize saved drawing coordinates once, outside runtime rendering.
import { sql } from "drizzle-orm";
import { DateTime, Effect, Schema } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

// Frozen historical JSON contract; never import the current Drawing schema.
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeObjects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const decodeTime = Schema.decodeUnknownSync(Schema.Union([
  Schema.Finite,
  Schema.String,
  Schema.Struct({ year: Schema.Int, month: Schema.Int, day: Schema.Int }),
]));
const decodeSeconds = Schema.decodeUnknownSync(Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(-62167219200),
  Schema.isLessThan(253402300800),
));

function seconds(value: unknown): number {
  const time = decodeTime(value);
  return decodeSeconds(typeof time === "number"
    ? time >= 1e12 ? time / 1000 : time
    : DateTime.toEpochMillis(DateTime.makeUnsafe(time)) / 1000);
}

function anchor(value: unknown) {
  const point = decodeObject(value);
  return { ...point, time: seconds(point.time) };
}

const migration: DatabaseMigration.Migration = {
  id: "20261002220000_drawing-epoch-seconds",
  /** Preserve identity, content, styles and revisions while upgrading coordinates.
   * @example yield* migration.up(tx);
   */
  up(tx) {
    return Effect.gen(function* () {
      const rows = yield* tx.all<{ id: string; data: string }>(sql`SELECT id, data FROM drawing`);
      const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject));
      for (const row of rows) {
        const data = decode(row.data);
        const next = {
          ...data,
          anchors: decodeObjects(data.anchors).map(anchor),
          ...(data.type === "annotation" ? { time: seconds(data.time) } : {}),
          ...(data.labelAnchor === undefined ? {} : { labelAnchor: anchor(data.labelAnchor) }),
        };
        // Agent Session selection ranges are explicitly milliseconds, not chart coordinates.
        if (JSON.stringify(next) !== JSON.stringify(data))
          yield* tx.run(sql`UPDATE drawing SET data = ${JSON.stringify(next)} WHERE id = ${row.id}`);
      }
    });
  },
};
export default migration;
