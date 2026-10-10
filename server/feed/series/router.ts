// Purpose: Parse series reads and answer them from the current Feed snapshot.
import { Effect, Schema } from "effect";
import { SeriesRequest, SeriesSnapshot } from "@openchart/feed";
import { trpc } from "@openchart/server/lib/trpc";
import { Feed } from "@openchart/server/feed/service";

/** Finite series reads share the Feed transport's cancellation and error policy;
 * the DataFrame travels in the shared timeseries codec. */
export const seriesRouter = trpc.router({
  select: trpc.procedure
    .input(Schema.toStandardSchemaV1(SeriesRequest))
    .query(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Effect.gen(function* () {
          const feed = yield* Feed;
          const data = yield* (yield* feed.get()).series.select(input);
          return yield* Schema.encodeEffect(SeriesSnapshot)({ data }).pipe(
            Effect.orDie,
          );
        }),
        { signal },
      ),
    ),
});
