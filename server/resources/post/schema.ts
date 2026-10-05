// Purpose: Owns persistent Posts and their immutable, Post-owned media snapshots.

import { defineId } from "@openchart/identifier";
import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { Timestamp } from "@openchart/server/lib/resource/envelope";
import { AlertRuleId } from "@openchart/server/resources/alert-rule/entity";
import { AlertEventId } from "@openchart/server/resources/alert-event/entity";
import { SessionId } from "@openchart/server/agent/contracts/session";
import { desc, sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { Schema } from "effect";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const nonblank = Schema.String.check(Schema.isPattern(/\S/));
/** Persistent Post identity. */
export const PostId = defineId("pst", "Post.ID");
export type PostId = typeof PostId.Type;
/** One immutable media snapshot owned by one Post. */
export const PostMediaId = defineId("pmd", "PostMedia.ID");
export type PostMediaId = typeof PostMediaId.Type;
/** Transient client read preferences; these fields are never stored on a Post. */
export const PostReadFilter = Schema.Struct({
  after: Timestamp,
  excludeIds: Schema.Array(PostId),
}).annotate(strict);
export type PostReadFilter = typeof PostReadFilter.Type;

/** Author identity captured by the trusted publisher, never inferred from current settings. */
export const PostAuthor = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("provider"),
    providerId: nonblank,
  }).annotate(strict),
  Schema.Struct({
    kind: Schema.Literal("rule"),
    ruleId: AlertRuleId,
    name: nonblank,
  }).annotate(strict),
]);
/** Retained Alert identity; source deletion does not remove published history. */
export const PostAlertOrigin = Schema.Struct({
  eventId: AlertEventId,
  ruleId: AlertRuleId,
}).annotate(strict);
/** Execution/source facts captured at publication, independent of quote relationships. */
export const PostOrigin = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("alert_event"),
    ...PostAlertOrigin.fields,
    occurredAt: Timestamp,
  }).annotate(strict),
  Schema.Struct({
    kind: Schema.Literal("agent_run"),
    runId: Schema.String.check(Schema.isStartsWith("agr_")),
    sessionId: SessionId,
    alert: Schema.NullOr(PostAlertOrigin),
  }).annotate(strict),
]);
/** Text is always Markdown and may be interleaved with media and Resource references. */
export const PostText = Schema.Struct({
  type: Schema.Literal("text"),
  text: nonblank,
}).annotate(strict);
/** Existing Resource references retain identity when their target disappears. */
export const PostResource = Schema.Struct({
  type: Schema.Literal("resource"),
  resource: nonblank,
  id: nonblank,
}).annotate(strict);
/** A media reference never embeds bytes in a Feed page. */
export const PostMedia = Schema.Struct({
  type: Schema.Literal("media"),
  mediaId: PostMediaId,
  description: Schema.String,
}).annotate(strict);
/** Ordered mixed content; pure-media Posts are valid, empty Posts are not. */
export const PostContent = Schema.Array(
  Schema.Union([PostText, PostMedia, PostResource]),
).check(Schema.isMinLength(1));
export type PostContent = typeof PostContent.Type;
/** Trusted publication after tool decoding and bounded Workspace media reads; never a wire input. */
export interface PostPublication {
  readonly publicationKey: string;
  /** Identifies the validated request before importing mutable files. */
  readonly requestHash?: string;
  readonly author: typeof PostAuthor.Type;
  readonly origin: typeof PostOrigin.Type;
  readonly content: readonly (
    | typeof PostText.Type
    | typeof PostResource.Type
    | {
        readonly type: "media";
        readonly mime: string;
        readonly filename: string;
        readonly bytes: Buffer;
        readonly description: string;
      }
  )[];
  readonly quotedPostId: PostId | null;
}

/** Published content has its own lifetime; source and quoted IDs deliberately have no cascading foreign keys. */
export const posts = sqliteTable(
  "post",
  {
    ...resourceEnvelopeColumns(),
    author: text("author_json", { mode: "json" })
      .$type<typeof PostAuthor.Type>()
      .notNull(),
    origin: text("origin_json", { mode: "json" })
      .$type<typeof PostOrigin.Type>()
      .notNull(),
    content: text("content_json", { mode: "json" })
      .$type<PostContent>()
      .notNull(),
    quotedPostId: text("quoted_post_id"),
    publicationKey: text("publication_key").notNull(),
    publicationHash: text("publication_hash").notNull(),
  },
  (table) => [
    ...resourceEnvelopeChecks("post", table),
    uniqueIndex("uq_post_publication").on(table.publicationKey),
    index("idx_post_created").on(desc(table.createdAt), desc(table.id)),
    check(
      "chk_post_author",
      sql`json_valid(${table.author}) AND json_type(${table.author}) = 'object' AND json_extract(${table.author}, '$.kind') IN ('provider','rule')`,
    ),
    check(
      "chk_post_origin",
      sql`json_valid(${table.origin}) AND json_type(${table.origin}) = 'object' AND json_extract(${table.origin}, '$.kind') IN ('alert_event','agent_run')`,
    ),
    check(
      "chk_post_author_origin",
      sql`(json_extract(${table.origin}, '$.kind') IS 'alert_event' AND json_extract(${table.author}, '$.kind') IS 'rule' AND json_extract(${table.author}, '$.ruleId') IS json_extract(${table.origin}, '$.ruleId')) OR (json_extract(${table.origin}, '$.kind') IS 'agent_run' AND json_extract(${table.author}, '$.kind') IS 'provider')`,
    ),
    check(
      "chk_post_content",
      sql`json_valid(${table.content}) AND json_type(${table.content}) = 'array' AND json_array_length(${table.content}) > 0`,
    ),
    check(
      "chk_post_publication",
      sql`length(trim(${table.publicationKey})) > 0 AND length(${table.publicationHash}) = 64`,
    ),
  ],
);

/** Immutable binary snapshots cascade only when the owning Post is removed. */
export const postMedia = sqliteTable(
  "post_media",
  {
    id: text("id").primaryKey().notNull(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    filename: text("filename").notNull(),
    bytes: blob("bytes", { mode: "buffer" }).notNull(),
  },
  (table) => [
    index("idx_post_media_owner").on(table.postId),
    // ponytail: SQLite snapshots are capped at 32 MiB each; move bytes to blob storage if larger artifacts become necessary.
    check(
      "chk_post_media_size",
      sql`length(${table.bytes}) BETWEEN 1 AND 33554432`,
    ),
  ],
);
