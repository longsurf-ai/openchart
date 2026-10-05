// Purpose: Moves each saved Indicator's `// @indicator` JSON comment to Tea's leading indicator() declaration.
import { sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { DatabaseMigration } from "@openchart/server/db/migration";

// The header as the Tea service read it before this migration, frozen here: at
// most one `// @indicator <JSON>` line in the entry file, whose JSON is exactly
// {title, overlay}. Historical migrations never import current Tea schemas.
const HEADER = /^\s*\/\/\s*@indicator\s+(.+)$/gm;
const Presentation = Schema.fromJsonString(
  Schema.Struct({
    title: Schema.NonEmptyString,
    overlay: Schema.Boolean,
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
);

const migration: DatabaseMigration.Migration = {
  id: "20261001125937_indicator-declaration",
  /**
   * Rewrites the entry file of every Indicator snapshot that still has the old
   * header, inside the runner-owned transaction, keeping revisions and
   * timestamps. The header comment goes, with its line when nothing else is
   * on it, and `indicator("Title", overlay = ...)` becomes the first line,
   * because Tea accepts the declaration only as the first statement. Other
   * files, and entries without the header, stay as stored. A second header, or
   * one whose JSON is not {title, overlay}, fails the migration and with it
   * startup.
   *
   * @example yield* migration.up(tx);
   */
  up(tx) {
    return Effect.gen(function* () {
      const rows = yield* tx.all<{ id: string; source: string }>(sql`
        SELECT indicator.id, entry.value AS source
        FROM indicator, json_each(indicator.snapshot) AS entry
        WHERE entry.key = indicator.script_path AND entry.type = 'text'
      `);
      for (const { id, source } of rows) {
        const [header, ...others] = source.matchAll(HEADER);
        if (header === undefined) continue;
        if (others.length > 0)
          return yield* Effect.fail(
            new Error(`Indicator ${id} has more than one @indicator header`),
          );
        const { title, overlay } = yield* Schema.decodeUnknownEffect(
          Presentation,
        )(header[1]).pipe(
          Effect.mapError(
            (error) =>
              new Error(
                `Indicator ${id} has an unknown @indicator header: ${error.message}`,
                { cause: error },
              ),
          ),
        );
        // Tea ends a line, and so the comment, only at \n, while the regex's
        // ^ and $ also stop at \r, U+2028 and U+2029. Remove the comment up to
        // that \n, and the \n too when only whitespace precedes the comment on
        // its line. Blank lines the leading \s* matched above it stay.
        const at = header.index + header[0].indexOf("/");
        const lineStart = source.lastIndexOf("\n", at) + 1;
        const before = source.slice(lineStart, at);
        const after = source.slice(at).replace(/^[^\n]*/, "");
        const rest =
          source.slice(0, lineStart) +
          (before.trim() === "" ? after.slice(1) : before + after);
        // Tea decodes only the \n and \t escapes and reads any other \X as X,
        // so JSON's \r or \u0001 would change the title. Its strings end only
        // at the quote or \n; every other character can stay raw.
        const literal = `"${title.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\n")}"`;
        const entry = `indicator(${literal}, overlay = ${overlay})\n${rest}`;
        // json_patch replaces the one key without a JSON path, so any file name works.
        yield* tx.run(sql`
          UPDATE indicator
          SET snapshot = json_patch(snapshot, json_object(script_path, ${entry}))
          WHERE id = ${id}
        `);
      }
    });
  },
};
export default migration;
