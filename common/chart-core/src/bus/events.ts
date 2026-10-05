// Purpose: Concrete event definitions for chart, series, and time-scale lifecycle and interaction
// Module:  @openchart/chart-core / bus

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Schema } from "effect";
import { BusEvent } from "./bus";
import { Data } from "@openchart/chart-core/data";

const AnnotationRect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export namespace ChartEvent {
  export const Created = BusEvent.define(
    "chart.created",
    z.object({
      id: z.string(),
    }),
  );

  export const Removed = BusEvent.define(
    "chart.removed",
    z.object({
      id: z.string(),
    }),
  );

  export const Resize = BusEvent.define(
    "chart.resize",
    z.object({
      id: z.string(),
      width: z.number(),
      height: z.number(),
    }),
  );

  export const Click = BusEvent.define(
    "chart.click",
    z.object({
      id: z.string(),
      point: z.object({ x: z.number(), y: z.number() }),
      time: z.custom<Data.Time>(Schema.is(Data.Time)).optional(),
      price: z.number().optional(),
      seriesID: z.string().optional(),
    }),
  );

  export const AnnotationHit = BusEvent.define(
    "chart.annotation.hit",
    z.object({
      id: z.string(),
      hit: z.object({
        kind: z.enum(["highlight", "marker", "chart_annotation"]),
        id: z.string(),
        part: z
          .enum(["body", "target_handle", "label_handle", "expand_button"])
          .optional(),
        expanded: z.boolean().optional(),
        bodyExpanded: z.boolean().optional(),
        bodyTruncated: z.boolean().optional(),
        anchor: z.object({ x: z.number(), y: z.number() }),
        pill: AnnotationRect.optional(),
        compactPill: AnnotationRect.optional(),
        actionButton: AnnotationRect.optional(),
      }),
    }),
  );

  export const AnnotationHover = BusEvent.define(
    "chart.annotation.hover",
    z.object({
      id: z.string(),
      hit: z
        .object({
          kind: z.enum(["highlight", "marker", "chart_annotation"]),
          id: z.string(),
          part: z
            .enum(["body", "target_handle", "label_handle", "expand_button"])
            .optional(),
          expanded: z.boolean().optional(),
          bodyExpanded: z.boolean().optional(),
          bodyTruncated: z.boolean().optional(),
          anchor: z.object({ x: z.number(), y: z.number() }),
          pill: AnnotationRect.optional(),
          compactPill: AnnotationRect.optional(),
          actionButton: AnnotationRect.optional(),
        })
        .nullable(),
    }),
  );

  export const AnnotationContextMenu = BusEvent.define(
    "chart.annotation.contextmenu",
    z.object({
      id: z.string(),
      hit: z.object({
        kind: z.enum(["highlight", "marker", "chart_annotation"]),
        id: z.string(),
        part: z
          .enum(["body", "target_handle", "label_handle", "expand_button"])
          .optional(),
        expanded: z.boolean().optional(),
        anchor: z.object({ x: z.number(), y: z.number() }),
        pill: AnnotationRect.optional(),
        compactPill: AnnotationRect.optional(),
        actionButton: AnnotationRect.optional(),
      }),
    }),
  );

  export const AnnotationEdit = BusEvent.define(
    "chart.annotation.edit",
    z.object({
      id: z.string(),
      hit: z.object({
        kind: z.literal("chart_annotation"),
        id: z.string(),
        anchor: z.object({ x: z.number(), y: z.number() }),
        pill: z.object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }),
      }),
    }),
  );

  export const ChartExplainRange = BusEvent.define(
    "chart.chart_explain.range",
    z.object({
      id: z.string(),
      selection: z.object({
        fromIndex: z.number().int(),
        toIndex: z.number().int(),
        fromTs: z.number(),
        toTs: z.number(),
      }),
      mode: z.enum(["thinking", "fast"]).optional(),
      color: z.string().optional(),
      anchor: z.object({ x: z.number(), y: z.number() }).optional(),
    }),
  );

  export const Invalidated = BusEvent.define(
    "chart.invalidated",
    z.object({
      id: z.string(),
      level: z.enum(["cursor", "light", "full"]),
    }),
  );

  export const DblClick = BusEvent.define(
    "chart.dblclick",
    z.object({
      id: z.string(),
      point: z.object({ x: z.number(), y: z.number() }),
    }),
  );

  export const Crosshair = BusEvent.define(
    "chart.crosshair",
    z.object({
      id: z.string(),
      point: z.object({ x: z.number(), y: z.number() }),
      time: z.custom<Data.Time>(Schema.is(Data.Time)).optional(),
      logicalIndex: z.number().optional(),
      values: z.record(z.string(), z.number()),
    }),
  );

  // For multi-chart crosshair synchronization
  export const CrosshairSync = BusEvent.define(
    "chart.crosshair.sync",
    z.object({
      sourceChartID: z.string(),
      time: z.custom<Data.Time>(Schema.is(Data.Time)).optional(),
      logicalIndex: z.number().optional(),
    }),
  );
}

export namespace TimeScaleEvent {
  export const VisibleRangeChanged = BusEvent.define(
    "timescale.visiblerange",
    z.object({
      chartID: z.string(),
      from: z.number(),
      to: z.number(),
    }),
  );

  export const BarSpacingChanged = BusEvent.define(
    "timescale.barspacing",
    z.object({
      chartID: z.string(),
      barSpacing: z.number(),
    }),
  );
}

export namespace SeriesEvent {
  export const Created = BusEvent.define(
    "series.created",
    z.object({
      chartID: z.string(),
      seriesID: z.string(),
      type: z.string(),
    }),
  );

  export const Removed = BusEvent.define(
    "series.removed",
    z.object({
      chartID: z.string(),
      seriesID: z.string(),
    }),
  );

  export const Data = BusEvent.define(
    "series.data",
    z.object({
      chartID: z.string(),
      seriesID: z.string(),
      action: z.enum(["set", "update", "pop"]),
      count: z.number(),
    }),
  );

  export const Options = BusEvent.define(
    "series.options",
    z.object({
      chartID: z.string(),
      seriesID: z.string(),
    }),
  );
}
