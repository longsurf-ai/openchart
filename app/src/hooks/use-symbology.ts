// Purpose: Cache finite merged searches under their committed Feed generation.
import type {
  SymbolSearchRequest,
  SymbolSearchResult,
  ClientFailure,
  FeedError,
} from "@openchart/feed";
import { useQuery } from "@tanstack/react-query";

import type { QueryOptions } from "./use-bars";
import { useDatafeed, useFeedVersion } from "./use-datafeed";
/** Search inputs participate in the complete query key. @example const search = useSymbology({query: 'Apple', limit: 20, indexed: true}); */
export function useSymbology(
  request: SymbolSearchRequest,
  options: QueryOptions = {},
) {
  const client = useDatafeed();
  const version = useFeedVersion();
  return useQuery<SymbolSearchResult, FeedError | ClientFailure>({
    queryKey: [version, "symbology", "search", request],
    queryFn: () => client.symbology.search(request),
    // Choosing a live search must contact providers even if this key was used recently.
    ...(request.indexed ? {} : { staleTime: 0 }),
    enabled: version !== undefined && options.enabled !== false,
  });
}
