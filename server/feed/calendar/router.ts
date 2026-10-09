// Purpose: Parse calendar requests and resolve them through the current Feed snapshot.
import { Effect, Schema } from "effect";
import { CalendarRequest } from "@openchart/feed";
import { trpc } from "@openchart/server/lib/trpc";
import { Feed } from "@openchart/server/feed/service";

/** Finite calendar reads share the Feed transport's cancellation and error policy. */
export const calendarRouter = trpc.router({
  get: trpc.procedure
    .input(Schema.toStandardSchemaV1(CalendarRequest))
    .query(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Effect.gen(function* () {
          const feed = yield* Feed;
          return yield* (yield* feed.get()).calendar.getCalendar(input);
        }),
        { signal },
      ),
    ),
});
