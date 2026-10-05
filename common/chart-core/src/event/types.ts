// Purpose: Zod schemas and helpers for unified time-anchored Event records
// Module:  @openchart/chart-core / event

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ProviderListing } from "@openchart/chart-core/market/provider-listing";

export namespace Event {
  export const Type = z.enum([
    "earnings",
    "dividend",
    "split",
    "ipo",
    "filing",
    "macro",
    "news",
    "analyst",
    "generic",
  ]);
  export type Type = z.infer<typeof Type>;

  export const AgentSource = z.object({
    kind: z.literal("agent"),
    sessionId: z.string(),
    userId: z.string(),
  });
  export type AgentSource = z.infer<typeof AgentSource>;

  export const UserSource = z.object({
    kind: z.literal("user"),
    userId: z.string(),
  });
  export type UserSource = z.infer<typeof UserSource>;

  export const Source = z.discriminatedUnion("kind", [AgentSource, UserSource]);
  export type Source = z.infer<typeof Source>;

  export const Temporal = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("instant"),
      at: z.string(),
    }),
    z.object({
      kind: z.literal("range"),
      tStart: z.string(),
      tEnd: z.string(),
    }),
    z.object({
      kind: z.literal("approximate"),
      at: z.string(),
      precision: z.enum(["minute", "hour", "day", "month", "quarter", "year"]),
    }),
    z.object({
      kind: z.literal("textual"),
      text: z.string(),
      sortHint: z.string().optional(),
    }),
  ]);
  export type Temporal = z.infer<typeof Temporal>;

  export const Scope = z.object({
    dashboardId: z.string(),
    market: ProviderListing,
  });
  export type Scope = z.infer<typeof Scope>;

  export const EvidenceSourceIdentity = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("publisher") }).strict(),
    z
      .object({
        kind: z.literal("company"),
        displaySymbol: z.string().min(1),
        assetClass: z.string().min(1),
      })
      .strict(),
  ]);
  export type EvidenceSourceIdentity = z.infer<typeof EvidenceSourceIdentity>;

  export const SourceReference = z.discriminatedUnion("type", [
    z.object({ type: z.literal("document"), id: z.string().min(1) }).strict(),
    z.object({ type: z.literal("url"), url: z.string().min(1) }).strict(),
    z
      .object({
        type: z.literal("market_data"),
        id: z.string().min(1),
        title: z.string().min(1).optional(),
      })
      .strict(),
  ]);
  export type SourceReference = z.infer<typeof SourceReference>;

  export const DocumentSourcePreview = z
    .object({
      type: z.literal("document"),
      id: z.string().min(1),
      title: z.string().min(1),
      summary: z.string().nullable(),
      body: z.string().nullable(),
      publishedAt: z.string().min(1),
      publisher: z.string().min(1),
      publisherId: z.string().min(1).nullable(),
      publisherHomepageUrl: z.string().min(1).nullable(),
      sourceIdentity: EvidenceSourceIdentity,
      url: z.string().min(1).nullable(),
    })
    .strict();
  export type DocumentSourcePreview = z.infer<typeof DocumentSourcePreview>;

  export const UrlSourcePreview = z
    .object({
      type: z.literal("url"),
      url: z.string().min(1),
    })
    .strict();
  export type UrlSourcePreview = z.infer<typeof UrlSourcePreview>;

  export const MarketDataSourcePreview = z
    .object({
      type: z.literal("market_data"),
      id: z.string().min(1),
      title: z.string().min(1).optional(),
    })
    .strict();
  export type MarketDataSourcePreview = z.infer<typeof MarketDataSourcePreview>;

  export const SourcePreview = z.discriminatedUnion("type", [
    DocumentSourcePreview,
    UrlSourcePreview,
    MarketDataSourcePreview,
  ]);
  export type SourcePreview = z.infer<typeof SourcePreview>;

  export const Record = z.object({
    id: z.string(),
    scope: Scope,
    createdBy: z.string(),
    type: Type,
    source: Source,
    temporal: Temporal,
    title: z.string(),
    body: z.string().optional(),
    url: z.string().optional(),
    metadata: z.unknown().optional(),
    sourcePreviews: z.array(SourcePreview).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });
  export type Record = z.infer<typeof Record>;

  export function resolvePinAt(temporal: Temporal): string | null {
    switch (temporal.kind) {
      case "instant":
      case "approximate":
        return temporal.at;
      case "range":
        return temporal.tStart;
      case "textual":
        return temporal.sortHint ?? null;
    }
  }

  export function isPinable(temporal: Temporal): boolean {
    return resolvePinAt(temporal) !== null;
  }
}
