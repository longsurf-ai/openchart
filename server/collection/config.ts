// Purpose: Own collection settings and their defaults; read at each run, so edits need no restart.
import { Config, Effect, Schema } from "effect";

/** A script that outlives its timeout is stopped and its run fails. */
export const CollectionSettings = Schema.Struct({
  // A first run also installs Python and the script's dependencies.
  scriptTimeoutSeconds: Schema.Int.check(Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(600)),
  ),
});

/** The `collection` namespace of settings.json. */
export const config = Config.schema(
  Schema.Struct({
    collection: CollectionSettings.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed({})),
    ),
  }),
).pipe(Config.map((value) => value.collection));
