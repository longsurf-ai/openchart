// Purpose: Defines durable dashboard/listing range selection records.
// Module:  @openchart/chart-core / span

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ProviderListing } from "@openchart/chart-core/market/provider-listing";
import { Resolution } from "@openchart/chart-core/market/resolution";

export namespace Span {
  export const Mode = z.enum(["fast", "thinking"]);
  export type Mode = z.infer<typeof Mode>;

  export const Record = z
    .object({
      id: z.string().min(1),
      userId: z.string().min(1),
      dashboardId: z.string().min(1),
      market: ProviderListing,
      start: z.string().min(1),
      end: z.string().min(1),
      timezone: z.string().min(1),
      resolution: Resolution,
      mode: Mode,
      color: z.string().min(1).optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .strict();
  export type Record = z.infer<typeof Record>;

  const Selection = Record.pick({
    start: true,
    end: true,
    timezone: true,
    resolution: true,
    mode: true,
    color: true,
  });

  function endIsNotBeforeStart(input: { start: string; end: string }): boolean {
    return new Date(input.end).getTime() >= new Date(input.start).getTime();
  }

  export const CreateBody = Selection.refine(endIsNotBeforeStart, {
    message: "Span end must be at or after start",
    path: ["end"],
  }).meta({ ref: "CreateSpanBody" });
  export type CreateBody = z.infer<typeof CreateBody>;

  export const Create = z
    .object({
      dashboardId: Record.shape.dashboardId,
      market: Record.shape.market,
      ...Selection.shape,
    })
    .strict()
    .refine(endIsNotBeforeStart, {
      message: "Span end must be at or after start",
      path: ["end"],
    })
    .meta({ ref: "CreateSpanInput" });
  export type Create = z.infer<typeof Create>;
}
