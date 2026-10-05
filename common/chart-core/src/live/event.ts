// Purpose: Bus event definitions for chart-series lifecycle changes
// Module:  @openchart/chart-core / live

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { BusEvent } from "@openchart/chart-core/bus";

export namespace LiveEvent {
  export const MainSeriesExtended = BusEvent.define(
    "live.main_series_extended",
    z.object({
      chartId: z.string(),
      direction: z.enum(["left", "right"]),
    }),
  );
  export type MainSeriesExtended = z.infer<typeof MainSeriesExtended.schema>;

  export const SeriesRemoved = BusEvent.define(
    "live.series_removed",
    z.object({
      chartId: z.string(),
      seriesId: z.string(),
    }),
  );
  export type SeriesRemoved = z.infer<typeof SeriesRemoved.schema>;
}
