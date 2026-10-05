import { describe, it, expect } from "vitest";
import { GridLayout } from "@openchart/chart-core/view/layout";
import { Resize } from "@openchart/chart-core/view/resize";
import { Responsive } from "@openchart/chart-core/view/responsive";

describe("GridLayout", () => {
  describe("parse", () => {
    it("parses 1x1 preset", () => {
      expect(GridLayout.parse("1x1")).toEqual({ rows: 1, cols: 1 });
    });

    it("parses 2x3 preset", () => {
      expect(GridLayout.parse("2x3")).toEqual({ rows: 2, cols: 3 });
    });

    it("parses 4x4 preset", () => {
      expect(GridLayout.parse("4x4")).toEqual({ rows: 4, cols: 4 });
    });
  });

  describe("create", () => {
    it("creates state with correct dimensions", () => {
      const state = GridLayout.create("2x2", 800, 600);

      expect(state.preset).toBe("2x2");
      expect(state.rows).toBe(2);
      expect(state.cols).toBe(2);
      expect(state.width).toBe(800);
      expect(state.height).toBe(600);
    });

    it("creates correct number of cells", () => {
      const state = GridLayout.create("3x2", 800, 600);

      expect(state.cells.length).toBe(6);
    });

    it("assigns cell IDs based on row-col", () => {
      const state = GridLayout.create("2x2", 800, 600);

      expect(state.cells.map((c) => c.id)).toEqual([
        "0-0",
        "0-1",
        "1-0",
        "1-1",
      ]);
    });

    it("initializes equal column widths", () => {
      const state = GridLayout.create("1x3", 900, 600);

      expect(state.colWidths).toEqual([1 / 3, 1 / 3, 1 / 3]);
    });

    it("initializes equal row heights", () => {
      const state = GridLayout.create("3x1", 800, 600);

      expect(state.rowHeights).toEqual([1 / 3, 1 / 3, 1 / 3]);
    });

    it("starts uncollapsed", () => {
      const state = GridLayout.create("2x2", 800, 600);

      expect(state.collapsed).toBe(false);
    });
  });

  describe("toCSSGrid", () => {
    it("generates correct grid template for 2x2", () => {
      const state = GridLayout.create("2x2", 800, 600);
      const css = GridLayout.toCSSGrid(state);

      expect(css).toContain("grid-template-columns: 0.5fr 0.5fr");
      expect(css).toContain("grid-template-rows: 0.5fr 0.5fr");
    });

    it("generates single column when collapsed", () => {
      const state = GridLayout.create("2x2", 800, 600);
      GridLayout.collapse(state);
      const css = GridLayout.toCSSGrid(state);

      expect(css).toContain("grid-template-columns: 1fr");
      expect(css).toContain("grid-template-rows: repeat(4, 1fr)");
    });
  });

  describe("cellGridArea", () => {
    it("returns correct grid area for cell", () => {
      const cell = { id: "1-2", row: 1, col: 2 };
      const area = GridLayout.cellGridArea(cell, false, 0);

      expect(area).toBe("2 / 3 / 3 / 4");
    });

    it("returns row index when collapsed", () => {
      const cell = { id: "1-2", row: 1, col: 2 };
      const area = GridLayout.cellGridArea(cell, true, 5);

      expect(area).toBe("6 / 1 / 7 / 2");
    });
  });

  describe("cellBounds", () => {
    it("calculates bounds for first cell", () => {
      const state = GridLayout.create("2x2", 800, 600);
      const bounds = GridLayout.cellBounds(state, "0-0");

      expect(bounds).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    });

    it("calculates bounds for last cell", () => {
      const state = GridLayout.create("2x2", 800, 600);
      const bounds = GridLayout.cellBounds(state, "1-1");

      expect(bounds).toEqual({ x: 400, y: 300, width: 400, height: 300 });
    });

    it("returns null for invalid cell id", () => {
      const state = GridLayout.create("2x2", 800, 600);
      const bounds = GridLayout.cellBounds(state, "invalid");

      expect(bounds).toBeNull();
    });

    it("calculates collapsed bounds", () => {
      const state = GridLayout.create("2x2", 800, 600);
      GridLayout.collapse(state);

      const bounds = GridLayout.cellBounds(state, "1-0");
      expect(bounds).toEqual({ x: 0, y: 300, width: 800, height: 150 });
    });
  });

  describe("collapse/expand", () => {
    it("sets collapsed flag on collapse", () => {
      const state = GridLayout.create("2x2", 800, 600);
      GridLayout.collapse(state);

      expect(state.collapsed).toBe(true);
    });

    it("clears collapsed flag on expand", () => {
      const state = GridLayout.create("2x2", 800, 600);
      GridLayout.collapse(state);
      GridLayout.expand(state);

      expect(state.collapsed).toBe(false);
    });
  });
});

