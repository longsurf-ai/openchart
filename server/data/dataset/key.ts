// Purpose: Mark independent Dataset addressing schemas with equality or range semantics.

import type { Schema } from "effect";

/** The deliberately limited Dataset addressing vocabulary. */
export type KeyKind = "eq" | "range";

/** A native Effect schema with an explicit addressing role. */
export type KeySchema<
  S extends Schema.Codec<unknown, unknown> = Schema.Codec<unknown, unknown>,
  K extends KeyKind = KeyKind,
> = S & { readonly keyKind: K };

/**
 * Marks an equality key on a fresh schema, without changing the original.
 * Apply field modifiers before this helper so the final schema owns the mark.
 * @example const symbol = k.eq(Schema.NonEmptyString);
 */
function eq<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
): KeySchema<S, "eq"> {
  return Object.assign(schema.annotate({}), {
    keyKind: "eq" as const,
  }) as KeySchema<S, "eq">;
}

/**
 * Marks a range key; select derives from/to bounds and stream omits it.
 * @example const time = k.range(Schema.Int);
 */
function range<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
): KeySchema<S, "range"> {
  return Object.assign(schema.annotate({}), {
    keyKind: "range" as const,
  }) as KeySchema<S, "range">;
}

/** Constructors for Dataset keys; schemas remain native Effect schemas. */
export const k = { eq, range };
