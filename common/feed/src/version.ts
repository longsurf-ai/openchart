// Purpose: A scalar opaque version identifies the complete committed Feed service set.
import { Schema } from "effect";
/** Version equality identifies a Feed generation; it is neither authorization nor a market-data revision. */
export const FeedVersion = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand("FeedVersion"),
);
export type FeedVersion = typeof FeedVersion.Type;
