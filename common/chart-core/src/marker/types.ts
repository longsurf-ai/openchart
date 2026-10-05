// Purpose: Zod schemas and types for chart strip Marker records
// Module:  @openchart/chart-core / marker

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ProviderListing } from "@openchart/chart-core/market/provider-listing";

export namespace Marker {
  export const Type = z.literal("earnings");
  export type Type = z.infer<typeof Type>;

  export const EarningsReportTime = z.enum([
    "bmo",
    "amc",
    "during_market",
    "unknown",
  ]);
  export type EarningsReportTime = z.infer<typeof EarningsReportTime>;

  export const Base = z.object({
    id: z.string(),
    dashboardId: z.string(),
    market: ProviderListing,
    at: z.string(),
    colorOverride: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });
  export type Base = z.infer<typeof Base>;

  export const EarningsTranscript = z.object({
    articleId: z.string(),
    callDate: z.string(),
  });
  export type EarningsTranscript = z.infer<typeof EarningsTranscript>;

  // @agent invariant: Earnings markers are read-only projections of provider
  // earnings result rows; do not model them as chart annotations or bookmarks.
  export const Earnings = Base.extend({
    type: z.literal("earnings"),
    earningsReportId: z.string(),
    reportDate: z.string(),
    reportTime: EarningsReportTime,
    fiscalYear: z.number().int().nullable(),
    fiscalQuarter: z.number().int().min(1).max(4).nullable(),
    periodEnd: z.string().nullable(),
    epsActual: z.number().nullable(),
    epsEstimate: z.number().nullable(),
    epsSurprise: z.number().nullable(),
    epsSurprisePercent: z.number().nullable(),
    revenueActual: z.number().nullable(),
    revenueEstimate: z.number().nullable(),
    revenueSurprise: z.number().nullable(),
    revenueSurprisePercent: z.number().nullable(),
    transcript: EarningsTranscript.nullable(),
  });
  export type Earnings = z.infer<typeof Earnings>;

  export const Record = Earnings;
  export type Record = z.infer<typeof Record>;
}
