// Purpose: How a script names a listing: one `provider:symbol` ticker id, written and read by each provider's rules.
import type { Listing, ProviderListing } from "@openchart/market";

// Names listings by their provider-scoped symbol, ignoring case.
const bySymbol = {
  symbol: (listing: Listing) => listing.symbol,
  names: (symbol: string, listing: Listing) =>
    listing.symbol.toUpperCase() === symbol.toUpperCase(),
};

// How each provider writes a listing's symbol in a ticker id, and which
// listing a symbol names. Every provider's rule lives here and nowhere else;
// a provider whose listings also carry numeric ids can still be named by
// symbol. A provider without an entry has no ticker ids.
const providers: Readonly<
  Record<
    string,
    {
      readonly symbol: (listing: Listing) => string;
      readonly names: (symbol: string, listing: Listing) => boolean;
    }
  >
> = {
  binance: bySymbol,
  // OpenChart listings also carry numeric ids; scripts still name them by symbol.
  openchart: bySymbol,
  yfinance: bySymbol,
};

const rulesOf = (provider: string) =>
  Object.hasOwn(providers, provider) ? providers[provider] : undefined;

/**
 * A listing's ticker id, `<provider>:<symbol>`, the way a script names it in
 * `request.security` and reads it as `syminfo.tickerid`. Undefined for a
 * provider without ticker ids.
 *
 * @example tickerId({ provider: "binance", listing }); // "binance:BTCUSDT"
 */
export function tickerId({
  provider,
  listing,
}: ProviderListing): string | undefined {
  const rules = rulesOf(provider);
  return rules && `${provider}:${rules.symbol(listing)}`;
}

/**
 * Read a ticker id written as `<provider>:<symbol>`: the provider (matched
 * ignoring case, so `BINANCE:BTCUSDT` works too), the symbol to search for,
 * and whether a search hit is the listing it names. Undefined when the text
 * has no provider or symbol, or the provider has no ticker ids.
 *
 * @example
 * const ticker = parseTickerId("binance:ETHUSDT");
 * hits.filter(ticker.names); // the one ETHUSDT listing on Binance
 */
export function parseTickerId(text: string) {
  const separator = text.indexOf(":");
  if (separator <= 0 || separator === text.length - 1) return undefined;
  const provider = text.slice(0, separator).toLowerCase();
  const symbol = text.slice(separator + 1);
  const rules = rulesOf(provider);
  return (
    rules && {
      provider,
      symbol,
      names: (hit: ProviderListing) =>
        hit.provider === provider && rules.names(symbol, hit.listing),
    }
  );
}
