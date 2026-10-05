// Purpose: Derive saved listing entities from the persistence owner and shared market vocabulary.
import { defineId } from "@openchart/identifier";
import { ProviderListing } from "@openchart/market";
import { listKey } from "@openchart/server/lib/resource/annotation";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema } from "effect";
import { symbologyTable } from "./schema";

/** Stable Resource identity, independent of provider-native IDs. */
export const SymbologyId = defineId("sym", "Symbology.ID");
const columns = createSelectSchema(symbologyTable, ProviderListing.fields);
/** Complete saved listing; generated SQL identity stays private to persistence. */
export const SymbologyEntity = Schema.Struct({
  ...envelopeFields(SymbologyId),
  provider: listKey(columns.fields.provider),
  listing: columns.fields.listing,
});
