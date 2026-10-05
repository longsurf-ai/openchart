// Purpose: Register the read-only listing Resource and export trusted backend mutations.
import { defineResource } from "@openchart/server/lib/resource/definition";
import {
  counts,
  search,
} from "@openchart/server/resources/symbology/transitions/read";
import { SymbologyEntity } from "./entity";
import { symbologyStore } from "./store";
export {
  upsertListings,
  replaceScope,
} from "@openchart/server/resources/symbology/transitions/write";
/** Public reads only; provider observations enter through backend-only transitions. */
export const symbologyResource = defineResource({
  name: "symbology",
  description:
    "A saved market listing from a specific provider, including its native symbol and available listing metadata. Use it to discover provider-specific instruments for charts, alerts, and market-data requests.",
  readOnly: true,
  entity: SymbologyEntity,
  store: symbologyStore,
  transitions: { search, counts },
});
