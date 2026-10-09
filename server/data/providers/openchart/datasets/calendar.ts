// Purpose: Expand OpenChart listing calendars with the shared calendar schedule.
import { Cache, Effect, Exit } from "effect";
import {
  DatasetFailure,
  DatasetReasons,
  type SelectQuery,
} from "@openchart/server/data/dataset";
import { selectDays } from "@openchart/server/data/providers/local/market/calendar/schedule";
import type { Client } from "@openchart/server/data/providers/openchart/contract";
import type { openchartCalendar } from "@openchart/server/data/providers/openchart/datasets/definitions";
import { openchartError } from "@openchart/server/data/providers/openchart/errors";

/** Selects day rows from each listing's calendar, read once per hour per
 * Provider activation; Cloud updates calendars at most daily and failed reads
 * are not kept. Create inside the Provider activation.
 * @example const select = yield* cachedSelectCalendar(client);
 */
export const cachedSelectCalendar = Effect.fn("OpenChart.cachedSelectCalendar")(
  function* (client: Client) {
    const calendars = yield* Cache.makeWith(
      (listing: number) =>
        client.readCalendar(listing).pipe(Effect.mapError(openchartError)),
      {
        capacity: 1024,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? "1 hour" : 0),
      },
    );
    return (query: SelectQuery<typeof openchartCalendar>) =>
      Cache.get(calendars, query.listing).pipe(
        Effect.flatMap((data) =>
          Effect.try({
            try: () =>
              selectDays(data, {
                calendar: data.calendar,
                time: query.time,
                ...(query.count === undefined ? {} : { count: query.count }),
              }).map((day) => ({ calendar: data.calendar, ...day })),
            catch: (cause) =>
              cause instanceof DatasetFailure
                ? cause
                : new DatasetFailure(new DatasetReasons.InvalidResult(), {
                    cause,
                  }),
          }),
        ),
      );
  },
);
