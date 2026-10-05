// Purpose: Derive the Drawing Resource and reuse the core's geometry schema at the server boundary.
import { Drawing } from "@openchart/chart-core/drawing/types";
import { ProviderListing } from "@openchart/market";
import { listKey } from "@openchart/server/lib/resource/annotation";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import { DrawingId, drawingTable } from "./schema";

export { DrawingId } from "./schema";

const columns = createSelectSchema(drawingTable, {
  ...ProviderListing.fields,
  data: Drawing.SavedItem,
});

/** One independently revised drawing; listing identity is meaningful only within its provider. */
export const DrawingEntity = Schema.Struct({
  ...envelopeFields(DrawingId),
  dashboardId: listKey(columns.fields.dashboardId),
  provider: listKey(columns.fields.provider),
  listing: columns.fields.listing,
  data: columns.fields.data,
});
/** Complete persisted drawing returned by Resource reads. */
export type DrawingEntity = typeof DrawingEntity.Type;
