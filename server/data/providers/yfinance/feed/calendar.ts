// Purpose: Adapt Yahoo trading periods to consumer trading days.
import { Temporal } from "@js-temporal/polyfill";
import { Effect } from "effect";
import { FeedReasons, type CalendarRequest } from "@openchart/feed";
import type { ProviderId } from "@openchart/market";
import type { Dataset } from "@openchart/server/data/dataset";
import { datasetFailure, feedError } from "@openchart/server/feed/errors";
import type { ICalendarFeedService } from "@openchart/server/feed/calendar/service";
import type { yfinanceCalendar } from "@openchart/server/data/providers/yfinance/datasets/definitions";

/** Resolve a Yahoo listing's trading days by its symbol. Day labels become the
 * exchange date's midnight in the requested timezone. Yahoo publishes no
 * future schedule, so days end at its current or next trading date; a window
 * entirely beyond it has no days.
 * @example const calendar = yfinanceCalendarFeed(dataset, providerId);
 */
export function yfinanceCalendarFeed(
  dataset: Dataset<typeof yfinanceCalendar>,
  providerId: ProviderId,
): ICalendarFeedService {
  return {
    getCalendar: (request: CalendarRequest) =>
      dataset
        .select({
          symbol: request.listing.symbol,
          time: { from: request.start, to: request.end },
        })
        .pipe(
          Effect.mapError(datasetFailure(providerId)),
          Effect.flatMap((rows) => {
            try {
              return Effect.succeed({
                ...(request.listing.venue
                  ? { venue: request.listing.venue }
                  : {}),
                calendar: "yfinance.tradingPeriods",
                timezone: request.timezone,
                days: rows.map((row) => ({
                  date: Temporal.PlainDate.from(row.date).toZonedDateTime(
                    request.timezone,
                  ).epochMilliseconds,
                  sessions: row.sessions,
                })),
              });
            } catch (cause) {
              if (cause instanceof RangeError)
                return Effect.fail(
                  feedError(
                    new FeedReasons.InvalidRequest({
                      detail: `Unknown timezone ${request.timezone}.`,
                    }),
                  ),
                );
              throw cause;
            }
          }),
        ),
  };
}
