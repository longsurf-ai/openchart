// Purpose: Declare OpenChart bar observations and price bases.
import { Schema } from "effect";
import { SessionType } from "@openchart/market";
import { defineDataset, k, Layout } from "@openchart/server/data/dataset";
import {
  OpenChartResolution,
  OpenChartAdjustment,
  openchartBar,
} from "@openchart/server/data/providers/openchart/contract";
/** Explicit session coverage shared by historical and live OpenChart bars. @example openchartBars.name; */
export const openchartBars = defineDataset({
  name: "openchart.bars",
  keys: Schema.Struct({
    listing: k.eq(Schema.Int.check(Schema.isGreaterThan(0))),
    resolution: k.eq(OpenChartResolution),
    session: k.eq(SessionType),
    adjustment: k.eq(OpenChartAdjustment),
    time: k.range(Schema.Int),
  }),
  schema: openchartBar,
  layout: Layout.Timeseries,
  access: { select: true, stream: true },
});
