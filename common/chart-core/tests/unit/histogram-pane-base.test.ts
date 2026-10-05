// Purpose: Tests for histogram zero baseline placement inside pane-scoped axes
// Module:  @openchart/chart-core / tests

import { describe, expect, it } from "vitest";
import { createCartesian2D } from "@openchart/chart-core/coord/cartesian";
import { DataView } from "@openchart/chart-core/data/view";
import { HistogramSeries } from "@openchart/chart-core/series/builtin";

describe("HistogramSeries pane anchoring", () => {
  it("anchors baseY to the active y-scale range instead of full chart bottom", () => {
    const coord = createCartesian2D(
      { x: 0, y: 0, width: 400, height: 300 },
      {
        x: { min: 0, max: 1 },
        y: { "pane-2:right": { min: 0, max: 100 } },
      },
      "pane-2:right",
      {
        "pane-2:right": { from: 0.5, to: 1, mode: "linear" },
      },
    );

    const view = DataView.create(
      "Histogram",
      [{ value: 40 }],
      { from: 0, to: 1 },
      (i) => i * 20,
    );
    const items = HistogramSeries.transform(
      view,
      coord,
      6,
      { ...HistogramSeries.defaultOptions, color: "#22c55e" },
      {},
    ) as Array<{ baseY: number; y: number }>;

    expect(items).toHaveLength(1);
    expect(items[0]!.baseY).toBeCloseTo(150, 6);
    expect(items[0]!.y).toBeLessThan(items[0]!.baseY);
  });
});
