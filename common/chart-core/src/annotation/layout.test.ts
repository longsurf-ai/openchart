// Purpose: Tests for runtime chart-annotation placement against chart ink and temporal anchors
// Module:  @openchart/chart-core / annotation

import { Schema } from "effect";
import { ProviderListing } from "@openchart/chart-core/market/provider-listing";
import { describe, expect, it } from "vitest";
import { TextCache } from "@openchart/chart-core/cache";
import type { RenderContext } from "@openchart/chart-core/drawing";
import { hitChartAnnotationPlacements, hitChartAnnotations } from "./hit";
import {
  type AnnotationPlacement,
  createChartAnnotationLayoutState,
  expandChartAnnotationPlacements,
  layoutChartAnnotations,
  previewChartAnnotationDragPlacements,
  translateChartAnnotationPlacements,
} from "./layout";
import { ChartAnnotation } from "./types";

const ctx = {
  measureText: (text: string) => ({ width: text.length * 7 }),
} as CanvasRenderingContext2D;

function overlapArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  );
  const y = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );
  return x * y;
}

function annotation(
  patch: Partial<ChartAnnotation.Record> & { id: string; start: number },
): ChartAnnotation.Record {
  return {
    userId: "user_1",
    dashboardId: "dashboard_1",
    market: ProviderListing.parse({
      provider: "test",
      listing: { symbol: "AAPL", currency: "USD" },
    }),
    spanId: null,
    materializedByAgentRunId: null,
    materializationKey: null,
    eventId: `event_${patch.id}`,
    label: "Target collision",
    sentiment: 0,
    priorityScore: 0,
    anchor: { start: patch.start },
    style: Schema.decodeUnknownSync(ChartAnnotation.Style)({}),
    visibility: "visible",
    revision: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    deletedAt: null,
    ...patch,
    feedback: patch.feedback ?? null,
  };
}

function center(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function placement(
  patch: Partial<AnnotationPlacement> & {
    annotation: ChartAnnotation.Record;
    pill: { x: number; y: number; width: number; height: number };
  },
): AnnotationPlacement {
  const label = center(patch.pill);
  return {
    anchor: { x: 0, y: 0 },
    leader: { from: label, to: { x: 0, y: 0 } },
    handles: { target: { x: 0, y: 0 }, label },
    hit: patch.pill,
    text: patch.annotation.label,
    fullText: patch.annotation.label,
    zIndex: 0,
    layer: 0,
    state: "compact",
    appearance: {} as AnnotationPlacement["appearance"],
    ...patch,
  };
}

function pointDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orientation(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentsCross(
  a: { from: { x: number; y: number }; to: { x: number; y: number } },
  b: { from: { x: number; y: number }; to: { x: number; y: number } },
) {
  const o1 = orientation(a.from, a.to, b.from);
  const o2 = orientation(a.from, a.to, b.to);
  const o3 = orientation(b.from, b.to, a.from);
  const o4 = orientation(b.from, b.to, a.to);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function leaderCrossingCount(
  placements: Array<{
    leader: { from: { x: number; y: number }; to: { x: number; y: number } };
  }>,
) {
  let count = 0;
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      if (segmentsCross(placements[i]!.leader, placements[j]!.leader)) count++;
    }
  }
  return count;
}

function onRectBoundary(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
) {
  const onVertical =
    (Math.abs(point.x - rect.x) < 0.001 ||
      Math.abs(point.x - (rect.x + rect.width)) < 0.001) &&
    point.y >= rect.y - 0.001 &&
    point.y <= rect.y + rect.height + 0.001;
  const onHorizontal =
    (Math.abs(point.y - rect.y) < 0.001 ||
      Math.abs(point.y - (rect.y + rect.height)) < 0.001) &&
    point.x >= rect.x - 0.001 &&
    point.x <= rect.x + rect.width + 0.001;
  return onVertical || onHorizontal;
}

function expectSameRect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  expect(a.x).toBeCloseTo(b.x);
  expect(a.y).toBeCloseTo(b.y);
  expect(a.width).toBeCloseTo(b.width);
  expect(a.height).toBeCloseTo(b.height);
}

function overlapCount(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
) {
  let count = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlapArea(rects[i]!, rects[j]!) > 0) count++;
    }
  }
  return count;
}

function expandedCards(...ids: string[]) {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        title: "NVIDIA shares rose after hours",
        content: "Revenue and earnings outlook exceeded expectations.",
        questions: ["What does this mean?", "Why now?", "Next NVDA"],
      },
    ]),
  );
}

function compactTextCapacity(placement: AnnotationPlacement): number {
  return (
    placement.pill.width -
    placement.appearance.paddingX * 2 -
    placement.appearance.sourceSlotWidth -
    placement.appearance.textEndGap
  );
}

function renderContext(): RenderContext {
  const data = [
    {
      time: Date.parse("2026-05-01T13:30:00.000Z") / 1000,
      open: 49,
      high: 61,
      low: 43,
      close: 56,
    },
    {
      time: Date.parse("2026-05-02T13:30:00.000Z") / 1000,
      open: 48,
      high: 62,
      low: 42,
      close: 55,
    },
    {
      time: Date.parse("2026-05-03T13:30:00.000Z") / 1000,
      open: 47,
      high: 63,
      low: 41,
      close: 54,
    },
    {
      time: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      open: 44,
      high: 65,
      low: 39,
      close: 56,
    },
    {
      time: Date.parse("2026-05-05T13:30:00.000Z") / 1000,
      open: 46,
      high: 64,
      low: 40,
      close: 53,
    },
    {
      time: Date.parse("2026-05-06T13:30:00.000Z") / 1000,
      open: 48,
      high: 62,
      low: 41,
      close: 54,
    },
    {
      time: Date.parse("2026-05-07T13:30:00.000Z") / 1000,
      open: 50,
      high: 60,
      low: 44,
      close: 55,
    },
  ];
  return {
    coord: {
      type: "cartesian2d",
      bounds: { x: 0, y: 0, width: 280, height: 200 },
      defaultYScale: "right",
      scales: {
        x: { extent: [0, 6], range: [20, 260], mode: "linear" },
        y: {
          right: { extent: [0, 100], range: [200, 0], mode: "linear" },
        },
      },
    },
    xPositions: data.map((_, index) => 20 + index * 40),
    xFn: (index) => 20 + index * 40,
    data,
    visibleRange: { from: 0, to: data.length - 1 },
    area: { x: 0, y: 0, width: 280, height: 200 },
  };
}

