// Purpose: Serves one immutable Post-owned media snapshot without loading it in Feed pages.
import { Effect, Schema } from "effect";
import { Transition } from "@openchart/server/lib/resource";
import { ResourceNotFound } from "@openchart/server/lib/resource/errors";
import { PostMediaId } from "@openchart/server/resources/post/schema";
import { loadMedia } from "@openchart/server/resources/post/store";

/** Reads bytes for native media rendering or download; removed Posts remove their media. */
export const media = Transition.make({
  kind: "query",
  input: Schema.Struct({ id: PostMediaId }).annotate({
    parseOptions: { onExcessProperty: "error" },
  }),
  resolve: () => Effect.void,
  apply: (tx, input) =>
    Effect.gen(function* () {
      const item = yield* loadMedia(tx, input.id);
      if (!item)
        return yield* new ResourceNotFound({
          resource: "post_media",
          id: input.id,
        });
      return {
        id: PostMediaId.make(item.id),
        mime: item.mime,
        filename: item.filename,
        base64: item.bytes.toString("base64"),
      };
    }),
});
