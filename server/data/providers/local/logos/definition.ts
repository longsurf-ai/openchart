// Purpose: Declare searchable canonical logos independently of their bundled storage.
import { Schema } from "effect";
import { defineDataset, Layout } from "@openchart/server/data/dataset";

/** Search returns only confident candidates, with exact aliases taking precedence.
 * Multiple rows mean ambiguity; use a limit of at least two to resolve one logo.
 * @example yield* dataset.search({ query: "BTCUSDT", limit: 2 });
 */
export const logos = defineDataset({
  name: "openchart.logos",
  keys: Schema.Struct({}),
  schema: Schema.Struct({
    id: Schema.NonEmptyString,
    url: Schema.NonEmptyString,
  }),
  layout: Layout.Row,
  access: { search: true },
});
