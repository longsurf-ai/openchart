// Purpose: Cache server-resolved calendar windows for one Feed generation.
import type {
  ClientFailure,
  CalendarRequest,
  CalendarResult,
  FeedError,
} from "@openchart/feed";
import { providerListingKey } from "@openchart/market";
import { useQuery } from "@tanstack/react-query";

import type { QueryOptions } from "./use-bars";
import { useDatafeed, useFeedVersion } from "./use-datafeed";

/** Resolve a consumer time window. While a moved window loads, the same
 * listing's previous days stay available; another listing's never do.
 * `silent` leaves failures to the caller instead of the global error toast.
 * @example const calendar = useCalendar(request, { silent: true });
 */
export function useCalendar(
  request: CalendarRequest,
  options: QueryOptions & { readonly silent?: boolean } = {},
) {
  const client = useDatafeed();
  const version = useFeedVersion();
  const listing = providerListingKey(request);
  return useQuery<CalendarResult, FeedError | ClientFailure>({
    queryKey: [version, "calendar", "get", request],
    queryFn: () => client.calendar.getCalendar(request),
    enabled: version !== undefined && options.enabled !== false,
    staleTime: Infinity,
    meta: { silent: options.silent },
    placeholderData: (previous, query) => {
      const [previousVersion, , , previousRequest] = query?.queryKey ?? [];
      return previousVersion === version &&
        previousRequest &&
        providerListingKey(previousRequest as CalendarRequest) === listing
        ? previous
        : undefined;
    },
  });
}
