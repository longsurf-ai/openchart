// Purpose: Handle interactive drag-resize of grid columns and rows with minimum-size constraints
// Module:  @openchart/chart-core / view

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { GridLayout } from "./layout";

export namespace Resize {
  const MIN_CELL_PX = 100;

  export function startCol(
    state: GridLayout.State,
    index: number,
    x: number,
  ): void {
    if (index < 0 || index >= state.cols - 1) return;

    state.resizing = {
      type: "col",
      index,
      startX: x,
      startY: 0,
      startWidths: [...state.colWidths],
      startHeights: [...state.rowHeights],
    };
  }

  export function startRow(
    state: GridLayout.State,
    index: number,
    y: number,
  ): void {
    if (index < 0 || index >= state.rows - 1) return;

    state.resizing = {
      type: "row",
      index,
      startX: 0,
      startY: y,
      startWidths: [...state.colWidths],
      startHeights: [...state.rowHeights],
    };
  }

  export function move(state: GridLayout.State, x: number, y: number): void {
    if (!state.resizing) return;

    const { type, index, startWidths, startHeights, startX, startY } =
      state.resizing;

    if (type === "col") {
      const deltaFr = (x - startX) / state.width;
      applyColDelta(state, startWidths, index, deltaFr);
    } else {
      const deltaFr = (y - startY) / state.height;
      applyRowDelta(state, startHeights, index, deltaFr);
    }
  }

  export function end(state: GridLayout.State): void {
    state.resizing = null;
  }

  function applyColDelta(
    state: GridLayout.State,
    startWidths: number[],
    index: number,
    deltaFr: number,
  ): void {
    const minFr = MIN_CELL_PX / state.width;

    const newLeft = startWidths[index]! + deltaFr;
    const newRight = startWidths[index + 1]! - deltaFr;

    if (newLeft >= minFr && newRight >= minFr) {
      state.colWidths[index] = newLeft;
      state.colWidths[index + 1] = newRight;
      normalize(state.colWidths);
    }
  }

  function applyRowDelta(
    state: GridLayout.State,
    startHeights: number[],
    index: number,
    deltaFr: number,
  ): void {
    const minFr = MIN_CELL_PX / state.height;

    const newTop = startHeights[index]! + deltaFr;
    const newBottom = startHeights[index + 1]! - deltaFr;

    if (newTop >= minFr && newBottom >= minFr) {
      state.rowHeights[index] = newTop;
      state.rowHeights[index + 1] = newBottom;
      normalize(state.rowHeights);
    }
  }

  function normalize(sizes: number[]): void {
    const total = sizes.reduce((a, b) => a + b, 0);
    if (total === 0) return;
    for (let i = 0; i < sizes.length; i++) {
      sizes[i] = sizes[i]! / total;
    }
  }

  export function nearColHandle(
    state: GridLayout.State,
    x: number,
    threshold = 8,
  ): number | null {
    if (state.collapsed) return null;

    let currentX = 0;
    for (let i = 0; i < state.cols - 1; i++) {
      currentX += state.colWidths[i]! * state.width;
      if (Math.abs(x - currentX) <= threshold) {
        return i;
      }
    }
    return null;
  }

  export function nearRowHandle(
    state: GridLayout.State,
    y: number,
    threshold = 8,
  ): number | null {
    if (state.collapsed) return null;

    let currentY = 0;
    for (let i = 0; i < state.rows - 1; i++) {
      currentY += state.rowHeights[i]! * state.height;
      if (Math.abs(y - currentY) <= threshold) {
        return i;
      }
    }
    return null;
  }
}