describe("Resize", () => {
  describe("startCol", () => {
    it("sets resizing state for column", () => {
      const state = GridLayout.create("2x2", 800, 600);
      Resize.startCol(state, 0, 400);

      expect(state.resizing).not.toBeNull();
      expect(state.resizing!.type).toBe("col");
      expect(state.resizing!.index).toBe(0);
    });

    it("does not start resize for invalid column", () => {
      const state = GridLayout.create("2x2", 800, 600);
      Resize.startCol(state, 5, 400);

      expect(state.resizing).toBeNull();
    });
  });

  describe("startRow", () => {
    it("sets resizing state for row", () => {
      const state = GridLayout.create("2x2", 800, 600);
      Resize.startRow(state, 0, 300);

      expect(state.resizing).not.toBeNull();
      expect(state.resizing!.type).toBe("row");
      expect(state.resizing!.index).toBe(0);
    });
  });

  describe("move", () => {
    it("adjusts column widths", () => {
      const state = GridLayout.create("2x2", 800, 600);
      Resize.startCol(state, 0, 400);
      Resize.move(state, 500, 0);

      expect(state.colWidths[0]).toBeGreaterThan(0.5);
      expect(state.colWidths[1]).toBeLessThan(0.5);
    });

    it("respects minimum cell size", () => {
      const state = GridLayout.create("2x2", 800, 600);
      Resize.startCol(state, 0, 400);
      Resize.move(state, 750, 0);

      expect(state.colWidths[1]! * state.width).toBeGreaterThanOrEqual(100);
    });
  });

  describe("end", () => {
    it("clears resizing state", () => {
      const state = GridLayout.create("2x2", 800, 600);
      Resize.startCol(state, 0, 400);
      Resize.end(state);

      expect(state.resizing).toBeNull();
    });
  });

  describe("nearColHandle", () => {
    it("returns handle index when near column edge", () => {
      const state = GridLayout.create("2x2", 800, 600);
      const handle = Resize.nearColHandle(state, 402);

      expect(handle).toBe(0);
    });

    it("returns null when not near any handle", () => {
      const state = GridLayout.create("2x2", 800, 600);
      const handle = Resize.nearColHandle(state, 200);

      expect(handle).toBeNull();
    });

    it("returns null when collapsed", () => {
      const state = GridLayout.create("2x2", 800, 600);
      GridLayout.collapse(state);
      const handle = Resize.nearColHandle(state, 400);

      expect(handle).toBeNull();
    });
  });

  describe("nearRowHandle", () => {
    it("returns handle index when near row edge", () => {
      const state = GridLayout.create("2x2", 800, 600);
      const handle = Resize.nearRowHandle(state, 302);

      expect(handle).toBe(0);
    });

    it("returns null when not near any handle", () => {
      const state = GridLayout.create("2x2", 800, 600);
      const handle = Resize.nearRowHandle(state, 150);

      expect(handle).toBeNull();
    });
  });
});

describe("Responsive", () => {
  describe("shouldCollapse", () => {
    it("returns true for multi-column layout on narrow screen", () => {
      expect(Responsive.shouldCollapse(600, "2x2")).toBe(true);
    });

    it("returns false for multi-column layout on wide screen", () => {
      expect(Responsive.shouldCollapse(1000, "2x2")).toBe(false);
    });

    it("returns false for single-column layout regardless of width", () => {
      expect(Responsive.shouldCollapse(400, "2x1")).toBe(false);
      expect(Responsive.shouldCollapse(400, "4x1")).toBe(false);
    });
  });
});
