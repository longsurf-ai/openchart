// Purpose: Core live-data types — OHLCV bar, connection status, and subscription descriptor
// Module:  @openchart/chart-core / live

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { BarsSeries } from "@openchart/feed";

export namespace Live {
  export const Bar = z.object({
    time: z.number(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
    final: z.boolean().optional(),
    as_of: z.number().optional(),
    progress: z.boolean().optional(),
  });
  export type Bar = z.infer<typeof Bar>;

  export const Status = z.enum(["connected", "disconnected", "unavailable"]);
  export type Status = z.infer<typeof Status>;

  export const Subscription = BarsSeries;
  export type Subscription = typeof BarsSeries.Type;
}
