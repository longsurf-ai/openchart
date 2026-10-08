// Purpose: Own the calendar Feed service contract independently of its sources.
import type { Effect } from "effect";
import type {
  CalendarRequest,
  CalendarResult,
  FeedError,
} from "@openchart/feed";

/** Resolve a provider listing's trading days in the requested consumer timezone. */
export interface ICalendarFeedService {
  /** Resolve venue days in the requested consumer timezone.
   * @example yield* calendar.getCalendar(request);
   */
  getCalendar(
    request: CalendarRequest,
  ): Effect.Effect<CalendarResult, FeedError>;
}
