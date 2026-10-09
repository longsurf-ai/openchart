// Purpose: Compose Feed business routers and expose the overall Feed version.
import { Effect } from "effect";
import { trpc } from "@openchart/server/lib/trpc";
import { symbologyRouter } from "@openchart/server/feed/symbology/router";
import { logosRouter } from "@openchart/server/feed/logo/router";
import { calendarRouter } from "@openchart/server/feed/calendar/router";
import { seriesRouter } from "@openchart/server/feed/series/router";
import { Feed } from "./service";

/** Aggregate business RPC namespaces with the shared version endpoint. */
export const feedRouter = trpc.router({
  version: trpc.procedure.query(({ ctx, signal }) =>
    ctx.runtime.runPromise(
      Effect.flatMap(Feed, (feed) => feed.getVersion()),
      { signal },
    ),
  ),
  symbology: symbologyRouter,
  logos: logosRouter,
  calendar: calendarRouter,
  series: seriesRouter,
});
