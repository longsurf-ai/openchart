// Purpose: Select a logo identifier only when every alert input refers to the same market.
import type { Listing } from "@openchart/market";
import type * as Tea from "@openchart/tea";

type SymbolInput = {
  readonly provider: string;
  readonly listing: Pick<Listing, "symbol" | "currency" | "venue" | "class">;
};

function sameSymbol(left: SymbolInput, right: SymbolInput) {
  return (
    left.provider === right.provider &&
    left.listing.symbol === right.listing.symbol &&
    left.listing.currency === right.listing.currency &&
    left.listing.venue === right.listing.venue
  );
}

/** A config node: its inputs (a followed Indicator's root has none) and its request children. */
type ConfigNode = Partial<Pick<Tea.NodeConfigEncoded, "inputs">> &
  Pick<Tea.NodeConfigEncoded, "requests">;

/** Pass an identifier to useLogo only when every Bars input of `config`, its
 * request children included, is the market `input`.
 * Qualify known asset classes; ticker parsing and alias resolution remain backend-owned.
 * Undefined disables the lookup and leaves the caller's name initial.
 * @example const identifier = alertLogoIdentifier(market, config);
 */
export function alertLogoIdentifier(
  input: SymbolInput | undefined,
  config?: ConfigNode,
): string | undefined {
  if (!input) return;
  const pending = config ? [config] : [];
  while (pending.length) {
    const node = pending.pop()!;
    for (const child of Object.values(node.inputs ?? {}))
      if (child._tag === "Bars" && !sameSymbol(input, child)) return;
    pending.push(...Object.values(node.requests));
  }
  const namespace =
    input.listing.class === "crypto"
      ? "crypto:"
      : input.listing.class === "stock" || input.listing.class === "etf"
        ? "stock:"
        : "";
  return `${namespace}${input.listing.symbol}`;
}
