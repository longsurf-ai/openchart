// Purpose: Shared projection from transient annotation creation state into renderable annotation records
// Module:  @openchart/chart-core / annotation

import { Schema } from "effect";
import { ChartAnnotation } from "./types";

export function createDraftAnnotationRecord(input: {
  id: string;
  label: string;
  anchor: ChartAnnotation.Anchor;
  now?: string;
}): Omit<ChartAnnotation.Record, "market"> {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    userId: "annotation-draft",
    dashboardId: "annotation-draft",
    spanId: null,
    materializedByAgentRunId: null,
    materializationKey: null,
    eventId: "annotation-draft",
    label: input.label || "Annotation",
    sentiment: 0,
    priorityScore: Number.MAX_SAFE_INTEGER,
    anchor: input.anchor,
    style: Schema.decodeUnknownSync(ChartAnnotation.Style)({}),
    visibility: "visible",
    feedback: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}
