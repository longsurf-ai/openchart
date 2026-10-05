// Purpose: Expose the existing Alert starter catalog as a Resource query.
import { Transition } from "@openchart/server/lib/resource";
import { Effect, Schema } from "effect";
import { alertStarters } from "@openchart/server/alert/starters";

/** Reads bundled templates without compiling, saving, or observing an Alert. */
export const starters = Transition.make({
  kind: "query",
  input: Schema.Void,
  resolve: () => Effect.void,
  apply: () => Effect.succeed(alertStarters),
});