describe("layoutChartAnnotations", () => {
  it("returns empty without building chart occupancy when no annotations exist", () => {
    const render: RenderContext = {
      ...renderContext(),
      xPositions: [],
      xFn: () => {
        throw new Error("empty annotation layout must not project chart data");
      },
    };
    const layoutState = createChartAnnotationLayoutState();
    layoutState.slots.set("stale", {
      annotationId: "stale",
      start: Date.parse("2026-05-01T13:30:00.000Z") / 1000,
      offset: { x: 0, y: 0 },
      width: 24,
      height: 18,
    });

    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [],
      layoutState,
      layoutStateWritable: true,
    });

    expect(placements).toEqual([]);
    expect(layoutState.slots.size).toBe(0);
  });

  it("prefers a label rectangle that avoids visible candle pixels", () => {
    const render = renderContext();
    const [placement] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation({
          id: "ann_1",
          start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        }),
      ],
    });

    expect(placement).toBeDefined();
    expect(
      overlapArea(placement!.pill, {
        x: 120 - 18,
        y: 78,
        width: 36,
        height: 49,
      }),
    ).toBe(0);
  });

  it("omits instant annotations outside the rendered data window", () => {
    const render = renderContext();
    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation({
          id: "before",
          start: Date.parse("2026-04-30T13:30:00.000Z") / 1000,
        }),
        annotation({
          id: "after",
          start: Date.parse("2026-05-08T13:30:00.000Z") / 1000,
        }),
      ],
    });

    expect(placements).toEqual([]);
  });

  it("keeps manual label placement centered and uses the centroid handle", () => {
    const render = renderContext();
    const [placement] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation({
          id: "ann_1",
          start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
          anchor: {
            start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
            targetAnchor: {
              time: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
              price: 50,
            },
            labelAnchor: {
              time: Date.parse("2026-05-05T13:30:00.000Z") / 1000,
              price: 70,
            },
          },
        }),
      ],
    });

    expect(placement).toBeDefined();
    expect(center(placement!.pill).x).toBeCloseTo(180);
    expect(center(placement!.pill).y).toBeCloseTo(60);
    expect(placement!.handles.label.x).toBeCloseTo(
      placement!.pill.x + placement!.pill.width / 2,
    );
    expect(placement!.handles.label.y).toBeCloseTo(
      placement!.pill.y + placement!.pill.height / 2,
    );
    expect(onRectBoundary(placement!.leader.from, placement!.pill)).toBe(true);
  });

  it("honors manual label anchors even when the leader exceeds the automatic cap", () => {
    const base = renderContext();
    const render: RenderContext = {
      ...base,
      area: { x: 0, y: 0, width: 900, height: 600 },
      coord: {
        ...base.coord,
        bounds: { x: 0, y: 0, width: 900, height: 600 },
        scales: {
          x: { extent: [0, 6], range: [80, 820], mode: "linear" },
          y: {
            right: { extent: [0, 100], range: [600, 0], mode: "linear" },
          },
        },
      },
      xPositions: [80, 203, 326, 450, 573, 696, 820],
      xFn: (index: number) => 80 + index * 123,
    };
    const [placement] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation({
          id: "ann_1",
          start: Date.parse("2026-05-01T13:30:00.000Z") / 1000,
          anchor: {
            start: Date.parse("2026-05-01T13:30:00.000Z") / 1000,
            labelAnchor: {
              time: Date.parse("2026-05-07T13:30:00.000Z") / 1000,
              price: 86,
            },
          },
        }),
      ],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "news", label: "News" }],
      },
    });

    expect(placement).toBeDefined();
    expect(center(placement!.pill).x).toBeGreaterThan(760);
    expect(
      pointDistance(placement!.leader.from, placement!.leader.to),
    ).toBeGreaterThan(240);
  });

  it("measures source badges as part of the pill layout", () => {
    const render = renderContext();
    const base = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "WWDC AI push",
    });
    const [withoutBadges] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [base],
    });
    const [withBadges] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [base],
      sourceBadgesByAnnotationId: {
        ann_1: [
          { id: "bloomberg", label: "Bloomberg" },
          { id: "reuters", label: "Reuters" },
          { id: "wsj", label: "WSJ" },
        ],
      },
    });

    expect(withoutBadges).toBeDefined();
    expect(withBadges).toBeDefined();
    expect(withBadges!.appearance.sourceBadges).toHaveLength(3);
    expect(withBadges!.pill.width).toBeGreaterThan(withoutBadges!.pill.width);
    expect(withBadges!.pill.height).toBe(28);
    expect(compactTextCapacity(withBadges!)).toBeGreaterThanOrEqual(
      ctx.measureText(withBadges!.fullText).width,
    );
  });

  it("caps compact pill width before source badges", () => {
    const render = renderContext();
    const [placement] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation({
          id: "ann_1",
          start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
          label:
            "Analyst Rating | Wedbush: Raises The Trade Desk price target significantly",
        }),
      ],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
    });

    expect(placement).toBeDefined();
    expect(placement!.pill.width).toBeLessThanOrEqual(
      placement!.appearance.compactTextMaxWidth +
        placement!.appearance.paddingX * 2 +
        placement!.appearance.sourceSlotWidth +
        placement!.appearance.textEndGap,
    );
  });

  it("prefers bounded leader lengths over far-away clean lanes", () => {
    const base = renderContext();
    const render: RenderContext = {
      ...base,
      area: { x: 0, y: 0, width: 720, height: 540 },
      coord: {
        ...base.coord,
        bounds: { x: 0, y: 0, width: 720, height: 540 },
        scales: {
          x: {
            extent: [0, 6],
            range: [48, 672],
            mode: "linear",
          },
          y: {
            right: {
              extent: [0, 100],
              range: [540, 0],
              mode: "linear",
            },
          },
        },
      },
      xPositions: [48, 152, 256, 360, 464, 568, 672],
      xFn: (index: number) => 48 + index * 104,
    };
    const annotations = Array.from({ length: 12 }, (_, index) =>
      annotation({
        id: `ann_${index}`,
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: `Trade Desk rating event ${index}`,
        priorityScore: 12 - index,
      }),
    );
    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: Object.fromEntries(
        annotations.map((item) => [item.id, [{ id: "news", label: "News" }]]),
      ),
    });

    const longest = Math.max(
      ...placements.map((item) =>
        pointDistance(item.leader.from, item.leader.to),
      ),
    );
    expect(longest).toBeLessThan(240);
  });

  it("allows agent annotation target handles to be hit before selection", () => {
    const render = renderContext();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Agent annotation target",
    });
    const [placement] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
    });

    expect(placement).toBeDefined();
    const hit = hitChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      pointer: placement!.handles.target,
    });

    expect(hit?.part).toBe("target_handle");
  });

  it("spreads clustered automatic annotations across free lanes", () => {
    const base = renderContext();
    const render: RenderContext = {
      ...base,
      area: { x: 0, y: 0, width: 640, height: 360 },
      coord: {
        ...base.coord,
        bounds: { x: 0, y: 0, width: 640, height: 360 },
        scales: {
          x: {
            extent: [0, 6],
            range: [40, 600],
            mode: "linear",
          },
          y: {
            right: {
              extent: [0, 100],
              range: [360, 0],
              mode: "linear",
            },
          },
        },
      },
      xPositions: [40, 130, 220, 310, 400, 490, 580],
      xFn: (index: number) => 40 + index * 90,
    };
    const annotations = Array.from({ length: 9 }, (_, index) =>
      annotation({
        id: `ann_${index}`,
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: `Clustered automatic annotation ${index}`,
        priorityScore: 9 - index,
      }),
    );

    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: Object.fromEntries(
        annotations.map((item) => [item.id, [{ id: "news", label: "News" }]]),
      ),
    });

    expect(placements).toHaveLength(9);
    expect(overlapCount(placements.map((item) => item.pill))).toBeLessThan(40);
  });

  it("uses anchor-local open slots within the automatic leader length cap", () => {
    const base = renderContext();
    const render: RenderContext = {
      ...base,
      area: { x: 0, y: 0, width: 900, height: 600 },
      coord: {
        ...base.coord,
        bounds: { x: 0, y: 0, width: 900, height: 600 },
        scales: {
          x: {
            extent: [0, 6],
            range: [80, 820],
            mode: "linear",
          },
          y: {
            right: {
              extent: [0, 100],
              range: [600, 0],
              mode: "linear",
            },
          },
        },
      },
      xPositions: [80, 203, 326, 450, 573, 696, 820],
      xFn: (index: number) => 80 + index * 123,
    };
    const annotations = Array.from({ length: 20 }, (_, index) =>
      annotation({
        id: `ann_${index}`,
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: `Crowded target annotation ${index}`,
        priorityScore: 20 - index,
      }),
    );

    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: Object.fromEntries(
        annotations.map((item) => [item.id, [{ id: "news", label: "News" }]]),
      ),
    });

    expect(placements).toHaveLength(20);
    expect(
      Math.max(
        ...placements.map((item) =>
          pointDistance(item.leader.from, item.leader.to),
        ),
      ),
    ).toBeLessThanOrEqual(240);
    expect(overlapCount(placements.map((item) => item.pill))).toBeLessThan(40);
  });

  it("prefers vertical slots across candidate rings before side slots", () => {
    const base = renderContext();
    const render: RenderContext = {
      ...base,
      area: { x: 0, y: 0, width: 500, height: 360 },
      coord: {
        ...base.coord,
        bounds: { x: 0, y: 0, width: 500, height: 360 },
        scales: {
          x: {
            extent: [0, 6],
            range: [40, 460],
            mode: "linear",
          },
          y: {
            right: {
              extent: [0, 100],
              range: [360, 0],
              mode: "linear",
            },
          },
        },
      },
      xPositions: [40, 110, 180, 250, 320, 390, 460],
      xFn: (index: number) => 40 + index * 70,
    };
    const annotations = Array.from({ length: 6 }, (_, index) =>
      annotation({
        id: `ann_${index}`,
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: `Short event ${index}`,
        priorityScore: 6 - index,
      }),
    );

    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: Object.fromEntries(
        annotations.map((item) => [item.id, [{ id: "news", label: "News" }]]),
      ),
    });

    expect(placements).toHaveLength(6);
    const verticalCount = placements.filter(
      (item) => Math.abs(center(item.pill).x - item.anchor.x) <= 0.001,
    ).length;
    expect(verticalCount).toBeGreaterThanOrEqual(1);
    expect(
      Math.abs(center(placements[0]!.pill).x - placements[0]!.anchor.x),
    ).toBeLessThan(0.001);
  });

  it("eliminates crossing leaders when clean local candidates exist", () => {
    const values = [80, 30, 78, 32, 76, 34, 74, 36];
    const data = values.map((value, index) => ({
      time: Date.UTC(2026, 0, 1 + index) / 1000,
      open: value,
      high: value + 2,
      low: value - 2,
      close: value,
    }));
    const render: RenderContext = {
      coord: {
        type: "cartesian2d",
        bounds: { x: 0, y: 0, width: 640, height: 360 },
        defaultYScale: "right",
        scales: {
          x: { extent: [0, 7], range: [60, 580], mode: "linear" },
          y: {
            right: { extent: [0, 100], range: [360, 0], mode: "linear" },
          },
        },
      },
      xPositions: data.map((_, index) => 60 + index * (520 / 7)),
      xFn: (index: number) => 60 + index * (520 / 7),
      data,
      visibleRange: { from: 0, to: data.length - 1 },
      area: { x: 0, y: 0, width: 640, height: 360 },
    };
    const annotations = data.map((row, index) =>
      annotation({
        id: `ann_${index}`,
        start: row.time,
        label: `Crossing event ${index}`,
        priorityScore: data.length - index,
      }),
    );

    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: Object.fromEntries(
        annotations.map((item) => [item.id, [{ id: "news", label: "News" }]]),
      ),
    });

    expect(placements).toHaveLength(8);
    expect(leaderCrossingCount(placements)).toBe(0);
  });

  it("does not place automatic annotations beyond the leader cap", () => {
    const base = renderContext();
    const render: RenderContext = {
      ...base,
      area: { x: 0, y: 0, width: 900, height: 600 },
      coord: {
        ...base.coord,
        bounds: { x: 0, y: 0, width: 900, height: 600 },
        scales: {
          x: {
            extent: [0, 6],
            range: [80, 820],
            mode: "linear",
          },
          y: {
            right: {
              extent: [0, 100],
              range: [600, 0],
              mode: "linear",
            },
          },
        },
      },
      xPositions: [80, 203, 326, 450, 573, 696, 820],
      xFn: (index: number) => 80 + index * 123,
    };
    const annotations = Array.from({ length: 8 }, (_, index) =>
      annotation({
        id: `ann_${index}`,
        start: Date.parse("2026-05-01T13:30:00.000Z") / 1000,
        label: `Left edge annotation ${index}`,
        priorityScore: 8 - index,
      }),
    );

    const placements = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: Object.fromEntries(
        annotations.map((item) => [item.id, [{ id: "news", label: "News" }]]),
      ),
    });

    expect(placements.length).toBeGreaterThan(0);
    expect(
      Math.max(
        ...placements.map((item) =>
          pointDistance(item.leader.from, item.leader.to),
        ),
      ),
    ).toBeLessThanOrEqual(240);
    expect(overlapCount(placements.map((item) => item.pill))).toBeLessThan(8);
  });

  it("keeps runtime slot offsets stable across horizontal panning", () => {
    const render = renderContext();
    const state = createChartAnnotationLayoutState();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Runtime slot",
    });
    const [first] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      layoutState: state,
      layoutStateWritable: true,
    });
    const shifted = {
      ...render,
      xPositions: render.xPositions.map((x) => x + 24),
      xFn: (index: number) => render.xFn(index) + 24,
    };
    const [second] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render: shifted,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      layoutState: state,
      layoutStateWritable: true,
    });

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(center(second!.pill).x).toBeCloseTo(center(first!.pill).x + 24);
    expect(center(second!.pill).y).toBeCloseTo(center(first!.pill).y);
    expect(second!.pill.width).toBeCloseTo(first!.pill.width);
    expect(second!.pill.height).toBeCloseTo(first!.pill.height);
    expect(second!.anchor.x).toBeCloseTo(first!.anchor.x + 24);
  });

  it("translates cached placements with their anchors before clamping", () => {
    const render = renderContext();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Runtime translated annotation",
    });
    const [first] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
    });
    const shifted = {
      ...render,
      xPositions: render.xPositions.map((x) => x + 24),
      xFn: (index: number) => render.xFn(index) + 24,
    };
    const [second] =
      translateChartAnnotationPlacements({
        ctx,
        textCache: TextCache.create(),
        render: shifted,
        annotations: [annotationRecord],
        sourceBadgesByAnnotationId: {
          ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
        },
        previousPlacements: [first!],
      }) ?? [];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second!.pill.x).toBeCloseTo(first!.pill.x + 24);
    expect(second!.pill.y).toBeCloseTo(first!.pill.y);
    expect(second!.pill.width).toBeCloseTo(first!.pill.width);
    expect(second!.pill.height).toBeCloseTo(first!.pill.height);
    expect(second!.leader.to.x).toBeCloseTo(first!.leader.to.x + 24);
    expect(second!.leader.from.x).toBeCloseTo(first!.leader.from.x + 24);
  });

  it("only pushes translated placements when they would leave the viewport", () => {
    const render = renderContext();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Runtime clipped annotation",
    });
    const [first] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
    });
    const shifted = {
      ...render,
      xPositions: render.xPositions.map((x) => x - 320),
      xFn: (index: number) => render.xFn(index) - 320,
    };
    const [second] =
      translateChartAnnotationPlacements({
        ctx,
        textCache: TextCache.create(),
        render: shifted,
        annotations: [annotationRecord],
        sourceBadgesByAnnotationId: {
          ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
        },
        previousPlacements: [first!],
      }) ?? [];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second!.pill.x).toBe(4);
    expect(second!.pill.x).toBeGreaterThan(first!.pill.x - 320);
    expect(second!.leader.to.x).toBeCloseTo(first!.leader.to.x - 320);
  });

  it("does not persist viewport-clamped translation into runtime slots", () => {
    const render = renderContext();
    const state = createChartAnnotationLayoutState();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Runtime clipped annotation",
    });
    const [first] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      layoutState: state,
      layoutStateWritable: true,
    });
    const slot = state.slots.get("ann_1");
    expect(first).toBeDefined();
    expect(slot).toBeDefined();
    const original = { ...slot!.offset };
    const shifted = {
      ...render,
      xPositions: render.xPositions.map((x) => x - 320),
      xFn: (index: number) => render.xFn(index) - 320,
    };

    const [second] =
      translateChartAnnotationPlacements({
        ctx,
        textCache: TextCache.create(),
        render: shifted,
        annotations: [annotationRecord],
        sourceBadgesByAnnotationId: {
          ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
        },
        layoutState: state,
        layoutStateWritable: true,
        previousPlacements: [first!],
      }) ?? [];

    expect(second).toBeDefined();
    expect(second!.pill.x).toBe(4);
    expect(state.slots.get("ann_1")?.offset).toEqual(original);
  });

  it("does not persist viewport-clamped runtime slots during fallback solves", () => {
    const render = renderContext();
    const state = createChartAnnotationLayoutState();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Runtime clipped annotation",
    });
    const [first] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      layoutState: state,
      layoutStateWritable: true,
    });
    const slot = state.slots.get("ann_1");
    expect(first).toBeDefined();
    expect(slot).toBeDefined();
    const original = { ...slot!.offset };
    const shifted = {
      ...render,
      xPositions: render.xPositions.map((x) => x - 320),
      xFn: (index: number) => render.xFn(index) - 320,
    };

    const [clamped] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render: shifted,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      layoutState: state,
      layoutStateWritable: true,
    });
    const [restored] =
      translateChartAnnotationPlacements({
        ctx,
        textCache: TextCache.create(),
        render,
        annotations: [annotationRecord],
        sourceBadgesByAnnotationId: {
          ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
        },
        layoutState: state,
        layoutStateWritable: false,
        previousPlacements: [clamped!],
      }) ?? [];

    expect(clamped).toBeDefined();
    expect(clamped!.pill.x).toBe(4);
    expect(state.slots.get("ann_1")?.offset).toEqual(original);
    expect(restored).toBeDefined();
    expectSameRect(restored!.pill, first!.pill);
  });

  it("preserves the previous painted offset over a stale runtime slot during translation", () => {
    const render = renderContext();
    const state = createChartAnnotationLayoutState();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Runtime stretched annotation",
    });
    const [first] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      layoutState: state,
      layoutStateWritable: true,
    });
    expect(first).toBeDefined();
    const slot = state.slots.get("ann_1");
    expect(slot).toBeDefined();
    const stretched = placement({
      ...first!,
      annotation: annotationRecord,
      anchor: first!.anchor,
      leader: {
        from: { x: first!.leader.from.x + 12, y: first!.leader.from.y },
        to: first!.leader.to,
      },
      handles: {
        target: first!.handles.target,
        label: { x: first!.handles.label.x + 12, y: first!.handles.label.y },
      },
      pill: {
        ...first!.pill,
        x: first!.pill.x + 12,
      },
    });
    const shifted = {
      ...render,
      xPositions: render.xPositions.map((x) => x + 20),
      xFn: (index: number) => render.xFn(index) + 20,
    };

    const [translated] =
      translateChartAnnotationPlacements({
        ctx,
        textCache: TextCache.create(),
        render: shifted,
        annotations: [annotationRecord],
        sourceBadgesByAnnotationId: {
          ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
        },
        layoutState: state,
        layoutStateWritable: false,
        previousPlacements: [stretched],
      }) ?? [];

    expect(translated).toBeDefined();
    expect(translated!.pill.x).toBeCloseTo(stretched.pill.x + 20);
    expect(translated!.pill.x).not.toBeCloseTo(first!.pill.x + 20);
  });

  it("preserves a runtime slot when chart ink moves under the cached pill", () => {
    const render = renderContext();
    const state = createChartAnnotationLayoutState();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Runtime stable annotation",
    });
    const [first] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      layoutState: state,
      layoutStateWritable: true,
    });
    expect(first).toBeDefined();
    const blocker = {
      x: 100 - 14,
      y: first!.pill.y - 8,
      width: 28,
      height: first!.pill.height + 16,
    };
    const blocked = {
      ...render,
      data: render.data.map((row, index) =>
        index === 2
          ? Object.assign({}, row, {
              open: 90,
              high: 92,
              low: 74,
              close: 76,
            })
          : row,
      ),
    };
    const [second] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render: blocked,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      layoutState: state,
      layoutStateWritable: true,
    });

    expect(second).toBeDefined();
    expect(overlapArea(first!.pill, blocker)).toBeGreaterThan(0);
    expectSameRect(second!.pill, first!.pill);
  });

  it("translates cached placements while an annotation is hovered", () => {
    const render = renderContext();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Runtime hover translated annotation",
    });
    const [first] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
    });
    const shifted = {
      ...render,
      xPositions: render.xPositions.map((x) => x + 24),
      xFn: (index: number) => render.xFn(index) + 24,
    };
    const [second] =
      translateChartAnnotationPlacements({
        ctx,
        textCache: TextCache.create(),
        render: shifted,
        annotations: [annotationRecord],
        hoveredAnnotationId: "ann_1",
        sourceBadgesByAnnotationId: {
          ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
        },
        previousPlacements: [first!],
      }) ?? [];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second!.pill.x).toBeCloseTo(first!.pill.x + 24);
    expect(second!.pill.y).toBeCloseTo(first!.pill.y);
  });

  it("invalidates runtime slot positions when horizontal scale changes", () => {
    const render = renderContext();
    const state = createChartAnnotationLayoutState();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Runtime adaptive annotation",
    });
    const [first] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      layoutState: state,
      layoutStateWritable: true,
    });
    const zoomed = {
      ...render,
      xPositions: render.xPositions.map((_, index) => 20 + index * 60),
      xFn: (index: number) => 20 + index * 60,
    };
    const [second] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render: zoomed,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      layoutState: state,
      layoutStateWritable: true,
    });

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(Math.abs(center(second!.pill).x - second!.anchor.x)).toBeLessThan(
      Math.abs(center(first!.pill).x - second!.anchor.x),
    );
    expect(center(second!.pill).x).not.toBeCloseTo(center(first!.pill).x);
  });

  it("derives expanded agent annotation cards from compact placement", () => {
    const render = renderContext();
    const badges = {
      ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
    };
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "NVDA tops Q3 estimates and raises Q4 outlook",
      }),
    ];
    const [compact] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: badges,
    });
    const [placement] = expandChartAnnotationPlacements(
      {
        ctx,
        textCache: TextCache.create(),
        render,
        annotations,
        expandedAnnotation: { id: "ann_1", body: "preview" },
        sourceBadgesByAnnotationId: badges,
        expandedCardsByAnnotationId: expandedCards("ann_1"),
      },
      compact ? [compact] : [],
    );

    expect(compact).toBeDefined();
    expect(placement).toBeDefined();
    expect(placement!.state).toBe("expanded");
    expectSameRect(placement!.compactPill!, compact!.pill);
    expect(placement!.pill.width).toBeGreaterThan(260);
    expect(placement!.pill.height).toBeGreaterThan(120);
    expect(placement!.pill.x).toBeLessThanOrEqual(compact!.pill.x);
    expect(placement!.pill.x + placement!.pill.width).toBeGreaterThanOrEqual(
      compact!.pill.x + compact!.pill.width,
    );
    expect(placement!.hit.x).toBeLessThanOrEqual(placement!.pill.x);
    expect(placement!.hit.y).toBeLessThanOrEqual(placement!.pill.y);
    expect(placement!.hit.x + placement!.hit.width).toBeGreaterThanOrEqual(
      placement!.pill.x + placement!.pill.width,
    );
    expect(placement!.hit.y + placement!.hit.height).toBeGreaterThanOrEqual(
      placement!.pill.y + placement!.pill.height,
    );
    expect(placement!.handles.label).toEqual(center(placement!.pill));
    expect(onRectBoundary(placement!.leader.from, placement!.pill)).toBe(true);
    expect(placement!.leader.from).not.toEqual(compact!.leader.from);
  });

  it("keeps expanded agent card hit geometry without projected content", () => {
    const render = renderContext();
    const badges = {
      ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
    };
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "Expanded annotation with late card content",
      }),
    ];
    const [compact] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: badges,
    });
    const [placement] = expandChartAnnotationPlacements(
      {
        ctx,
        textCache: TextCache.create(),
        render,
        annotations,
        expandedAnnotation: { id: "ann_1", body: "preview" },
        sourceBadgesByAnnotationId: badges,
        agentAnnotationIds: { ann_1: true },
      },
      compact ? [compact] : [],
    );
    const hit = hitChartAnnotationPlacements({
      placements: placement ? [placement] : [],
      expandedAnnotation: { id: "ann_1", body: "preview" },
      pointer: center(placement!.pill),
      zSorted: true,
    });

    expect(compact).toBeDefined();
    expect(placement).toBeDefined();
    expect(placement!.state).toBe("expanded");
    expect(placement!.expandedContent).toBeUndefined();
    expect(placement!.pill.width).toBeGreaterThan(compact!.pill.width);
    expect(hit?.id).toBe("ann_1");
    expect(hit?.part).toBe("body");
    expect(hit?.expanded).toBe(true);
  });

  it("derives hover agent annotation pills from compact placement", () => {
    const render = renderContext();
    const badges = {
      ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
    };
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "NVDA tops Q3 estimates and raises Q4 outlook",
      }),
    ];
    const [compact] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: badges,
    });
    const [placement] = expandChartAnnotationPlacements(
      {
        ctx,
        textCache: TextCache.create(),
        render,
        annotations,
        hoveredAnnotationId: "ann_1",
        sourceBadgesByAnnotationId: badges,
        expandedCardsByAnnotationId: expandedCards("ann_1"),
      },
      compact ? [compact] : [],
    );

    expect(compact).toBeDefined();
    expect(placement).toBeDefined();
    expect(placement!.state).toBe("hover");
    expectSameRect(placement!.compactPill!, compact!.pill);
    expect(placement!.actionButton).toBeDefined();
    expect(placement!.pill.width).toBeGreaterThan(compact!.pill.width);
    expect(placement!.pill.height).toBe(compact!.pill.height);
  });

  it("derives hover pills before expanded card content is available", () => {
    const render = renderContext();
    const badges = {
      ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
    };
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "NVDA tops Q3 estimates and raises Q4 outlook",
      }),
    ];
    const [compact] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: badges,
    });
    const [placement] = expandChartAnnotationPlacements(
      {
        ctx,
        textCache: TextCache.create(),
        render,
        annotations,
        hoveredAnnotationId: "ann_1",
        sourceBadgesByAnnotationId: badges,
      },
      compact ? [compact] : [],
    );

    expect(compact).toBeDefined();
    expect(placement).toBeDefined();
    expect(placement!.state).toBe("hover");
    expect(placement!.actionButton).toBeUndefined();
    expect(placement!.pill.width).toBeGreaterThan(compact!.pill.width);
  });

  it("sizes hover pills to reveal title text rather than card width", () => {
    const render = renderContext();
    const badges = {
      ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
    };
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "Short title",
      }),
    ];
    const [compact] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: badges,
    });
    const hoverInput = {
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: badges,
      expandedCardsByAnnotationId: expandedCards("ann_1"),
    };
    const [hovered] = expandChartAnnotationPlacements(
      { ...hoverInput, hoveredAnnotationId: "ann_1" },
      compact ? [compact] : [],
    );
    const [expanded] = expandChartAnnotationPlacements(
      {
        ...hoverInput,
        expandedAnnotation: { id: "ann_1", body: "preview" },
      },
      compact ? [compact] : [],
    );

    expect(compact).toBeDefined();
    expect(hovered).toBeDefined();
    expect(expanded).toBeDefined();
    expect(hovered!.text).toBe("Short title");
    expect(hovered!.pill.width).toBeLessThan(expanded!.pill.width);
    const hoverTextRight =
      hovered!.actionButton?.x ??
      hovered!.pill.x + hovered!.pill.width - hovered!.appearance.paddingX;
    const hoverTextCapacity =
      hoverTextRight -
      (hovered!.pill.x +
        hovered!.appearance.paddingX +
        hovered!.appearance.sourceSlotWidth) -
      hovered!.appearance.textEndGap;
    expect(hoverTextCapacity).toBeGreaterThanOrEqual(
      ctx.measureText(hovered!.fullText).width,
    );
  });

  it("keeps expanded cards at least as wide as long hover pills", () => {
    const base = renderContext();
    const render: RenderContext = {
      ...base,
      coord: {
        ...base.coord,
        bounds: { x: 0, y: 0, width: 900, height: 420 },
        scales: {
          ...base.coord.scales,
          x: {
            extent: [0, 6],
            range: [80, 820],
            mode: "linear",
          },
          y: {
            right: { extent: [0, 100], range: [420, 0], mode: "linear" },
          },
        },
      },
      xPositions: base.data.map((_, index) => 80 + index * 120),
      xFn: (index: number) => 80 + index * 120,
      area: { x: 0, y: 0, width: 900, height: 420 },
    };
    const badges = {
      ann_1: [
        { id: "source_1", label: "Source one" },
        { id: "source_2", label: "Source two" },
        { id: "source_3", label: "Source three" },
      ],
    };
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "All-In Summit: AI5 chip, Optimus V3, Nevada AV license cleared",
      }),
    ];
    const [compact] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: badges,
    });
    const input = {
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: badges,
      expandedCardsByAnnotationId: {
        ann_1: {
          title: "Short card title",
          content: "Short card content.",
          questions: ["Why now?"],
        },
      },
    };
    const [hovered] = expandChartAnnotationPlacements(
      { ...input, hoveredAnnotationId: "ann_1" },
      compact ? [compact] : [],
    );
    const [expanded] = expandChartAnnotationPlacements(
      {
        ...input,
        expandedAnnotation: { id: "ann_1", body: "preview" },
      },
      compact ? [compact] : [],
    );

    expect(compact).toBeDefined();
    expect(hovered).toBeDefined();
    expect(expanded).toBeDefined();
    expect(hovered!.pill.width).toBeGreaterThan(
      compact!.appearance.expandedCardWidth,
    );
    expect(expanded!.pill.width).toBeCloseTo(hovered!.pill.width);
    expect(expanded!.hit.x + expanded!.hit.width).toBeGreaterThanOrEqual(
      hovered!.pill.x + hovered!.pill.width,
    );
  });

  it("sizes expanded-card hit geometry to full body content", () => {
    const base = renderContext();
    const render: RenderContext = {
      ...base,
      area: { x: 0, y: 0, width: 520, height: 640 },
      coord: {
        ...base.coord,
        bounds: { x: 0, y: 0, width: 520, height: 640 },
        scales: {
          ...base.coord.scales,
          x: { extent: [0, 6], range: [60, 460], mode: "linear" },
          y: {
            right: { extent: [0, 100], range: [640, 0], mode: "linear" },
          },
        },
      },
      xPositions: base.data.map((_, index) => 60 + index * 66),
      xFn: (index: number) => 60 + index * 66,
    };
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "Long body annotation",
      }),
    ];
    const [compact] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
    });
    const content = Array(4)
      .fill(
        [
          "At the summit, management described a larger roadmap and catalyst set.",
          "The full body includes enough detail to need more than the clipped card preview.",
          "After clicking more, hit-testing must retain the grown lower region.",
          "Otherwise moving the cursor into the visible lower area collapses the card.",
        ].join(" "),
      )
      .join(" ");
    const input = {
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      agentAnnotationIds: { ann_1: true } as const,
      expandedCardsByAnnotationId: {
        ann_1: {
          title: "Long body card",
          content,
          questions: ["What does this mean?", "Why now?"],
        },
      },
    };
    const [collapsedBody] = expandChartAnnotationPlacements(
      {
        ...input,
        expandedAnnotation: { id: "ann_1", body: "preview" },
      },
      compact ? [compact] : [],
    );
    const [expandedBody] = expandChartAnnotationPlacements(
      {
        ...input,
        expandedAnnotation: { id: "ann_1", body: "full" },
      },
      compact ? [compact] : [],
    );

    expect(collapsedBody).toBeDefined();
    expect(expandedBody).toBeDefined();
    expect(expandedBody!.pill.height).toBeGreaterThan(
      collapsedBody!.pill.height,
    );
    expect(expandedBody!.hit.height).toBeGreaterThan(collapsedBody!.hit.height);
  });

  it.each(["NoSpacesAtAll.".repeat(35), "line\n".repeat(20)])(
    "sizes inline body disclosure and hit geometry for wrapped text",
    (body) => {
      const record: ChartAnnotation.Renderable = {
        ...annotation({
          id: "drawing",
          start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        }),
        content: { title: "Explanation", content: body, questions: [] },
      };
      const base = renderContext();
      const render = { ...base, area: { ...base.area, height: 600 } };
      const input = {
        ctx,
        textCache: TextCache.create(),
        render,
        annotations: [record],
        expandedAnnotation: { id: record.id, body: "preview" as const },
      };
      const compact = layoutChartAnnotations({
        ...input,
        expandedAnnotation: undefined,
      });
      const [preview] = expandChartAnnotationPlacements(input, compact);
      const [full] = expandChartAnnotationPlacements(
        { ...input, expandedAnnotation: { id: record.id, body: "full" } },
        compact,
      );
      expect(preview?.bodyTruncated).toBe(true);
      expect(full?.bodyTruncated).toBe(false);
      expect(full!.pill.height).toBeGreaterThan(preview!.pill.height);
      expect(
        hitChartAnnotationPlacements({
          placements: [full!],
          pointer: {
            x: full!.pill.x + 20,
            y: full!.pill.y + full!.pill.height - 5,
          },
          expandedAnnotation: { id: record.id, body: "full" },
        }),
      ).toMatchObject({ id: record.id, bodyExpanded: true });
    },
  );

  it("does not expand agent annotation cards from active selection alone", () => {
    const render = renderContext();
    const [placement] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation({
          id: "ann_1",
          start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
          label: "Selected agent annotation",
        }),
      ],
      activeAnnotationId: "ann_1",
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      expandedCardsByAnnotationId: expandedCards("ann_1"),
    });

    expect(placement).toBeDefined();
    expect(placement!.state).toBe("compact");
  });

  it("pins manual pill leaders to wick-side targets from the pill centroid", () => {
    const render = renderContext();
    const base = {
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Agent annotation with fixed target",
    };
    const [upper] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation({
          ...base,
          anchor: {
            start: base.start,
            labelAnchor: {
              time: Date.parse("2026-05-05T13:30:00.000Z") / 1000,
              price: 85,
            },
          },
        }),
      ],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
    });
    const [lower] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation({
          ...base,
          anchor: {
            start: base.start,
            labelAnchor: {
              time: Date.parse("2026-05-05T13:30:00.000Z") / 1000,
              price: 15,
            },
          },
        }),
      ],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
    });

    expect(upper).toBeDefined();
    expect(lower).toBeDefined();
    expect(upper!.leader.to.x).toBeCloseTo(lower!.leader.to.x);
    expect(upper!.leader.to.y).toBeLessThan(200 - 65 * 2);
    expect(lower!.leader.to.y).toBeGreaterThan(200 - 39 * 2);
  });

  it("projects manual label anchors beyond the last data row inside the chart area", () => {
    const base = renderContext();
    const render: RenderContext = {
      ...base,
      coord: {
        ...base.coord,
        bounds: { x: 0, y: 0, width: 360, height: 200 },
      },
      xPositions: base.data.map((_, index) => 20 + index * 30),
      xFn: (index: number) => 20 + index * 30,
      area: { x: 0, y: 0, width: 360, height: 200 },
    };
    const [placement] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation({
          id: "ann_1",
          start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
          label: "A",
          anchor: {
            start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
            labelAnchor: {
              time: Date.parse("2026-05-09T13:30:00.000Z") / 1000,
              price: 70,
            },
          },
        }),
      ],
    });

    expect(placement).toBeDefined();
    expect(placement!.handles.label.x).toBeCloseTo(260);
    expect(placement!.handles.label.x).toBeGreaterThan(
      render.xPositions.at(-1)!,
    );
  });

  it("snaps annotation drag previews to wick-side targets from the pill centroid", () => {
    const render = renderContext();
    const annotationRecord = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Dragged agent annotation with fixed target",
      anchor: {
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        labelAnchor: {
          time: Date.parse("2026-05-05T13:30:00.000Z") / 1000,
          price: 85,
        },
      },
    });
    const input = {
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [annotationRecord],
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
    };
    const [placement] = layoutChartAnnotations(input);

    expect(placement).toBeDefined();
    const [preview] = previewChartAnnotationDragPlacements(
      input,
      [placement!],
      {
        id: "ann_1",
        anchor: {
          start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
          labelAnchor: {
            time: Date.parse("2026-05-05T13:30:00.000Z") / 1000,
            price: 15,
          },
        },
      },
    );

    expect(preview).toBeDefined();
    expect(preview!.leader.to.x).toBeCloseTo(placement!.leader.to.x);
    expect(preview!.leader.to.y).toBeGreaterThan(200 - 39 * 2);
  });

  it("does not re-solve neighboring compact placements when hovering", () => {
    const render = renderContext();
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-03T13:30:00.000Z") / 1000,
        label: "NVDA tops Q3 estimates",
      }),
      annotation({
        id: "ann_2",
        start: Date.parse("2026-05-05T13:30:00.000Z") / 1000,
        label: "Guidance raises outlook",
      }),
    ];
    const badges = {
      ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      ann_2: [{ id: "reuters", label: "Reuters" }],
    };
    const compact = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: badges,
    });
    const hovered = expandChartAnnotationPlacements(
      {
        ctx,
        textCache: TextCache.create(),
        render,
        annotations,
        hoveredAnnotationId: "ann_1",
        sourceBadgesByAnnotationId: badges,
        expandedCardsByAnnotationId: expandedCards("ann_1", "ann_2"),
      },
      compact,
    );
    const compactNeighbor = compact.find(
      (item) => item.annotation.id === "ann_2",
    );
    const hoveredNeighbor = hovered.find(
      (item) => item.annotation.id === "ann_2",
    );

    expect(compactNeighbor).toBeDefined();
    expect(hoveredNeighbor).toBeDefined();
    expectSameRect(hoveredNeighbor!.pill, compactNeighbor!.pill);
    expect(hoveredNeighbor!.state).toBe("compact");
  });

  it("lets hover ownership widen a different annotation than the selected one", () => {
    const render = renderContext();
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-03T13:30:00.000Z") / 1000,
        label: "Previously selected annotation",
      }),
      annotation({
        id: "ann_2",
        start: Date.parse("2026-05-05T13:30:00.000Z") / 1000,
        label: "Currently hovered annotation",
      }),
    ];
    const compact = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
        ann_2: [{ id: "reuters", label: "Reuters" }],
      },
    });
    const placements = expandChartAnnotationPlacements(
      {
        ctx,
        textCache: TextCache.create(),
        render,
        annotations,
        activeAnnotationId: "ann_1",
        hoveredAnnotationId: "ann_2",
        sourceBadgesByAnnotationId: {
          ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
          ann_2: [{ id: "reuters", label: "Reuters" }],
        },
        expandedCardsByAnnotationId: expandedCards("ann_1", "ann_2"),
      },
      compact,
    );

    expect(
      placements.find((item) => item.annotation.id === "ann_1")?.state,
    ).toBe("compact");
    expect(
      placements.find((item) => item.annotation.id === "ann_2")?.state,
    ).toBe("hover");
  });

  it("retains the hovered annotation hit inside its widened hover envelope", () => {
    const render = renderContext();
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "Layered hovered annotation",
      }),
      annotation({
        id: "ann_2",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "Neighboring layered annotation",
      }),
    ];
    const compact = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
        ann_2: [{ id: "reuters", label: "Reuters" }],
      },
    });
    const hoveredCompact = compact.find(
      (item) => item.annotation.id === "ann_1",
    );

    expect(hoveredCompact).toBeDefined();
    const hit = hitChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      hoveredAnnotationId: "ann_1",
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
        ann_2: [{ id: "reuters", label: "Reuters" }],
      },
      expandedCardsByAnnotationId: expandedCards("ann_1", "ann_2"),
      pointer: center(hoveredCompact!.pill),
    });

    expect(hit?.id).toBe("ann_1");
    expect(hit?.expanded).toBe(false);
    expect(hit?.part).toBe("body");
  });

  it("hit-tests the expand button on widened hover pills", () => {
    const render = renderContext();
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "Hovered annotation with expand affordance",
      }),
    ];
    const compact = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
    });
    const [hovered] = expandChartAnnotationPlacements(
      {
        ctx,
        textCache: TextCache.create(),
        render,
        annotations,
        hoveredAnnotationId: "ann_1",
        sourceBadgesByAnnotationId: {
          ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
        },
        expandedCardsByAnnotationId: expandedCards("ann_1"),
      },
      compact,
    );

    expect(hovered?.actionButton).toBeDefined();
    const hit = hitChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      hoveredAnnotationId: "ann_1",
      sourceBadgesByAnnotationId: {
        ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
      },
      expandedCardsByAnnotationId: expandedCards("ann_1"),
      pointer: center(hovered!.actionButton!),
    });

    expect(hit?.id).toBe("ann_1");
    expect(hit?.part).toBe("expand_button");
  });

  it("keeps a hovered pill retained when another target handle overlaps its expand button", () => {
    const retained = placement({
      annotation: annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "Retained hovered annotation",
      }),
      pill: { x: 100, y: 100, width: 320, height: 32 },
      hit: { x: 94, y: 94, width: 332, height: 44 },
      actionButton: { x: 388, y: 104, width: 24, height: 24 },
      handles: { target: { x: 40, y: 40 }, label: { x: 260, y: 116 } },
      state: "hover",
      zIndex: 0,
    });
    const overlappingHandle = placement({
      annotation: annotation({
        id: "ann_2",
        start: Date.parse("2026-05-05T13:30:00.000Z") / 1000,
        label: "Neighbor target",
      }),
      pill: { x: 430, y: 100, width: 160, height: 32 },
      handles: {
        target: center(retained.actionButton!),
        label: { x: 510, y: 116 },
      },
      zIndex: 10,
    });

    const hit = hitChartAnnotationPlacements({
      placements: [overlappingHandle, retained],
      hoveredAnnotationId: "ann_1",
      pointer: center(retained.actionButton!),
      zSorted: true,
    });

    expect(hit?.id).toBe("ann_1");
    expect(hit?.part).toBe("expand_button");
  });

  it("keeps an expanded card retained when another target handle overlaps it", () => {
    const expanded = placement({
      annotation: annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "Expanded card annotation",
      }),
      pill: { x: 80, y: 80, width: 520, height: 260 },
      hit: { x: 74, y: 74, width: 532, height: 272 },
      handles: { target: { x: 40, y: 40 }, label: { x: 340, y: 210 } },
      state: "expanded",
      zIndex: 0,
    });
    const overlappingHandle = placement({
      annotation: annotation({
        id: "ann_2",
        start: Date.parse("2026-05-05T13:30:00.000Z") / 1000,
        label: "Neighbor target",
      }),
      pill: { x: 620, y: 100, width: 160, height: 32 },
      handles: {
        target: { x: 420, y: 190 },
        label: { x: 700, y: 116 },
      },
      zIndex: 10,
    });

    const hit = hitChartAnnotationPlacements({
      placements: [overlappingHandle, expanded],
      expandedAnnotation: { id: "ann_1", body: "preview" },
      pointer: overlappingHandle.handles.target,
      zSorted: true,
    });

    expect(hit?.id).toBe("ann_1");
    expect(hit?.part).toBe("body");
  });

  it("hit-tests the full visible pill for layered annotations", () => {
    const render = renderContext();
    const annotations = [
      annotation({
        id: "ann_1",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "First layered annotation",
        anchor: {
          start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
          labelAnchor: {
            time: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
            price: 70,
          },
        },
      }),
      annotation({
        id: "ann_2",
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        label: "Second layered annotation",
        anchor: {
          start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
          labelAnchor: {
            time: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
            price: 70,
          },
        },
      }),
    ];
    const compact = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
    });
    const layered = compact.find((item) => item.layer > 0);

    expect(layered).toBeDefined();
    const hit = hitChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations,
      pointer: {
        x: layered!.pill.x + layered!.pill.width - 2,
        y: layered!.pill.y + layered!.pill.height - 2,
      },
    });

    expect(hit?.id).toBe(layered!.annotation.id);
  });

  it("does not hit-test annotation leader lines", () => {
    const render = renderContext();
    const [placement] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [
        annotation({
          id: "ann_1",
          start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
          anchor: {
            start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
            targetAnchor: {
              time: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
              price: 50,
            },
            labelAnchor: {
              time: Date.parse("2026-05-06T13:30:00.000Z") / 1000,
              price: 86,
            },
          },
        }),
      ],
    });

    expect(placement).toBeDefined();
    const hit = hitChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [placement!.annotation],
      pointer: midpoint(placement!.leader.from, placement!.leader.to),
    });

    expect(hit).toBeNull();
  });

  it("centers expanded cards on the annotation centroid", () => {
    const render = renderContext();
    const badges = {
      ann_1: [{ id: "bloomberg", label: "Bloomberg" }],
    };
    const selected = annotation({
      id: "ann_1",
      start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      label: "Centroid anchored expanded annotation",
      anchor: {
        start: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
        labelAnchor: {
          time: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
          price: 50,
        },
      },
    });
    const [compact] = layoutChartAnnotations({
      ctx,
      textCache: TextCache.create(),
      render,
      annotations: [selected],
      sourceBadgesByAnnotationId: badges,
    });
    const [expanded] = expandChartAnnotationPlacements(
      {
        ctx,
        textCache: TextCache.create(),
        render,
        annotations: [selected],
        expandedAnnotation: { id: "ann_1", body: "preview" },
        sourceBadgesByAnnotationId: badges,
        expandedCardsByAnnotationId: expandedCards("ann_1"),
      },
      compact ? [compact] : [],
    );

    expect(compact).toBeDefined();
    expect(expanded).toBeDefined();
    expect(expanded!.handles.label.x).toBeCloseTo(compact!.handles.label.x);
    expect(expanded!.handles.label.y).toBeCloseTo(compact!.handles.label.y);
    expect(center(expanded!.pill).x).toBeCloseTo(compact!.handles.label.x);
    expect(center(expanded!.pill).y).toBeCloseTo(compact!.handles.label.y);
  });
});
