import { Schema } from "effect";
import { ProviderListing } from "@openchart/chart-core/market/provider-listing";
import { describe, expect, it, vi } from "vitest";
import { TextCache } from "@openchart/chart-core/cache";
import {
  ChartAnnotation,
  hitChartAnnotations,
  layoutChartAnnotations,
  renderChartAnnotations,
} from "@openchart/chart-core/annotation";
import type { RenderContext } from "@openchart/chart-core/drawing";

const ctx = {
  font: "14px system-ui",
  measureText: vi.fn((text: string) => ({
    width: text.length * 7,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 3,
  })),
} as unknown as CanvasRenderingContext2D;

function paintContext() {
  return {
    ...ctx,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    roundRect: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D & {
    fillText: ReturnType<typeof vi.fn>;
  };
}

function annotation(
  id: string,
  anchor: ChartAnnotation.Anchor,
  priorityScore = 0,
): ChartAnnotation.Record {
  return {
    id,
    userId: "usr_1",
    chartId: "cht_1",
    market: ProviderListing.parse({
      provider: "test",
      listing: { symbol: "AAPL", currency: "USD" },
    }),
    eventId: `evt_${id}`,
    label: `Fed minutes hawkish ${id}`,
    sentiment: 0,
    priorityScore,
    anchor,
    style: Schema.decodeUnknownSync(ChartAnnotation.Style)({}),
    visibility: "visible",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function renderContext(): RenderContext {
  const data = [
    {
      time: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
      open: 100,
      high: 110,
      low: 95,
      close: 104,
    },
    {
      time: Date.parse("2026-01-02T14:31:00.000Z") / 1000,
      open: 104,
      high: 116,
      low: 101,
      close: 112,
    },
    {
      time: Date.parse("2026-01-05T14:30:00.000Z") / 1000,
      open: 112,
      high: 118,
      low: 108,
      close: 111,
    },
  ];
  return {
    coord: {
      type: "cartesian2d",
      bounds: { x: 0, y: 0, width: 600, height: 300 },
      scales: {
        x: { extent: [0, 1], range: [0, 600], mode: "linear" },
        y: {
          right: { extent: [90, 120], range: [300, 0], mode: "linear" },
        },
      },
      defaultYScale: "right",
    },
    xPositions: [100, 200, 500],
    xFn: (index: number) => [100, 200, 500][index] ?? index * 100,
    data,
    visibleRange: { from: 0, to: data.length },
    area: { x: 0, y: 0, width: 600, height: 300 },
  };
}

describe("ChartAnnotation.Anchor", () => {
  it("uses compact theme-owned default styling", () => {
    expect(Schema.decodeUnknownSync(ChartAnnotation.Style)({})).toMatchObject({
      lineColor: ChartAnnotation.DEFAULT_LINE_COLOR,
      fillColor: ChartAnnotation.DEFAULT_FILL_COLOR,
      textColor: ChartAnnotation.DEFAULT_TEXT_COLOR,
      fontSize: 12,
      lineWidth: 1,
    });
  });

  it("accepts temporal anchors and rejects legacy price anchors", () => {
    expect(
      Schema.decodeUnknownSync(ChartAnnotation.Anchor)({
        start: Date.parse("2026-01-02") / 1000,
      }),
    ).toEqual({ start: Date.parse("2026-01-02") / 1000 });
    expect(
      Schema.decodeUnknownSync(ChartAnnotation.Anchor)({
        start: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
        end: Date.parse("2026-01-02T15:30:00.000Z") / 1000,
        targetAnchor: {
          time: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
          price: 112,
          axisId: "right",
        },
        labelAnchor: {
          time: Date.parse("2026-01-02T14:31:00.000Z") / 1000,
          price: 116,
          axisId: "right",
        },
      }),
    ).toEqual({
      start: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
      end: Date.parse("2026-01-02T15:30:00.000Z") / 1000,
      targetAnchor: {
        time: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
        price: 112,
        axisId: "right",
      },
      labelAnchor: {
        time: Date.parse("2026-01-02T14:31:00.000Z") / 1000,
        price: 116,
        axisId: "right",
      },
    });
    expect(() =>
      Schema.decodeUnknownSync(ChartAnnotation.Anchor)({
        time: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
        price: 100,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ChartAnnotation.Anchor)({ start: "2026-01-02" }),
    ).toThrow();
  });
});

describe("layoutChartAnnotations", () => {
  it("maps numeric event instants to their containing candle", () => {
    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render: renderContext(),
      annotations: [
        annotation("date", {
          start: Date.parse("2026-01-02T14:30:30Z") / 1000,
        }),
      ],
    });

    expect(placements).toHaveLength(1);
    expect(placements[0]!.leader.to.x).toBeCloseTo(100);
  });

  it("maps range anchors to the start candle", () => {
    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render: renderContext(),
      annotations: [
        annotation("range", {
          start: Date.parse("2026-01-02T14:31:00.000Z") / 1000,
          end: Date.parse("2026-01-05T14:30:00.000Z") / 1000,
        }),
      ],
    });

    expect(placements).toHaveLength(1);
    expect(placements[0]!.leader.to.x).toBeCloseTo(200);
  });

  it("keeps dense annotations discoverable with exposed layered hit regions", () => {
    const render = renderContext();
    render.area = { x: 0, y: 0, width: 180, height: 72 };
    render.xPositions = [90, 92, 94];
    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation(
          "high",
          { start: Date.parse("2026-01-02T14:30:00.000Z") / 1000 },
          10,
        ),
        annotation(
          "mid",
          { start: Date.parse("2026-01-02T14:30:00.000Z") / 1000 },
          5,
        ),
        annotation(
          "low",
          { start: Date.parse("2026-01-02T14:30:00.000Z") / 1000 },
          1,
        ),
      ],
    });

    expect(placements).toHaveLength(3);
    expect(placements.some((placement) => placement.exposed)).toBe(true);
  });

  it("keeps active selection separate from hover expansion ordering", () => {
    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render: renderContext(),
      annotations: [
        annotation(
          "high",
          { start: Date.parse("2026-01-02T14:30:00.000Z") / 1000 },
          10,
        ),
        annotation(
          "active",
          { start: Date.parse("2026-01-02T14:31:00.000Z") / 1000 },
          0,
        ),
      ],
      activeAnnotationId: "active",
    });

    expect(placements[0]!.annotation.id).toBe("high");
    expect(
      placements.find((item) => item.annotation.id === "active")!.state,
    ).toBe("compact");
  });

  it("can suppress canvas label text while inline editor owns it", () => {
    const annotationRecord = annotation("editing", {
      start: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
    });
    const paint = paintContext();

    renderChartAnnotations({
      ctx: paint,
      textCache: TextCache.create(),
      render: renderContext(),
      stripArea: { x: 0, y: 0, width: 600, height: 300 },
      annotations: [annotationRecord],
      hiddenTextAnnotationIds: new Set([annotationRecord.id]),
    });

    expect(paint.fillText).not.toHaveBeenCalledWith(
      annotationRecord.label,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("uses manual label placement while target anchors stay wick-side", () => {
    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render: renderContext(),
      annotations: [
        annotation("manual", {
          start: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
          targetAnchor: {
            time: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
            price: 110,
            axisId: "right",
          },
          labelAnchor: {
            time: Date.parse("2026-01-02T14:31:00.000Z") / 1000,
            price: 116,
            axisId: "right",
          },
        }),
      ],
    });

    expect(placements).toHaveLength(1);
    expect(placements[0]!.handles.target.x).toBeCloseTo(100);
    expect(placements[0]!.handles.target.y).toBeCloseTo(93);
    expect(placements[0]!.pill.x + placements[0]!.pill.width / 2).toBeCloseTo(
      200,
    );
    expect(placements[0]!.pill.y + placements[0]!.pill.height / 2).toBeCloseTo(
      40,
    );
    expect(placements[0]!.handles.label.x).toBeCloseTo(200);
    expect(placements[0]!.handles.label.y).toBeCloseTo(
      placements[0]!.pill.y + placements[0]!.pill.height / 2,
    );
    expect(placements[0]!.leader.from.y).toBeGreaterThan(placements[0]!.pill.y);
    expect(placements[0]!.leader.from.y).toBeCloseTo(
      placements[0]!.pill.y + placements[0]!.pill.height,
    );
  });

  it("hit-tests annotation bodies and exposes centroid drag anchors", () => {
    const render = renderContext();
    const annotations = [
      annotation("manual", {
        start: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
        targetAnchor: {
          time: Date.parse("2026-01-02T14:30:00.000Z") / 1000,
          price: 110,
          axisId: "right",
        },
        labelAnchor: {
          time: Date.parse("2026-01-02T14:31:00.000Z") / 1000,
          price: 116,
          axisId: "right",
        },
      }),
    ];
    const [placement] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
    });

    expect(placement).toBeDefined();
    const leaderHit = hitChartAnnotations({
      pointer: {
        x: (placement!.leader.from.x + placement!.leader.to.x) / 2,
        y: (placement!.leader.from.y + placement!.leader.to.y) / 2,
      },
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
    });

    expect(leaderHit).toBeNull();

    const bodyHit = hitChartAnnotations({
      pointer: {
        x: placement!.pill.x + placement!.pill.width / 2,
        y: placement!.pill.y + placement!.pill.height / 2,
      },
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
    });

    expect(bodyHit?.part).toBe("body");
    expect(bodyHit?.dragAnchor?.x).toBeCloseTo(
      placement!.pill.x + placement!.pill.width / 2,
    );
    expect(bodyHit?.dragAnchor?.y).toBeCloseTo(
      placement!.pill.y + placement!.pill.height / 2,
    );
  });
});
