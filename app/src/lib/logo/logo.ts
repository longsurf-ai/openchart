// Purpose: Point listings at Elbstream's free logo CDN. Its required attribution
// lives in Settings › Data Providers; keep both together.
import type { Listing } from "@openchart/market";

/** Elbstream URL for a listing's logo. Crypto pairs use their base asset; other
 * listings use their ISIN when known, otherwise the native symbol. Unknown logos
 * 404, so `AvatarImage` falls back to the caller's initials.
 * @example logoUrl({ symbol: "BTCUSDT", class: "crypto", currency: "USDT" }); // ".../crypto/BTC"
 */
export function logoUrl(
  listing: Pick<Listing, "symbol" | "class" | "currency" | "instrument">,
): string {
  const { symbol, currency } = listing;
  const [kind, id] =
    listing.class === "crypto"
      ? [
          "crypto",
          (symbol.endsWith(currency)
            ? symbol.slice(0, -currency.length)
            : symbol
          ).replace(/[-/]$/, ""),
        ]
      : listing.instrument?.isin
        ? ["isin", listing.instrument.isin]
        : ["symbol", symbol];
  return `https://api.elbstream.com/logos/${kind}/${encodeURIComponent(id)}`;
}
