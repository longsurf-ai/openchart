// Purpose: Zod schemas for the generic notification event fan-in contract
// Module:  @openchart/chart-core / notification

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace Notification {
  export const Category = z.enum([
    "alert",
    "agent",
    "billing",
    "system",
    "job",
    "collaboration",
  ]);
  export type Category = z.infer<typeof Category>;

  export const Severity = z.enum(["info", "success", "warning", "critical"]);
  export type Severity = z.infer<typeof Severity>;

  export const Body = z.discriminatedUnion("format", [
    z.object({
      format: z.literal("plain_text"),
      text: z.string(),
    }),
    z.object({
      format: z.literal("markdown"),
      markdown: z.string(),
    }),
  ]);
  export type Body = z.infer<typeof Body>;

  export const Action = z
    .object({
      label: z.string().min(1).max(80),
      href: z.string().min(1),
      kind: z.enum(["primary", "secondary"]).optional(),
    })
    .strict();
  export type Action = z.infer<typeof Action>;

  export const CreateEvent = z
    .object({
      schemaVersion: z.literal(1),
      userId: z.string().min(1),
      category: Category,
      severity: Severity.default("info"),
      title: z.string().min(1).max(240),
      summary: z.string().max(500).optional(),
      body: Body.optional(),
      actions: z.array(Action).default([]),
      sourceType: z.string().min(1),
      sourceId: z.string().optional(),
      sourceEventId: z.string().optional(),
      idempotencyKey: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()).default({}),
      expiresAt: z.string().datetime().optional(),
    })
    .strict()
    .describe("Kafka event that requests durable notification creation.");
  export type CreateEvent = z.infer<typeof CreateEvent>;
}
