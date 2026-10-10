// Purpose: Read one declared timeseries, such as a Workspace Dataset, as its native DataFrame.
import { Schema } from "effect";
import { dataFrameCodec } from "@openchart/timeseries";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;

/**
 * One finite read of a series by the id its source assigned. Times are epoch
 * milliseconds: `from` is inclusive and `to` exclusive; either may be omitted.
 */
export const SeriesRequest = Schema.Struct({
  id: Schema.NonEmptyString,
  from: Schema.optionalKey(Schema.Finite),
  to: Schema.optionalKey(Schema.Finite),
}).annotate(strict);
export type SeriesRequest = typeof SeriesRequest.Type;

/** Every declared column with its labels and gaps; times strictly ascend. */
export const SeriesSnapshot = Schema.Struct({ data: dataFrameCodec }).annotate(
  strict,
);
export type SeriesSnapshot = typeof SeriesSnapshot.Type;
