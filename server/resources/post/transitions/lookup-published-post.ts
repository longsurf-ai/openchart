// Purpose: Replays an internal publication request before resolving mutable external inputs.
import { Effect } from "effect";
import { Transition } from "@openchart/server/lib/resource";
import { ResourceStateInvalid } from "@openchart/server/lib/resource/errors";
import { toEntity } from "@openchart/server/lib/resource/entity-operations";
import { PostEntity } from "@openchart/server/resources/post/entity";
import {
  findPublication,
  postStore,
} from "@openchart/server/resources/post/store";

/**
 * Reads one trusted request key and hash in the caller transaction. A matching
 * replay returns the saved Post; missing publication returns null; changed
 * request content fails. Never register this trusted input as a public RPC.
 * @example const saved = yield* Transactor.run(lookupPublishedPost(publicationKey, requestHash));
 */
export function lookupPublishedPost(
  publicationKey: string,
  requestHash: string,
) {
  return Transition.from((tx) =>
    Effect.gen(function* () {
      const existing = yield* findPublication(tx, publicationKey);
      if (!existing) return null;
      if (existing.publicationHash !== requestHash)
        return yield* new ResourceStateInvalid({
          resource: "post",
          reason: "Publication key was already used for different content",
          issues: [],
        });
      const stored = yield* postStore.load(tx, existing.id);
      if (!stored)
        return yield* Effect.die(
          "Existing publication disappeared inside transaction",
        );
      return yield* toEntity("post", PostEntity, stored);
    }),
  );
}
