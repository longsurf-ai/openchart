// Purpose: Tests click-versus-drag interaction semantics for canvas annotation pills.
// Module:  @openchart/chart-core / v2 / api

import { Schema } from "effect";
import { Drawing } from "@openchart/chart-core/drawing/types";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
// @vitest-environment jsdom

import { ProviderListing } from "@openchart/chart-core/market/provider-listing";
import { describe, expect, it } from "vitest";
import { Bus, ChartEvent } from "@openchart/chart-core/bus";
import { TextCache } from "@openchart/chart-core/cache";
import { Chart } from "@openchart/chart-core/chart/state";
import {
  ChartAnnotation,
  type AnnotationPlacement,
} from "@openchart/chart-core/annotation";
import { createState } from "@openchart/chart-core/v2/state/defaults";
import { getAxis, ordinalIndexToX } from "@openchart/chart-core/v2/x-scale";
import { setupEvents, type RuntimeState } from "./events";

function createCanvas(): HTMLCanvasElement {
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
  return canvas;
}

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
    label: "Long annotation label",
    sentiment: 0,
    priorityScore: 0,
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

function placement(record: ChartAnnotation.Renderable): AnnotationPlacement {
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
      sourceBadges: [{ id: "source_1", label: "NVIDIA" }],
      sourceSlotWidth: 30,
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

describe("annotation pill click", () => {
  it.each(["legacy", "drawing"])(
    "expands a %s pill and resets full-body disclosure when leaving and reopening",
    (owner) => {
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
      if (owner === "drawing") {
        ChartStateModel.upsertDrawingObject(
          state,
          Drawing.create("annotation", [], {
            id: record.id,
            time: record.anchor.start,
            title: record.label,
            body: "Evidence-backed explanation.",
            sources: [],
            sentiment: 0,
          }),
        );
      } else {
        state.annotations = [record];
        state.expandedCardsByAnnotationId = {
          [record.id]: {
            title: "Explanation",
            content: "Evidence-backed explanation.",
            questions: [],
          },
        };
      }
      const compactPlacement = placement(
        ChartStateModel.annotationItems(state)[0]!,
      );

      const canvas = createCanvas();
      const layout = Chart.computeLayout(state.config);
      const ctx = {
        measureText: (text: string) => ({
          width: text.length * 7,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        }),
      } as CanvasRenderingContext2D;
      const runtime: RuntimeState = {
        canvas,
        ctx,
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
        annotationPlacements: [compactPlacement],
        annotationHitPlacements: [compactPlacement],
        annotationHitPlacementsSignature: {},
        disposed: false,
      };
      const cleanup = setupEvents({
        canvas,
        getState: () => state,
        setState: (mutator) => mutator(state),
        getRuntime: () => runtime,
        scheduleRender: () => {},
      });

      canvas.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 188,
          clientY: 104,
          bubbles: true,
          buttons: 1,
        }),
      );
      expect(state.activeAnnotationId).toBe(record.id);
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          clientX: 188,
          clientY: 104,
          bubbles: true,
        }),
      );

      expect(state.expandedAnnotation).toEqual({
        id: record.id,
        body: "preview",
      });
      state.expandedAnnotation = { id: record.id, body: "full" };
      canvas.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 780, clientY: 580 }),
      );
      expect(state.expandedAnnotation).toBeUndefined();
      canvas.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 188,
          clientY: 104,
          buttons: 1,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", { clientX: 188, clientY: 104 }),
      );
      expect(state.expandedAnnotation).toEqual({
        id: record.id,
        body: "preview",
      });
      cleanup();
    },
  );

  it("publishes annotation context menu hits from pill body right-clicks", () => {
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
    const compactPlacement = placement(record);
    state.annotations = [record];

    const canvas = createCanvas();
    const layout = Chart.computeLayout(state.config);
    const ctx = {
      measureText: (text: string) => ({
        width: text.length * 7,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
      }),
    } as CanvasRenderingContext2D;
    const runtime: RuntimeState = {
      canvas,
      ctx,
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
      annotationPlacements: [compactPlacement],
      annotationHitPlacements: [compactPlacement],
      annotationHitPlacementsSignature: {},
      disposed: false,
    };
    const cleanup = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
    });
    let published:
      | {
          id: string;
          hit: {
            kind: string;
            id: string;
            part?: string;
            anchor: { x: number; y: number };
          };
        }
      | undefined;
    const unsubscribe = Bus.subscribe<typeof published>(
      ChartEvent.AnnotationContextMenu,
      (event) => {
        published = event;
      },
    );

    const event = new MouseEvent("contextmenu", {
      clientX: 188,
      clientY: 104,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(published?.id).toBe("chart");
    expect(published?.hit).toMatchObject({
      kind: "chart_annotation",
      id: record.id,
      part: "body",
      anchor: { x: 188, y: 104 },
    });
    unsubscribe();
    cleanup();
  });

  it.each(["legacy", "drawing", "card", "locked", "dispose", "escape"])(
    "handles %s label dragging into right-side chart whitespace",
    (owner) => {
      const state = createState({
        id: "chart",
        series: {
          main: {
            type: "Line",
            data: Array.from({ length: 6 }, (_, index) => ({
              time: 1_714_521_600 + index * 86_400,
              value: 100 + index,
            })),
          },
        },
      });
      const axis = getAxis(state.config.xAxis, state.config.xAxis.activeId);
      axis.spacing.barSpacing = 42;
      axis.spacing.rightOffset = 220;

      const record = annotation();
      if (owner === "legacy") state.annotations = [record];
      else
        ChartStateModel.upsertDrawingObject(
          state,
          Drawing.create("annotation", [], {
            id: record.id,
            time: record.anchor.start,
            title: record.label,
            body: "Evidence-backed explanation.",
            sources: [],
            sentiment: 0,
            locked: owner === "locked",
          }),
        );
      const compactPlacement = placement(
        ChartStateModel.annotationItems(state)[0]!,
      );
      if (owner === "card") {
        state.expandedAnnotation = { id: record.id, body: "preview" };
        state.hoveredAnnotationId = record.id;
      }
      const canvas = createCanvas();
      const layout = Chart.computeLayout(state.config);
      const lastX =
        layout.areaX +
        ordinalIndexToX(state.config, axis, layout.areaWidth, 6, 5);
      const dragX = Math.min(layout.areaX + layout.areaWidth - 20, lastX + 120);
      const ctx = {
        measureText: (text: string) => ({
          width: text.length * 7,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        }),
      } as CanvasRenderingContext2D;
      const runtime: RuntimeState = {
        canvas,
        ctx,
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
        annotationPlacements: [compactPlacement],
        annotationHitPlacements: [compactPlacement],
        annotationHitPlacementsSignature: {},
        disposed: false,
      };

      let patch:
        | Parameters<
            NonNullable<
              Parameters<typeof setupEvents>[0]["onUpdateChartAnnotation"]
            >
          >[2]
        | undefined;
      const cleanup = setupEvents({
        canvas,
        getState: () => state,
        setState: (mutator) => mutator(state),
        getRuntime: () => runtime,
        scheduleRender: () => {},
        onUpdateChartAnnotation: (_state, _annotationId, next) => {
          patch = next;
        },
      });
      const center = compactPlacement.handles.label;
      if (owner === "card")
        cleanup.beginAnnotationDrag(record.id, { x: center.x, y: center.y });
      else
        canvas.dispatchEvent(
          new MouseEvent("mousedown", {
            clientX: center.x,
            clientY: center.y,
            bubbles: true,
            buttons: 1,
          }),
        );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: dragX,
          clientY: center.y,
          bubbles: true,
          buttons: 1,
        }),
      );
      const beforeRelease = ChartStateModel.drawingItems(state)[0];
      expect(
        beforeRelease?.type === "annotation"
          ? beforeRelease.labelAnchor
          : undefined,
      ).toBeUndefined();
      expect(patch).toBeUndefined();
      if (owner === "locked")
        expect(runtime.annotationDragPreview).toBeUndefined();
      else
        expect(runtime.annotationDragPreview?.anchor.labelAnchor).toBeDefined();
      if (owner === "dispose") cleanup();
      if (owner === "escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          clientX: dragX,
          clientY: center.y,
          bubbles: true,
          buttons: 0,
        }),
      );

      expect(dragX).toBeGreaterThan(lastX);
      if (owner === "legacy")
        expect(patch?.anchor?.labelAnchor?.time).toBeGreaterThan(1_714_953_600);
      else {
        const saved = ChartStateModel.drawingItems(state)[0];
        expect(saved?.type).toBe("annotation");
        if (saved?.type !== "annotation") throw new Error("Missing annotation");
        expect(saved.time).toBe(record.anchor.start);
        expect(saved.anchors).toEqual([]);
        if (owner === "locked" || owner === "dispose" || owner === "escape")
          expect(saved.labelAnchor).toBeUndefined();
        else {
          expect(saved.labelAnchor?.time).toBeGreaterThan(1_714_953_600);
          const reopened = createState({ id: "reopened" });
          ChartStateModel.upsertDrawingObject(
            reopened,
            Schema.decodeUnknownSync(Drawing.SavedItem)(
              JSON.parse(JSON.stringify(saved)),
            ),
          );
          expect(
            ChartStateModel.annotationItems(reopened)[0]?.anchor.labelAnchor,
          ).toEqual(saved.labelAnchor);
        }
        expect(state.expandedAnnotation).toEqual(
          owner === "card" ? { id: record.id, body: "preview" } : undefined,
        );
      }
      expect(runtime.annotationDragPreview).toBeUndefined();
      cleanup();
    },
  );

  it("preserves agent-owned target time before source badges are ready", () => {
    const state = createState({
      id: "chart",
      series: {
        main: {
          type: "Line",
          data: [
            { time: 1_714_521_600, value: 100 },
            { time: 1_714_608_000, value: 101 },
            { time: 1_714_694_400, value: 102 },
          ],
        },
      },
    });
    const record = annotation();
    const basePlacement = placement(record);
    const compactPlacement: AnnotationPlacement = {
      ...basePlacement,
      appearance: {
        ...basePlacement.appearance,
        sourceBadges: [],
        sourceSlotWidth: 0,
      },
    };
    state.annotations = [record];
    state.activeAnnotationId = record.id;
    state.agentAnnotationIds = { [record.id]: true };

    const canvas = createCanvas();
    const layout = Chart.computeLayout(state.config);
    const ctx = {
      measureText: (text: string) => ({
        width: text.length * 7,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
      }),
    } as CanvasRenderingContext2D;
    const runtime: RuntimeState = {
      canvas,
      ctx,
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
            extent: [0, 2],
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
      annotationPlacements: [compactPlacement],
      annotationHitPlacements: [compactPlacement],
      annotationHitPlacementsSignature: {},
      disposed: false,
    };

    let patch:
      | Parameters<
          NonNullable<
            Parameters<typeof setupEvents>[0]["onUpdateChartAnnotation"]
          >
        >[2]
      | undefined;
    const cleanup = setupEvents({
      canvas,
      getState: () => state,
      setState: (mutator) => mutator(state),
      getRuntime: () => runtime,
      scheduleRender: () => {},
      onUpdateChartAnnotation: (_state, _annotationId, next) => {
        patch = next;
      },
    });
    const target = compactPlacement.handles.target;
    canvas.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: target.x,
        clientY: target.y,
        bubbles: true,
        buttons: 1,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: target.x + 120,
        clientY: target.y,
        bubbles: true,
        buttons: 1,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX: target.x + 120,
        clientY: target.y,
        bubbles: true,
        buttons: 0,
      }),
    );

    expect(patch?.anchor?.start).toBe(record.anchor.start);
    expect(patch?.anchor?.targetAnchor?.time).toBe(record.anchor.start);
    cleanup();
  });
});
