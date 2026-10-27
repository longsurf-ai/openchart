// Purpose: How a script names a listing: one `provider:symbol` ticker id, written and read by each provider's rules.
import type { Listing, ProviderListing } from "@openchart/market";

// Names listings by their provider-scoped symbol, ignoring case.
const bySymbol = {
  symbol: (listing: Listing) => listing.symbol,
  names: (symbol: string, listing: Listing) =>
    listing.symbol.toUpperCase() === symbol.toUpperCase(),
};

// TradingView lists one symbol on many venues (BITSTAMP:BTCUSD and
// COINBASE:BTCUSD), so it writes `VENUE:SYMBOL`, the symbol its bars read: an
// already qualified symbol as it is, otherwise the listing's venue before it.
// A listing with neither has no ticker id, and a symbol without a venue names
// no listing, so no venue is ever substituted.
const venueSymbol = (listing: Listing) =>
  listing.symbol.includes(":")
    ? listing.symbol
    : listing.venue
      ? `${listing.venue}:${listing.symbol}`
      : undefined;
const byVenueSymbol = {
  symbol: venueSymbol,
  names: (symbol: string, listing: Listing) =>
    venueSymbol(listing)?.toUpperCase() === symbol.toUpperCase(),
};

// How each provider writes a listing's symbol in a ticker id, and which
// listing a symbol names. Every provider's rule lives here and nowhere else;
// a provider whose listings also carry numeric ids can still be named by
// symbol. A provider without an entry has no ticker ids.
const providers: Readonly<
  Record<
    string,
    {
      readonly symbol: (listing: Listing) => string | undefined;
      readonly names: (symbol: string, listing: Listing) => boolean;
    }
  >
> = {
  binance: bySymbol,
  // OpenChart listings also carry numeric ids; scripts still name them by symbol.
  openchart: bySymbol,
  tradingview: byVenueSymbol,
  yfinance: bySymbol,
};

const rulesOf = (provider: string) =>
  Object.hasOwn(providers, provider) ? providers[provider] : undefined;

/**
 * A listing's ticker id, `<provider>:<symbol>`, the way a script names it in
 * `request.security` and reads it as `syminfo.tickerid`. TradingView's symbol
 * keeps the venue, `tradingview:<VENUE>:<SYMBOL>`. Undefined for a provider
 * without ticker ids, or a TradingView listing without a venue.
 *
 * @example tickerId({ provider: "binance", listing }); // "binance:BTCUSDT"
 * @example tickerId({ provider: "tradingview", listing }); // "tradingview:BITSTAMP:BTCUSD"
 */
export function tickerId({
  provider,
  listing,
}: ProviderListing): string | undefined {
  const symbol = rulesOf(provider)?.symbol(listing);
  return symbol === undefined ? undefined : `${provider}:${symbol}`;
}

/**
 * Read a ticker id written as `<provider>:<symbol>`: the provider (matched
 * ignoring case, so `BINANCE:BTCUSDT` works too), the symbol to search for,
 * and whether a search hit is the listing it names, ignoring case. A
 * TradingView symbol names only the listing at its venue
 * (`tradingview:BITSTAMP:BTCUSD`); without one it names none. Undefined when
 * the text has no provider or symbol, or the provider has no ticker ids.
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
