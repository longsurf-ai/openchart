// Purpose: Tests for in-plot Marker hit-testing
// Module:  @openchart/chart-core / marker

import { ProviderListing } from "@openchart/chart-core/market/provider-listing";
import { describe, expect, it } from "vitest";
import { hitMarkers } from "./hit";
import { MarkerRenderUtils } from "./render";
import type { RenderContext } from "@openchart/chart-core/drawing";
import { SpanRenderUtils } from "@openchart/chart-core/span";
import type { Marker } from "./types";

const render: RenderContext = {
  coord: {
    type: "cartesian2d",
    bounds: { x: 0, y: 0, width: 80, height: 120 },
    defaultYScale: "right",
    scales: {
      x: { extent: [0, 1], range: [0, 80], mode: "linear" },
      y: {},
    },
  },
  xPositions: [10, 30, 50],
  xFn: (index) => 10 + index * 20,
  data: [
    { time: 1_700_000_000 },
    { time: 1_700_086_400 },
    { time: 1_700_172_800 },
  ],
  visibleRange: { from: 0, to: 3 },
  area: { x: 0, y: 0, width: 80, height: 120 },
};

const marker = {
  id: "marker_1",
  type: "earnings",
  dashboardId: "dash_1",
  market: ProviderListing.parse({
    provider: "test",
    listing: { symbol: "AAPL", currency: "USD" },
  }),
  at: new Date(1_700_086_400_000).toISOString(),
  earningsReportId: "earnings_1",
  reportDate: "2023-11-15",
  reportTime: "amc",
  fiscalYear: 2023,
  fiscalQuarter: 4,
  periodEnd: "2023-09-30",
  epsActual: 1.5,
  epsEstimate: 1.4,
  epsSurprise: 0.1,
  epsSurprisePercent: 7.14,
  revenueActual: 100,
  revenueEstimate: 98,
  revenueSurprise: 2,
  revenueSurprisePercent: 2.04,
  transcript: null,
  createdAt: new Date(1_700_000_000_000).toISOString(),
  updatedAt: new Date(1_700_000_000_000).toISOString(),
} satisfies Marker.Record;

describe("hitMarkers", () => {
  it("returns a marker hit near the pin center", () => {
    expect(
      hitMarkers({
        pointer: { x: 30, y: 130 },
        render,
        stripArea: { x: 0, y: 120, width: 80, height: 20 },
        markers: [marker],
      }),
    ).toMatchObject({ kind: "marker", id: "marker_1" });
  });

  it("ignores points outside the event lane", () => {
    expect(
      hitMarkers({
        pointer: { x: 30, y: 90 },
        render,
        stripArea: { x: 0, y: 120, width: 80, height: 20 },
        markers: [marker],
      }),
    ).toBeNull();
  });

  it("anchors marker hits to the supplied pane-local event lane", () => {
    const paneRender = {
      ...render,
      area: { x: 0, y: 0, width: 80, height: 80 },
    } satisfies RenderContext;
    const stripArea = SpanRenderUtils.eventLaneArea(paneRender);
    const [geometry] = MarkerRenderUtils.layoutMarkerIcons(
      paneRender,
      stripArea,
      [marker],
    );

    expect(
      hitMarkers({
        pointer: { x: geometry!.x, y: geometry!.y },
        render: paneRender,
        stripArea,
        markers: [marker],
      }),
    ).toMatchObject({ kind: "marker", id: "marker_1" });
    expect(
      hitMarkers({
        pointer: { x: 30, y: 130 },
        render: paneRender,
        stripArea,
        markers: [marker],
      }),
    ).toBeNull();
  });

  it("does not clamp out-of-range markers onto the chart edge", () => {
    expect(
      hitMarkers({
        pointer: { x: 50, y: 130 },
        render,
        stripArea: { x: 0, y: 120, width: 80, height: 20 },
        markers: [
          {
            ...marker,
            at: new Date(1_700_259_200_000).toISOString(),
          },
        ],
      }),
    ).toBeNull();
  });

  it("projects numeric daily chart data onto marker pins", () => {
    const businessDayRender = {
      ...render,
      data: [
        { time: Date.UTC(2023, 10, 14) / 1000 },
        { time: Date.UTC(2023, 10, 15) / 1000 },
        { time: Date.UTC(2023, 10, 16) / 1000 },
      ],
    } satisfies RenderContext;
    const businessDayMarker = {
      ...marker,
      at: "2023-11-15T00:00:00.000Z",
    } satisfies Marker.Record;
    expect(
      hitMarkers({
        pointer: { x: 30, y: 130 },
        render: businessDayRender,
        stripArea: { x: 0, y: 120, width: 80, height: 20 },
        markers: [businessDayMarker],
      }),
    ).toMatchObject({ kind: "marker", id: "marker_1" });
  });

  it("folds close markers into a single overlapped stack", () => {
    const geometries = MarkerRenderUtils.layoutMarkerIcons(
      render,
      { x: 0, y: 120, width: 80, height: 20 },
      [
        marker,
        {
          ...marker,
          id: "marker_2",
          earningsReportId: "earnings_2",
        },
      ],
    );

    expect(geometries).toHaveLength(2);
    expect(geometries[0]).toMatchObject({
      stacked: true,
      stackSize: 2,
      y: geometries[1]?.y,
    });
    expect(Math.abs(geometries[0]!.x - geometries[1]!.x)).toBeLessThan(10);
  });

  it("fans a folded stack around the active marker for selection", () => {
    const markers = [
      marker,
      {
        ...marker,
        id: "marker_2",
        earningsReportId: "earnings_2",
      },
    ];
    const geometries = MarkerRenderUtils.layoutMarkerIcons(
      render,
      { x: 0, y: 120, width: 80, height: 20 },
      markers,
      "marker_1",
    );

    expect(geometries).toHaveLength(2);
    expect(geometries[0]).toMatchObject({ expanded: true });
    expect(Math.abs(geometries[0]!.x - geometries[1]!.x)).toBeGreaterThan(18);
    expect(
      hitMarkers({
        pointer: { x: geometries[1]!.x, y: geometries[1]!.y },
        render,
        stripArea: { x: 0, y: 120, width: 80, height: 20 },
        markers,
        expandedMarkerId: "marker_1",
      }),
    ).toMatchObject({ kind: "marker", id: "marker_2" });
  });

  it("keeps an expanded stack hittable while the pointer crosses the folded footprint", () => {
    const markers = [
      marker,
      {
        ...marker,
        id: "marker_2",
        earningsReportId: "earnings_2",
      },
      {
        ...marker,
        id: "marker_3",
        earningsReportId: "earnings_3",
      },
    ];
    const collapsed = MarkerRenderUtils.layoutMarkerIcons(
      render,
      { x: 0, y: 120, width: 80, height: 20 },
      markers,
    );
    const center = collapsed.reduce((total, item) => total + item.x, 0) / 3;

    expect(
      hitMarkers({
        pointer: { x: center, y: collapsed[0]!.y },
        render,
        stripArea: { x: 0, y: 120, width: 80, height: 20 },
        markers,
        expandedMarkerId: "marker_2",
      }),
    ).toMatchObject({ kind: "marker", stacked: true });
  });
});
