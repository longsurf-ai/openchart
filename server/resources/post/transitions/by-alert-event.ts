// Purpose: Resolves a saved original Post without requiring its Alert Event to survive.
import { Effect, Schema } from "effect";
import { Transition } from "@openchart/server/lib/resource";
import { toEntity } from "@openchart/server/lib/resource/entity-operations";
import { AlertEventId } from "@openchart/server/resources/alert-event/entity";
import { PostEntity } from "@openchart/server/resources/post/entity";
import {
  findPublication,
  postStore,
} from "@openchart/server/resources/post/store";

/** Original Rule publication, or null when no original was saved; source deletion does not affect lookup. */
export const byAlertEvent = Transition.make({
  kind: "query",
  input: Schema.Struct({ eventId: AlertEventId }).annotate({
    parseOptions: { onExcessProperty: "error" },
  }),
  resolve: () => Effect.void,
  apply: (tx, input) =>
    Effect.gen(function* () {
      const saved = yield* findPublication(tx, `event:${input.eventId}`);
      if (!saved) return null;
      const row = yield* postStore.load(tx, saved.id);
      if (!row)
        return yield* Effect.die(
          "Saved publication disappeared inside transaction",
        );
      const post = yield* toEntity("post", PostEntity, row);
      if (
        post.origin.kind !== "alert_event" ||
        post.origin.eventId !== input.eventId
      )
        return yield* Effect.die(
          "Event publication key must identify its original Rule Post",
        );
      return post;
    }),
});
