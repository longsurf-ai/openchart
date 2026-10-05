// Purpose: Cache identifier-based logo requests for one Feed generation.
import type { LogoResult, ClientFailure, FeedError } from "@openchart/feed";
import { useQuery } from "@tanstack/react-query";

import type { QueryOptions } from "./use-bars";
import { useDatafeed, useFeedVersion } from "./use-datafeed";
/** Resolve a symbol, name or domain. Undefined/blank identifiers make no request;
 * null data means no confident match, while errors remain query errors.
 * @example const { data: logo } = useLogo("BTCUSDT");
 */
export function useLogo(
  identifier: string | undefined,
  options: QueryOptions = {},
) {
  const client = useDatafeed();
  const version = useFeedVersion();
  return useQuery<LogoResult, FeedError | ClientFailure>({
    queryKey: [version, "logos", "get", identifier],
    queryFn: () => client.logos.getLogo({ identifier: identifier! }),
    enabled:
      version !== undefined &&
      !!identifier?.trim() &&
      options.enabled !== false,
    staleTime: Infinity,
  });
}
