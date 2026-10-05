// Purpose: Owns Post persistence, publication lookups, filtered pages, and binary snapshot storage.
import { createHash } from "node:crypto";
import { and, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { Effect, Struct } from "effect";
import type { ListFilter } from "@openchart/server/lib/resource/list-schema";
import { listWindowSql } from "@openchart/server/lib/resource/pagination-sql";
import type { ListWindow } from "@openchart/server/lib/resource/pagination";
import type {
  InsertInput,
  Row,
  Store,
  StoreBody,
  Tx,
} from "@openchart/server/lib/resource/store";
import { ResourceStateInvalid } from "@openchart/server/lib/resource/errors";
import type { PostEntity } from "./entity";
import { postMedia, posts, type PostReadFilter } from "./schema";

type Body = StoreBody<typeof PostEntity>;
type Filter = ListFilter<typeof PostEntity>;
type MediaRow = typeof postMedia.$inferInsert;

function toRow(row: typeof posts.$inferSelect): Row {
  const { id, revision, createdAt, updatedAt, ...body } = Struct.omit(row, [
    "publicationKey",
    "publicationHash",
  ]);
  return { id, revision, createdAt, updatedAt, body };
}

/** Find an already committed publication request inside the publishing transaction. @example yield* findPublication(tx, key); */
export function findPublication(tx: Tx, key: string) {
  return tx.select().from(posts).where(eq(posts.publicationKey, key)).get();
}

/** Reads the immutable bytes for one media identity; Feed pages never load them. @example yield* loadMedia(tx, id); */
export function loadMedia(tx: Tx, id: string) {
  return tx.select().from(postMedia).where(eq(postMedia.id, id)).get();
}

function validateMedia(tx: Tx, id: string, body: Body) {
  return Effect.gen(function* () {
    for (const block of body.content) {
      if (block.type !== "media") continue;
      const media = yield* loadMedia(tx, block.mediaId);
      if (!media || media.postId !== id)
        return yield* new ResourceStateInvalid({
          resource: "post",
          reason: "Media must belong to this Post",
          issues: [],
        });
    }
  });
}

/** Inserts one publication and all byte snapshots atomically using the caller transaction. @example yield* insertPublication(tx, input, key, hash, media); */
export function insertPublication(
  tx: Tx,
  input: InsertInput<Body>,
  publicationKey: string,
  publicationHash: string,
  media: readonly Omit<MediaRow, "postId">[],
) {
  return Effect.gen(function* () {
    if (!("author" in input.body))
      return yield* Effect.die(
        "Post creation requires trusted publication fields",
      );
    const row = yield* tx
      .insert(posts)
      .values({
        id: input.id,
        revision: input.revision,
        author: input.body.author,
        origin: input.body.origin,
        content: input.body.content,
        quotedPostId: input.body.quotedPostId,
        publicationKey,
        publicationHash,
      })
      .returning()
      .get();
    if (!row) return yield* Effect.die("Post insertion returned no row");
    for (const item of media)
      yield* tx.insert(postMedia).values({ ...item, postId: input.id });
    yield* validateMedia(tx, input.id, input.body);
    return toRow(row);
  });
}

// Each provenance variant contributes exactly one Rule identity, even after source deletion.
const alertRuleId = sql<string>`coalesce(json_extract(${posts.origin}, '$.ruleId'), json_extract(${posts.origin}, '$.alert.ruleId'))`;
const agentRunId = sql<string>`json_extract(${posts.origin}, '$.runId')`;

function unreadWhere(filter: PostReadFilter) {
  return and(
    gt(posts.createdAt, filter.after),
    // One JSON parameter avoids SQLite's variable limit for long-lived client read marks.
    notInArray(
      posts.id,
      sql`(select value from json_each(${JSON.stringify(filter.excludeIds)}))`,
    ),
  );
}

/** Selects Optional Rule and transient read filters before pagination. @example yield* listFeedPosts(tx, {limit: 51, order: "desc"}, {ruleId}); */
export function listFeedPosts(
  tx: Tx,
  window: ListWindow,
  filter: {
    readonly ruleId?: string;
    readonly unread?: PostReadFilter;
    readonly search?: string;
  } = {},
) {
  const page = listWindowSql(posts, window);
  const search = filter.search?.trim();
  // ponytail: JSON Rule filter; add a generated indexed column if historical Feed scans become expensive.
  return tx
    .select()
    .from(posts)
    .where(
      and(
        page.where,
        filter.ruleId === undefined
          ? undefined
          : eq(alertRuleId, filter.ruleId),
        filter.unread === undefined ? undefined : unreadWhere(filter.unread),
        search
          ? sql`(
          instr(lower(coalesce(json_extract(${posts.author}, '$.name'), json_extract(${posts.author}, '$.providerId'))), lower(${search})) > 0
          OR EXISTS (SELECT 1 FROM json_each(${posts.content}) AS block
            WHERE instr(lower(coalesce(json_extract(block.value, '$.text'), json_extract(block.value, '$.description'), '')), lower(${search})) > 0)
        )`
          : undefined,
      ),
    )
    .orderBy(...page.orderBy)
    .limit(page.limit)
    .pipe(Effect.map((rows) => rows.map(toRow)));
}

/** Exact unread Post counts across complete retained history, independently of loaded pages. @example yield* countUnreadPosts(tx, {ruleIds, after, excludeIds}); */
export function countUnreadPosts(
  tx: Tx,
  input: PostReadFilter & { readonly ruleIds: readonly string[] },
) {
  return tx
    .select({ ruleId: alertRuleId, count: sql<number>`count(*)` })
    .from(posts)
    .where(and(inArray(alertRuleId, [...input.ruleIds]), unreadWhere(input)))
    .groupBy(alertRuleId);
}

/** Read only requested Runs that have published a Post; no execution state is inferred. @example yield* findPublishedRuns(tx, runIds); */
export function findPublishedRuns(tx: Tx, runIds: readonly string[]) {
  return tx
    .selectDistinct({ runId: agentRunId })
    .from(posts)
    .where(inArray(agentRunId, [...runIds]));
}

/** Full internal CRUD; public Post surfaces are read-only. */
export const postStore: Store<Body, Filter> = {
  load: (tx, id) =>
    tx
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .get()
      .pipe(Effect.map((row) => (row ? toRow(row) : undefined))),
  list: (tx, _filter, window) => {
    const page = listWindowSql(posts, window);
    return tx
      .select()
      .from(posts)
      .where(page.where)
      .orderBy(...page.orderBy)
      .limit(page.limit)
      .pipe(Effect.map((rows) => rows.map(toRow)));
  },
  insert: (tx, input) =>
    insertPublication(
      tx,
      input,
      `internal:${input.id}`,
      createHash("sha256").update(JSON.stringify(input.body)).digest("hex"),
      [],
    ),
  save: (tx, id, input) =>
    Effect.gen(function* () {
      yield* validateMedia(tx, id, input.body);
      const row = yield* tx
        .update(posts)
        .set({ revision: input.revision, ...input.body })
        .where(eq(posts.id, id))
        .returning()
        .get();
      if (!row) return yield* Effect.die("Post update returned no row");
      return toRow(row);
    }),
  remove: (tx, id) =>
    tx.delete(posts).where(eq(posts.id, id)).pipe(Effect.asVoid),
};
