// Purpose: Reads a bounded Post Feed and resolves current quoted Posts after pagination.
import { Effect, Schema } from "effect";
import { Transition } from "@openchart/server/lib/resource";
import { toEntity } from "@openchart/server/lib/resource/entity-operations";
import {
  DEFAULT_PAGE_SIZE,
  ListCursor,
  MAX_PAGE_SIZE,
  encodeListPage,
  listPage,
} from "@openchart/server/lib/resource/pagination";
import { PostReadFilter } from "@openchart/server/resources/post/schema";
import { AlertRuleId } from "@openchart/server/resources/alert-rule/entity";
import { PostEntity } from "@openchart/server/resources/post/entity";
import {
  listFeedPosts,
  postStore,
} from "@openchart/server/resources/post/store";

/** Newest-first publications across all origins; null quote with a non-null ID means the target was removed. */
export const feed = Transition.make({
  kind: "query",
  input: Schema.Struct({
    limit: Schema.optionalKey(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: MAX_PAGE_SIZE }),
      ),
    ),
    cursor: Schema.optionalKey(ListCursor),
    ruleId: Schema.optionalKey(AlertRuleId),
    search: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
    unread: Schema.optionalKey(PostReadFilter),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  resolve: () => Effect.void,
  apply: (tx, input) =>
    Effect.gen(function* () {
      const limit = input.limit ?? DEFAULT_PAGE_SIZE;
      const page = listPage(
        yield* listFeedPosts(
          tx,
          {
            limit: limit + 1,
            cursor: input.cursor,
            order: "desc",
          },
          input,
        ),
        limit,
      );
      const items = yield* Effect.forEach(page.items, (row) =>
        Effect.gen(function* () {
          const post = yield* toEntity("post", PostEntity, row);
          const quote = post.quotedPostId
            ? yield* postStore.load(tx, post.quotedPostId)
            : undefined;
          return {
            post,
            quotedPost: quote
              ? yield* toEntity("post", PostEntity, quote)
              : null,
          };
        }),
      );
      return encodeListPage({ items, nextCursor: page.nextCursor });
    }),
});
