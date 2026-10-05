// Purpose: Declare searchable OpenChart listings with native numeric IDs.

import { Schema } from "effect";
import { Listing } from "@openchart/market";
import { defineDataset, Layout } from "@openchart/server/data/dataset";

/** OpenChart IDs remain numeric and provider-scoped. @example openchartSymbology.name; */
export const openchartSymbology = defineDataset({
  name: "openchart.symbology",
  keys: Schema.Struct({}),
  schema: Listing,
  layout: Layout.Row,
  access: { search: true },
});
