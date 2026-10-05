// Purpose: Own the calendar Feed service contract; no source is configured yet.
import { Effect } from "effect";
import type {
  CalendarRequest,
  CalendarResult,
  FeedError,
} from "@openchart/feed";
import { unavailable } from "@openchart/server/feed/errors";

/** Calendar contract; no provider implementation is installed by the demo. */
export interface ICalendarFeedService {
  /** Resolve venue days in the requested consumer timezone.
   * @example yield* calendar.getCalendar(request);
   */
  getCalendar(
    request: CalendarRequest,
  ): Effect.Effect<CalendarResult, FeedError>;
}

/** Unavailable implementation until a Dataset adaptor is installed. */
export const calendarFeed: ICalendarFeedService = {
  getCalendar: () => Effect.fail(unavailable()),
};
