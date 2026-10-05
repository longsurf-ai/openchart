// Purpose: Tests for shared pane layout and adjacent-pane resize math
// Module:  @openchart/chart-core / v2 / state

import { describe, expect, it } from "vitest";
import {
  paneHeightsWithAdjacentResize,
  paneLayouts,
  panesWithRuntimePaneHeights,
  resizeAdjacentPaneHeights,
} from "./pane-layout";

describe("paneLayouts", () => {
  it("projects proportional pane heights and pins the last pane to the remaining area", () => {
    const panes = [
      { id: "pane-main", index: 0, height: 2 },
      { id: "pane-metric", index: 1, height: 1 },
    ];

    expect(paneLayouts(panes, 600)).toEqual([
      { pane: panes[0], paneIndex: 0, top: 0, height: 400 },
      { pane: panes[1], paneIndex: 1, top: 400, height: 200 },
    ]);
  });
});

describe("panesWithRuntimePaneHeights", () => {
  it("projects runtime pane-height previews before layout", () => {
    const panes = [
      { id: "pane-main", index: 0, height: 300, objectIds: ["main"] },
      { id: "pane-metric", index: 1, height: 300, objectIds: ["metric"] },
    ];

    expect(
      panesWithRuntimePaneHeights(panes, {
        "pane-main": 500,
        "pane-metric": 100,
      }),
    ).toEqual([
      { id: "pane-main", index: 0, height: 500, objectIds: ["main"] },
      { id: "pane-metric", index: 1, height: 100, objectIds: ["metric"] },
    ]);
  });
});

describe("resizeAdjacentPaneHeights", () => {
  it("uses pointer speed scaled by total pane units", () => {
    const result = resizeAdjacentPaneHeights({
      topPaneId: "pane-main",
      bottomPaneId: "pane-metric",
      startY: 400,
      currentY: 500,
      topStartHeight: 1,
      bottomStartHeight: 1,
      totalStartHeight: 2,
      layoutAreaStartHeight: 600,
    });

    expect(result.topHeight).toBeCloseTo(1 + 100 * (2 / 600), 10);
    expect(result.bottomHeight).toBeCloseTo(1 - 100 * (2 / 600), 10);
  });

  it("applies adjacent resize results to a pane-height list", () => {
    expect(
      paneHeightsWithAdjacentResize(
        [
          { id: "pane-main", height: 1 },
          { id: "pane-metric", height: 1 },
          { id: "pane-third", height: 1 },
        ],
        {
          topPaneId: "pane-main",
          bottomPaneId: "pane-metric",
          startY: 400,
          currentY: 500,
          topStartHeight: 1,
          bottomStartHeight: 1,
          totalStartHeight: 3,
          layoutAreaStartHeight: 600,
        },
      ),
    ).toEqual([
      { id: "pane-main", height: 1.5 },
      { id: "pane-metric", height: 0.5 },
      { id: "pane-third", height: 1 },
    ]);
  });
});
