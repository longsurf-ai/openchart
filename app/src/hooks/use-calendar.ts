// Purpose: Cache server-resolved calendar windows for one Feed generation.
import type {
  CalendarRequest,
  CalendarResult,
  ClientFailure,
  FeedError,
} from "@openchart/feed";
import { useQuery } from "@tanstack/react-query";

import type { QueryOptions } from "./use-bars";
import { useDatafeed, useFeedVersion } from "./use-datafeed";
/** Resolve a consumer time window. @example const calendar = useCalendar(request); */
export function useCalendar(
  request: CalendarRequest,
  options: QueryOptions = {},
) {
  const client = useDatafeed();
  const version = useFeedVersion();
  return useQuery<CalendarResult, FeedError | ClientFailure>({
    queryKey: [version, "calendar", "get", request],
    queryFn: () => client.calendar.getCalendar(request),
    enabled: version !== undefined && options.enabled !== false,
  });
}
