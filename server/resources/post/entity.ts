// Purpose: Derives the read-only Post entity from its persistence schema.
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema } from "effect";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { serverManaged } from "@openchart/server/lib/resource/annotation";
import { withInvariants } from "@openchart/server/lib/resource/invariant";
import { PostAuthor, PostContent, PostId, PostOrigin, posts } from "./schema";

const columns = createSelectSchema(posts, {
  author: PostAuthor,
  origin: PostOrigin,
  content: PostContent,
  quotedPostId: Schema.NullOr(PostId),
});
/** Maximum combined Unicode code points in Post text and media descriptions. */
export const POST_CHARACTER_LIMIT = 350;
/** Published content and captured provenance; publication keys and bytes remain internal. */
export const PostEntity = withInvariants(
  Schema.Struct({
    ...envelopeFields(PostId),
    author: serverManaged(columns.fields.author),
    origin: serverManaged(columns.fields.origin),
    content: columns.fields.content,
    quotedPostId: serverManaged(columns.fields.quotedPostId),
  }),
  (invariant) => [
    invariant(
      `Post text and media descriptions must total at most ${POST_CHARACTER_LIMIT} Unicode characters, including Markdown syntax and whitespace`,
      (post, { expect }) => {
        let count = 0;
        for (const block of post.content) {
          if (block.type === "text") count += Array.from(block.text).length;
          if (block.type === "media")
            count += Array.from(block.description).length;
        }
        expect(count <= POST_CHARACTER_LIMIT, { path: ["content"] }).toBe(true);
      },
      { code: "post.character_limit" },
    ),
  ],
);
export type PostEntity = typeof PostEntity.Type;
