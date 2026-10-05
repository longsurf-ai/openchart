// Purpose: Define grid layout types, presets, and spatial math (create, parse, CSS generation, cell bounds)
// Module:  @openchart/chart-core / view

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace GridLayout {
  export const Preset = z.enum([
    "1x1",
    "1x2",
    "1x3",
    "1x4",
    "2x1",
    "2x2",
    "2x3",
    "2x4",
    "3x1",
    "3x2",
    "3x3",
    "3x4",
    "4x1",
    "4x2",
    "4x3",
    "4x4",
  ]);
  export type Preset = z.infer<typeof Preset>;

  export type Cell = {
    id: string;
    row: number;
    col: number;
  };

  export type ResizeState = {
    type: "col" | "row";
    index: number;
    startX: number;
    startY: number;
    startWidths: number[];
    startHeights: number[];
  };

  export type State = {
    preset: Preset;
    rows: number;
    cols: number;
    cells: Cell[];
    colWidths: number[];
    rowHeights: number[];
    width: number;
    height: number;
    collapsed: boolean;
    resizing: ResizeState | null;
  };

  export function parse(preset: Preset): { rows: number; cols: number } {
    const [rows, cols] = preset.split("x").map(Number);
    return { rows: rows!, cols: cols! };
  }

  export function create(preset: Preset, width: number, height: number): State {
    const { rows, cols } = parse(preset);

    const cells: Cell[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({ id: `${r}-${c}`, row: r, col: c });
      }
    }

    return {
      preset,
      rows,
      cols,
      cells,
      colWidths: Array(cols).fill(1 / cols),
      rowHeights: Array(rows).fill(1 / rows),
      width,
      height,
      collapsed: false,
      resizing: null,
    };
  }

  export function toCSSGrid(state: State): string {
    if (state.collapsed) {
      const cellCount = state.cells.length;
      return `grid-template-columns: 1fr; grid-template-rows: repeat(${cellCount}, 1fr);`;
    }

    const cols = state.colWidths.map((w) => `${w}fr`).join(" ");
    const rows = state.rowHeights.map((h) => `${h}fr`).join(" ");
    return `grid-template-columns: ${cols}; grid-template-rows: ${rows};`;
  }

  export function cellGridArea(
    cell: Cell,
    collapsed: boolean,
    cellIndex: number,
  ): string {
    if (collapsed) {
      return `${cellIndex + 1} / 1 / ${cellIndex + 2} / 2`;
    }
    return `${cell.row + 1} / ${cell.col + 1} / ${cell.row + 2} / ${cell.col + 2}`;
  }

  export function setSize(state: State, width: number, height: number): void {
    state.width = width;
    state.height = height;
  }

  export function collapse(state: State): void {
    state.collapsed = true;
  }

  export function expand(state: State): void {
    state.collapsed = false;
  }

  export function cellBounds(
    state: State,
    cellId: string,
  ): { x: number; y: number; width: number; height: number } | null {
    const cell = state.cells.find((c) => c.id === cellId);
    if (!cell) return null;

    if (state.collapsed) {
      const idx = state.cells.indexOf(cell);
      const cellHeight = state.height / state.cells.length;
      return {
        x: 0,
        y: idx * cellHeight,
        width: state.width,
        height: cellHeight,
      };
    }

    let x = 0;
    for (let c = 0; c < cell.col; c++) {
      x += state.colWidths[c]! * state.width;
    }

    let y = 0;
    for (let r = 0; r < cell.row; r++) {
      y += state.rowHeights[r]! * state.height;
    }

    return {
      x,
      y,
      width: state.colWidths[cell.col]! * state.width,
      height: state.rowHeights[cell.row]! * state.height,
    };
  }
}
