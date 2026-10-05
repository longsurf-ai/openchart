// Purpose: Shared pane layout and adjacent-pane resize math for v2 chart state
// Module:  @openchart/chart-core / v2 / state

import { ChartStateModel } from "./model";

export type PaneLike = {
  id: string;
  index: number;
  height: number;
};

export type PaneLayout<T extends PaneLike> = {
  pane: T;
  paneIndex: number;
  top: number;
  height: number;
};

export type PaneHeight = {
  id: string;
  height: number;
};

export type AdjacentPaneResizeInput = {
  topPaneId: string;
  bottomPaneId: string;
  startY: number;
  currentY: number;
  topStartHeight: number;
  bottomStartHeight: number;
  totalStartHeight: number;
  layoutAreaStartHeight: number;
};

export type AdjacentPaneResizeResult = {
  topHeight: number;
  bottomHeight: number;
};

export function paneLayouts<T extends PaneLike>(
  panes: readonly T[],
  areaHeight: number,
): Array<PaneLayout<T>> {
  const totalHeight = panes.reduce(
    (sum, pane) => sum + Math.max(1, pane.height),
    0,
  );
  let cursorY = 0;
  return panes.map((pane, paneIndex) => {
    const isLast = paneIndex === panes.length - 1;
    const height = isLast
      ? Math.max(0, areaHeight - cursorY)
      : Math.max(0, (Math.max(1, pane.height) / totalHeight) * areaHeight);
    const layout = { pane, paneIndex, top: cursorY, height };
    cursorY += height;
    return layout;
  });
}

export function panesWithRuntimePaneHeights<
  T extends { id: string; height: number },
>(panes: readonly T[], paneHeights: Record<string, number> | undefined): T[] {
  if (!paneHeights) return [...panes];
  return panes.map((pane) => ({
    ...pane,
    height: paneHeights[pane.id] ?? pane.height,
  }));
}

export function resizeAdjacentPaneHeights(
  input: AdjacentPaneResizeInput,
): AdjacentPaneResizeResult {
  const paneUnitPerPixel =
    input.layoutAreaStartHeight > 0
      ? input.totalStartHeight / input.layoutAreaStartHeight
      : 1;
  const dy = input.currentY - input.startY;
  const dyPaneUnits = dy * paneUnitPerPixel;
  const minPaneHeight = ChartStateModel.MIN_PANE_HEIGHT * paneUnitPerPixel;
  const totalAdjacentHeight = input.topStartHeight + input.bottomStartHeight;
  let topHeight = input.topStartHeight + dyPaneUnits;
  topHeight = Math.max(
    minPaneHeight,
    Math.min(totalAdjacentHeight - minPaneHeight, topHeight),
  );
  return {
    topHeight,
    bottomHeight: totalAdjacentHeight - topHeight,
  };
}

export function paneHeightsWithAdjacentResize(
  heights: readonly PaneHeight[],
  input: AdjacentPaneResizeInput,
): PaneHeight[] {
  const resized = resizeAdjacentPaneHeights(input);
  return heights.map((entry) => {
    if (entry.id === input.topPaneId) {
      return { ...entry, height: resized.topHeight };
    }
    if (entry.id === input.bottomPaneId) {
      return { ...entry, height: resized.bottomHeight };
    }
    return entry;
  });
}
