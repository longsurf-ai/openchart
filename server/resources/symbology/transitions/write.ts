// Purpose: Backend-only listing mutations; external callers cannot supply saved observations.
import type { SymbolIndexRequest } from "@openchart/feed";
import type { ProviderListing } from "@openchart/market";
import { Transition } from "@openchart/server/lib/resource";
import { writeListings } from "@openchart/server/resources/symbology/store";

/** Save successful search observations without deleting missing hits. @example Transactor.run(upsertListings(hits)); */
export const upsertListings = (hits: readonly ProviderListing[]) =>
  Transition.from((tx) => writeListings(tx, hits));
/** Reconcile only a completely fetched provider scope. @example Transactor.run(replaceScope(request, hits)); */
export const replaceScope = (
  scope: SymbolIndexRequest,
  hits: readonly ProviderListing[],
) => Transition.from((tx) => writeListings(tx, hits, scope));
