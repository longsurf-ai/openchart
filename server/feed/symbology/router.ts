// Purpose: Route Symbology queries to current services and propagate request cancellation.
import { Effect, Schema } from "effect";
import { SymbolSearchRequest, SymbolIndexRequest } from "@openchart/feed";
import { trpc } from "@openchart/server/lib/trpc";
import { Feed } from "@openchart/server/feed/service";

/** Business router mounted at feed.symbology by the Feed composition root. */
export const symbologyRouter = trpc.router({
  index: trpc.procedure
    .input(Schema.toStandardSchemaV1(SymbolIndexRequest))
    .mutation(({ ctx, input }) =>
      ctx.runtime.runPromise(
        Effect.gen(function* () {
          const feed = yield* Feed;
          return yield* (yield* feed.get()).symbology.index(input);
        }),
      ),
    ),
  indexStatus: trpc.procedure.query(({ ctx, signal }) =>
    ctx.runtime.runPromise(
      Effect.gen(function* () {
        const feed = yield* Feed;
        return yield* (yield* feed.get()).symbology.indexStatus();
      }),
      { signal },
    ),
  ),
  search: trpc.procedure
    .input(Schema.toStandardSchemaV1(SymbolSearchRequest))
    .query(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Effect.gen(function* () {
          const feed = yield* Feed;
          const services = yield* feed.get();
          return yield* services.symbology.search(input);
        }),
        { signal },
      ),
    ),
});
