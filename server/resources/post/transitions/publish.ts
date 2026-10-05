// Purpose: Publishes trusted content with request idempotency and atomic media snapshots.
import { createHash } from "node:crypto";
import { Effect, Predicate, Schema } from "effect";
import { Transition } from "@openchart/server/lib/resource";
import {
  ResourceNotFound,
  ResourceStateInvalid,
} from "@openchart/server/lib/resource/errors";
import { deriveWriteShape } from "@openchart/server/lib/resource/write-schema";
import { resourceIssues } from "@openchart/server/lib/resource/invariant";
import { toEntity } from "@openchart/server/lib/resource/entity-operations";
import { PostEntity } from "@openchart/server/resources/post/entity";
import {
  PostId,
  PostMediaId,
  type PostPublication,
  type PostContent,
} from "@openchart/server/resources/post/schema";
import {
  insertPublication,
  postStore,
} from "@openchart/server/resources/post/store";
import { lookupPublishedPost } from "./lookup-published-post";

const contentSchema = deriveWriteShape(PostEntity).schema;

/**
 * Publishes already parsed, trusted content in one caller-owned transaction.
 * Same-key retries return the original Post; changed input fails. Source IDs and
 * author snapshots are supplied by the backend, never by the public Resource API.
 * Media bytes remain owned by the new Post even when the source file disappears.
 * @example yield* Transactor.run(publishPost({publicationKey, author, origin, content, quotedPostId: null}));
 */
export function publishPost(input: PostPublication) {
  return Transition.from((tx) =>
    Effect.gen(function* () {
      const hash =
        input.requestHash ??
        createHash("sha256")
          .update(
            JSON.stringify(
              {
                author: input.author,
                origin: input.origin,
                content: input.content,
                quotedPostId: input.quotedPostId,
              },
              (_key, value: unknown) =>
                Predicate.isObject(value)
                  ? Object.fromEntries(
                      Object.entries(value).sort(([a], [b]) =>
                        a.localeCompare(b),
                      ),
                    )
                  : value,
            ),
          )
          .digest("hex");
      const existing = yield* lookupPublishedPost(
        input.publicationKey,
        hash,
      ).apply(tx, undefined);
      if (existing) return existing;
      if (
        input.quotedPostId &&
        !(yield* postStore.load(tx, input.quotedPostId))
      )
        return yield* new ResourceNotFound({
          resource: "post",
          id: input.quotedPostId,
        });
      const media: Array<{
        id: string;
        mime: string;
        filename: string;
        bytes: Buffer;
      }> = [];
      const content: PostContent = input.content.map((block) => {
        if (block.type !== "media") return block;
        const id = PostMediaId.create();
        media.push({
          id,
          mime: block.mime,
          filename: block.filename,
          bytes: block.bytes,
        });
        return { type: "media", mediaId: id, description: block.description };
      });
      const candidate = yield* Schema.decodeUnknownEffect(contentSchema)({
        content,
      }).pipe(
        Effect.mapError(
          (error) =>
            new ResourceStateInvalid({
              resource: "post",
              reason: error.message,
              issues: resourceIssues(error.issue),
            }),
        ),
      );
      const row = yield* insertPublication(
        tx,
        {
          id: PostId.create(),
          revision: 1,
          body: {
            author: input.author,
            origin: input.origin,
            content: candidate.content,
            quotedPostId: input.quotedPostId,
          },
        },
        input.publicationKey,
        hash,
        media,
      );
      return yield* toEntity("post", PostEntity, row);
    }),
  );
}
