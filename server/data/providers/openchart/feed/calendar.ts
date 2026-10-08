// Purpose: Adapt OpenChart listing calendars to consumer trading days.
import { Temporal } from "@js-temporal/polyfill";
import { Effect } from "effect";
import { FeedReasons, type CalendarRequest } from "@openchart/feed";
import type { ProviderId } from "@openchart/market";
import type { Dataset } from "@openchart/server/data/dataset";
import { datasetFailure, feedError } from "@openchart/server/feed/errors";
import type { ICalendarFeedService } from "@openchart/server/feed/calendar/service";
import type { openchartCalendar } from "@openchart/server/data/providers/openchart/datasets/definitions";

/** Resolve the listing's venue calendar by its numeric OpenChart ID.
 * Day labels become the venue date's midnight in the requested timezone.
 * @example const calendar = openchartCalendarFeed(dataset, providerId);
 */
export function openchartCalendarFeed(
  dataset: Dataset<typeof openchartCalendar>,
  providerId: ProviderId,
): ICalendarFeedService {
  const invalid = (detail: string) =>
    Effect.fail(feedError(new FeedReasons.InvalidRequest({ detail })));
  return {
    getCalendar: (request: CalendarRequest) => {
      if (request.listing.id === undefined)
        return invalid("OpenChart calendars require the listing's ID.");
      return dataset
        .select({
          listing: request.listing.id,
          time: { from: request.start, to: request.end },
        })
        .pipe(
          Effect.mapError(datasetFailure(providerId)),
          Effect.flatMap((rows) => {
            // A nonempty window always overlaps at least one venue date.
            if (rows.length === 0)
              return Effect.fail(
                feedError(
                  new FeedReasons.InvalidSourceData({ provider: providerId }),
                ),
              );
            let days;
            try {
              days = rows.map((row) => ({
                date: Temporal.PlainDate.from(row.date).toZonedDateTime(
                  request.timezone,
                ).epochMilliseconds,
                sessions: row.sessions,
              }));
            } catch (cause) {
              if (cause instanceof RangeError)
                return invalid(`Unknown timezone ${request.timezone}.`);
              throw cause;
            }
            return Effect.succeed({
              ...(request.listing.venue
                ? { venue: request.listing.venue }
                : {}),
              calendar: rows[0]!.calendar,
              timezone: request.timezone,
              days,
            });
          }),
        );
    },
  };
}
