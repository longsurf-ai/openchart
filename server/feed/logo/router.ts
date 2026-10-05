// Purpose: Parse logo identifiers and resolve them through the current Feed snapshot.
import { Effect, Schema } from "effect";
import { LogoRequest } from "@openchart/feed";
import { trpc } from "@openchart/server/lib/trpc";
import { Feed } from "@openchart/server/feed/service";

/** Finite logo reads share the Feed transport's cancellation and error policy. */
export const logosRouter = trpc.router({
  get: trpc.procedure
    .input(Schema.toStandardSchemaV1(LogoRequest))
    .query(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Effect.gen(function* () {
          const feed = yield* Feed;
          return yield* (yield* feed.get()).logos.getLogo(input);
        }),
        { signal },
      ),
    ),
});
