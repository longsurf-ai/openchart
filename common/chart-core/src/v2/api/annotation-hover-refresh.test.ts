// Purpose: Verifies renderer-to-DOM hover geometry refresh for expanded annotation cards.
// Module:  @openchart/chart-core / v2 / api

import { Schema } from "effect";
// @vitest-environment jsdom

import { ProviderListing } from "@openchart/chart-core/market/provider-listing";
import { describe, expect, it } from "vitest";
import { Bus, ChartEvent } from "@openchart/chart-core/bus";
import { TextCache } from "@openchart/chart-core/cache";
import { Chart } from "@openchart/chart-core/chart/state";
import {
  ChartAnnotation,
  type ChartAnnotationHit,
  type AnnotationPlacement,
} from "@openchart/chart-core/annotation";
import { createState } from "@openchart/chart-core/v2/state/defaults";
import { setupEvents, type RuntimeState } from "./events";

function annotation(): ChartAnnotation.Record {
  return {
    id: "ann_1",
    userId: "user_1",
    dashboardId: "dashboard_1",
    market: ProviderListing.parse({
      provider: "test",
      listing: { symbol: "AAPL", currency: "USD" },
    }),
    spanId: null,
    materializedByAgentRunId: null,
    materializationKey: null,
    eventId: "event_1",
    label: "Siri setbacks amplified a tech-led selloff",
    sentiment: -1,
    priorityScore: 1,
    anchor: { start: Date.parse("2026-05-01T00:00:00.000Z") / 1000 },
    style: Schema.decodeUnknownSync(ChartAnnotation.Style)({}),
    visibility: "visible",
    feedback: null,
    revision: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function compactPlacement(record: ChartAnnotation.Record): AnnotationPlacement {
  const pill = { x: 180, y: 90, width: 180, height: 28 };
  const label = { x: pill.x + pill.width / 2, y: pill.y + pill.height / 2 };
  return {
    annotation: record,
    anchor: { x: 220, y: 220 },
    leader: { from: label, to: { x: 220, y: 220 } },
    handles: { target: { x: 220, y: 220 }, label },
    pill,
    hit: pill,
    text: record.label,
    fullText: record.label,
    zIndex: 0,
    layer: 0,
    state: "compact",
    appearance: {
      font: "12px system-ui, sans-serif",
      height: 28,
      radius: 14,
      paddingX: 12,
      sourceBadges: [],
      sourceSlotWidth: 0,
      textGapAfterSources: 8,
      textEndGap: 8,
      minWidth: 34,
      compactTextMaxWidth: 180,
      expandedCardWidth: 420,
      expandedCardHeight: 340,
      expandedCardMinWidth: 300,
      expandedCardMinHeight: 176,
      leaderTargetGap: 9,
      targetDotRadius: 4,
      selectedHandleRadius: 5,
    },
  };
}

describe("expanded annotation hover geometry refresh", () => {
  it("publishes changed renderer geometry and expanded-body ownership once", () => {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Line",
          data: [
            { time: 1_714_521_600, value: 100 },
            { time: 1_714_608_000, value: 101 },
          ],
        },
      },
    });
    const record = annotation();
    const placement = compactPlacement(record);
    state.annotations = [record];
    state.agentAnnotationIds = { [record.id]: true };
    state.hoveredAnnotationId = record.id;
    state.activeAnnotationId = record.id;
    state.expandedAnnotation = { id: record.id, body: "preview" };
    const body =
      "Reports that Apple’s delayed Siri overhaul encountered further obstacles before a sharp decline. The broader market also fell, but Apple’s substantially larger move points to an added company-specific concern.";
    state.expandedCardsByAnnotationId = {
      [record.id]: {
        title: record.label,
        content: body,
        questions: ["What changed?"],
      },
    };

    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    const layout = Chart.computeLayout(state.config);
    const runtime: RuntimeState = {
      canvas,
      ctx: {
        measureText: (text: string) => ({
          width: text.length * 7,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        }),
      } as CanvasRenderingContext2D,
      ratio: 1,
      textCache: TextCache.create(),
      labelCache: {} as RuntimeState["labelCache"],
      renderCache: {} as RuntimeState["renderCache"],
      xCache: { positions: [], version: 0, offset: 0 },
      coord: {
        type: "cartesian",
        bounds: {
          x: layout.areaX,
          y: 0,
          width: layout.areaWidth,
          height: layout.areaHeight,
        },
        scales: {
          x: {
            extent: [0, 1],
            range: [layout.areaX, layout.areaX + layout.areaWidth],
            mode: "linear",
          },
          y: {
            right: {
              extent: [90, 110],
              range: [layout.areaHeight, 0],
              mode: "linear",
            },
          },
        },
        defaultYScale: "right",
      },
      panePrimitives: {} as RuntimeState["panePrimitives"],
      seriesPrimitives: new Map(),
      annotationPlacements: [placement],
      annotationHitPlacements: [placement],
      annotationHitPlacementsSignature: {},
      disposed: false,
    };
    const controller = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
    });
    const hits: ChartAnnotationHit[] = [];
    const unsubscribe = Bus.subscribe<{
      id: string;
      hit: ChartAnnotationHit | null;
    }>(ChartEvent.AnnotationHover, (event) => {
      if (event.id === state.id && event.hit) hits.push(event.hit);
    });

    controller.refreshExpandedAnnotationHoverGeometry();
    const initialHeight = hits.at(-1)?.pill.height;
    expect(initialHeight).toBeDefined();
    expect(hits.at(-1)?.bodyExpanded).toBeUndefined();

    // Keep the last painted preview while disclosure changes before the next paint.
    const preview = hits[0]!;
    runtime.annotationHitPlacements = [
      {
        ...placement,
        state: "expanded",
        pill: preview.pill,
        hit: preview.pill,
      },
    ];
    runtime.annotationHitPlacementsSignature = {
      hoveredAnnotationId: record.id,
      activeAnnotationId: record.id,
      expandedAnnotation: { ...state.expandedAnnotation },
    };

    state.expandedAnnotation = { id: record.id, body: "full" };
    controller.refreshExpandedAnnotationHoverGeometry();

    expect(hits).toHaveLength(2);
    expect(hits[1]?.bodyExpanded).toBe(true);
    expect(hits[1]?.pill.height).toBeGreaterThan(initialHeight!);

    controller.refreshExpandedAnnotationHoverGeometry();
    expect(hits).toHaveLength(2);

    const full = hits[1]!;
    const bottom = full.pill.y + full.pill.height - 5;
    expect(bottom).toBeGreaterThan(preview.pill.y + preview.pill.height);
    canvas.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: full.pill.x + 20,
        clientY: bottom,
      }),
    );
    expect(state.expandedAnnotation).toEqual({ id: record.id, body: "full" });
    expect(hits.at(-1)).toMatchObject({ bodyExpanded: true, pill: full.pill });

    unsubscribe();
    controller();
  });
});
