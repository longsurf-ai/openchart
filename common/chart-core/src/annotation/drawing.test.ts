// Purpose: Verify annotation Drawings feed the existing layout, hit testing and repaint pipeline.
import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { TextCache } from "@openchart/chart-core/cache";
import { Drawing, type RenderContext } from "@openchart/chart-core/drawing";
import { renderToBuffer } from "@openchart/chart-core/headless";
import { createState } from "@openchart/chart-core/v2/state/defaults";
import { ChartStateModel } from "@openchart/chart-core/v2/state/model";
import { annotationFromDrawing } from "./drawing";
import {
  layoutChartAnnotations,
  expandChartAnnotationPlacements,
} from "./layout";
import { hitChartAnnotationPlacements } from "./hit";

describe("annotation Drawing projection", () => {
  it("lays out, expands and removes a drawing without separate annotation records", () => {
    const data = Array.from({ length: 40 }, (_, i) => ({
      time: 1789992000 + i * 86400,
      open: 100 + i,
      high: 110 + i,
      low: 95 + i,
      close: 105 + i,
    }));
    const state = createState({
      id: "annotation",
      series: { main: { type: "Candlestick", data } },
    });
    const original = renderToBuffer(state, {
      width: 800,
      height: 600,
      ratio: 1,
    });
    const item = Drawing.create("annotation", [], {
      time: data[20]!.time,
      title: "Earnings",
      body: "Revenue rose.",
      sources: [{ title: "Report", url: "https://example.com/report" }],
      sentiment: 0.5,
    });
    ChartStateModel.upsertDrawingObject(state, item);
    const annotations = ChartStateModel.annotationItems(state);
    expect(state.annotations).toEqual([]);
    expect(annotations[0]).not.toHaveProperty("eventId");
    expect(
      renderToBuffer(state, { width: 800, height: 600, ratio: 1 }),
    ).not.toEqual(original);
    const render: RenderContext = {
      coord: {
        type: "cartesian2d",
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        defaultYScale: "right",
        scales: {
          x: { extent: [0, 39], range: [10, 790], mode: "linear" },
          y: { right: { extent: [80, 160], range: [600, 0], mode: "linear" } },
        },
      },
      data,
      xPositions: data.map((_, i) => 10 + i * 20),
      xFn: (i) => 10 + i * 20,
      visibleRange: { from: 0, to: 39 },
      area: { x: 0, y: 0, width: 800, height: 600 },
    };
    const input = {
      ctx: {
        measureText: (text: string) => ({ width: text.length * 7 }),
      } as CanvasRenderingContext2D,
      textCache: TextCache.create(),
      render,
      annotations,
    };
    const compact = layoutChartAnnotations(input);
    expect(compact).toHaveLength(1);
    const badges = [
      {
        id: "https://example.com/report",
        label: "Report",
        logoUrl: "data:image/png;base64,AA==",
      },
    ];
    const decorated = layoutChartAnnotations({
      ...input,
      sourceBadgesByAnnotationId: { [item.id]: badges },
    });
    expect(decorated[0]?.appearance.sourceBadges).toEqual(badges);
    expect(compact[0]?.appearance.sourceBadges?.[0]?.logoUrl).toBeUndefined();
    const expanded = expandChartAnnotationPlacements(
      {
        ...input,
        expandedAnnotation: { id: item.id, body: "preview" },
      },
      compact,
    );
    expect(expanded[0]?.expandedContent?.content).toBe("Revenue rose.");
    const pill = expanded[0]!.pill;
    expect(
      hitChartAnnotationPlacements({
        placements: expanded,
        pointer: { x: pill.x + 20, y: pill.y + 20 },
      }),
    ).toMatchObject({ id: item.id, expanded: true });
    state.expandedAnnotation = { id: item.id, body: "preview" };
    state.hoveredAnnotationId = item.id;
    ChartStateModel.removeDrawingObject(state, item.id);
    expect(ChartStateModel.annotationItems(state)).toEqual([]);
    expect(state.expandedAnnotation).toBeUndefined();
    expect(
      renderToBuffer(state, { width: 800, height: 600, ratio: 1 }),
    ).toEqual(original);
  });

  it("projects the exact event seconds without converting its representation", () => {
    const item = Drawing.create("annotation", [], {
      time: 1775534400.125,
      title: "News",
      body: "Details.",
      sources: [],
      sentiment: 0,
    });
    if (item.type !== "annotation") throw new Error("Expected annotation");
    expect(annotationFromDrawing(item).anchor.start).toBe(item.time);
  });

  it("keeps the saved event instant while daily, weekly and monthly bars contain it", () => {
    const seconds = (date: string) => Date.parse(date) / 1000;
    // Friday is nearer next Monday, but belongs to the current weekly bar.
    const item = Schema.decodeUnknownSync(Drawing.SavedItem)(
      JSON.parse(
        JSON.stringify(
          Drawing.create("annotation", [], {
            time: seconds("2026-04-10T16:00:00Z"),
            title: "PANW catalyst",
            body: "Research",
            sources: [],
            sentiment: 0,
          }),
        ),
      ),
    );
    if (item.type !== "annotation") throw new Error("Expected annotation");
    const original = JSON.stringify(item);
    for (const times of [
      ["2026-04-09T04:00:00Z", "2026-04-10T04:00:00Z", "2026-04-13T04:00:00Z"],
      ["2026-03-30T04:00:00Z", "2026-04-06T04:00:00Z", "2026-04-13T04:00:00Z"],
      ["2026-03-01T05:00:00Z", "2026-04-01T04:00:00Z", "2026-05-01T04:00:00Z"],
    ]) {
      const data = times.map((time) => ({
        time: seconds(time),
        open: 100,
        high: 110,
        low: 90,
        close: 105,
      }));
      const state = createState({
        id: "period",
        series: { main: { type: "Candlestick", data } },
      });
      const options = { width: 800, height: 600, ratio: 1 };
      const before = renderToBuffer(state, options);
      ChartStateModel.upsertDrawingObject(state, item);
      expect(renderToBuffer(state, options)).not.toEqual(before);
      const render: RenderContext = {
        coord: {
          type: "cartesian2d",
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          defaultYScale: "right",
          scales: {
            x: { extent: [0, 2], range: [200, 600], mode: "linear" },
            y: {
              right: { extent: [80, 120], range: [600, 0], mode: "linear" },
            },
          },
        },
        data,
        xPositions: [200, 400, 600],
        xFn: (i) => 200 + i * 200,
        visibleRange: { from: 0, to: 3 },
        area: { x: 0, y: 0, width: 800, height: 600 },
      };
      const input = {
        ctx: {
          measureText: (text: string) => ({ width: text.length * 7 }),
        } as CanvasRenderingContext2D,
        textCache: TextCache.create(),
        render,
      };
      for (const [time, index] of [
        [data[0]!.time, 0],
        [data[1]!.time, 1],
        [item.time, 1],
        [data[2]!.time, 2],
      ] as const) {
        const placements = layoutChartAnnotations({
          ...input,
          annotations: [annotationFromDrawing({ ...item, time })],
        });
        expect(placements).toHaveLength(1);
        expect(placements[0]!.leader.to.x).toBe(render.xPositions[index]);
      }
      for (const time of [data[0]!.time - 1, data[2]!.time + 1])
        expect(
          layoutChartAnnotations({
            ...input,
            annotations: [annotationFromDrawing({ ...item, time })],
          }),
        ).toEqual([]);
      expect(JSON.stringify(item)).toBe(original);
    }
  });
});
