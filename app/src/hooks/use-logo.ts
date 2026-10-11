// Purpose: Cache identifier-based logo requests for one Feed generation.
import type { LogoResult, ClientFailure, FeedError } from "@openchart/feed";
import type { Listing } from "@openchart/market";
import { useQuery } from "@tanstack/react-query";

import type { QueryOptions } from "./use-bars";
import { useDatafeed, useFeedVersion } from "./use-datafeed";
/** The logo identifier for one listing. Known asset classes are qualified;
 * ticker parsing and alias resolution remain backend-owned.
 * @example useLogo(listingLogoIdentifier(listing)); // "stock:AAPL"
 */
export function listingLogoIdentifier(
  listing: Pick<Listing, "symbol" | "class">,
): string {
  const namespace =
    listing.class === "crypto"
      ? "crypto:"
      : listing.class === "stock" || listing.class === "etf"
        ? "stock:"
        : "";
  return `${namespace}${listing.symbol}`;
}

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
    meta: options.silent ? { silent: true } : undefined,
  });
}
