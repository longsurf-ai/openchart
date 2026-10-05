// Purpose: Expose the current Feed services; versions describe availability changes only.
import { Context, type Effect } from "effect";
import type { IBarsFeedService } from "@openchart/server/feed/bar/service";
import type { ISymbologyFeedService } from "@openchart/server/feed/symbology/service";
import type { ILogosFeedService } from "@openchart/server/feed/logo/service";
import type { ICalendarFeedService } from "@openchart/server/feed/calendar/service";

/** The consumer services of one Feed version, as {@link Feed} returns them. */
export interface FeedServices {
  readonly bars: IBarsFeedService;
  readonly symbology: ISymbologyFeedService;
  readonly logos: ILogosFeedService;
  readonly calendar: ICalendarFeedService;
}

/** Current Feed version and access to its consumer services; Events carries change notifications. */
export class Feed extends Context.Service<
  Feed,
  {
    /** Read the currently committed version. @example yield* feed.getVersion(); */
    getVersion(): Effect.Effect<import("@openchart/feed").FeedVersion>;
    /** Read the current services once for a request; later replacements do not revoke them.
     * Provider and caller scopes retain ownership of requests and live sessions.
     * @example const services = yield* feed.get();
     */
    get(): Effect.Effect<FeedServices>;
  }
>()("@openchart/server/feed/Feed") {}
