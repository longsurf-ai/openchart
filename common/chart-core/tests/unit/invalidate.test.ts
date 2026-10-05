import { describe, it, expect } from "vitest";
import { Invalidate } from "@openchart/chart-core/invalidate";

describe("Invalidate", () => {
  describe("create", () => {
    it("creates empty mask with none level", () => {
      const mask = Invalidate.create();
      expect(mask.chart).toBe("none");
      expect(mask.panes).toEqual({});
    });
  });

  describe("chart", () => {
    it("sets chart level", () => {
      const mask = Invalidate.chart(Invalidate.create(), "cursor");
      expect(mask.chart).toBe("cursor");
    });

    it("upgrades to higher level", () => {
      let mask = Invalidate.create();
      mask = Invalidate.chart(mask, "cursor");
      mask = Invalidate.chart(mask, "full");
      expect(mask.chart).toBe("full");
    });

    it("does not downgrade to lower level", () => {
      let mask = Invalidate.create();
      mask = Invalidate.chart(mask, "full");
      mask = Invalidate.chart(mask, "cursor");
      expect(mask.chart).toBe("full");
    });

    it("preserves panes when setting chart level", () => {
      let mask = Invalidate.pane(Invalidate.create(), 0, "light");
      mask = Invalidate.chart(mask, "cursor");
      expect(mask.panes[0]).toBe("light");
    });
  });

  describe("pane", () => {
    it("sets pane level", () => {
      const mask = Invalidate.pane(Invalidate.create(), 0, "full");
      expect(mask.panes[0]).toBe("full");
    });

    it("handles multiple panes independently", () => {
      let mask = Invalidate.create();
      mask = Invalidate.pane(mask, 0, "full");
      mask = Invalidate.pane(mask, 1, "cursor");
      mask = Invalidate.pane(mask, 2, "light");

      expect(mask.panes[0]).toBe("full");
      expect(mask.panes[1]).toBe("cursor");
      expect(mask.panes[2]).toBe("light");
    });

    it("upgrades pane to higher level", () => {
      let mask = Invalidate.create();
      mask = Invalidate.pane(mask, 0, "cursor");
      mask = Invalidate.pane(mask, 0, "full");
      expect(mask.panes[0]).toBe("full");
    });

    it("does not downgrade pane level", () => {
      let mask = Invalidate.create();
      mask = Invalidate.pane(mask, 0, "full");
      mask = Invalidate.pane(mask, 0, "cursor");
      expect(mask.panes[0]).toBe("full");
    });
  });

  describe("get", () => {
    it("returns pane level", () => {
      const mask = Invalidate.pane(Invalidate.create(), 0, "light");
      expect(Invalidate.get(mask, 0)).toBe("light");
    });

    it("returns none for unset pane", () => {
      const mask = Invalidate.create();
      expect(Invalidate.get(mask, 5)).toBe("none");
    });

    it("inherits chart level if higher", () => {
      let mask = Invalidate.pane(Invalidate.create(), 0, "cursor");
      mask = Invalidate.chart(mask, "full");
      expect(Invalidate.get(mask, 0)).toBe("full");
    });

    it("uses pane level if higher than chart", () => {
      let mask = Invalidate.chart(Invalidate.create(), "cursor");
      mask = Invalidate.pane(mask, 0, "full");
      expect(Invalidate.get(mask, 0)).toBe("full");
    });
  });

  describe("merge", () => {
    it("merges two empty masks", () => {
      const a = Invalidate.create();
      const b = Invalidate.create();
      const result = Invalidate.merge(a, b);
      expect(result.chart).toBe("none");
      expect(result.panes).toEqual({});
    });

    it("takes higher chart level", () => {
      const a = Invalidate.chart(Invalidate.create(), "cursor");
      const b = Invalidate.chart(Invalidate.create(), "full");
      const result = Invalidate.merge(a, b);
      expect(result.chart).toBe("full");
    });

    it("merges panes from both masks", () => {
      const a = Invalidate.pane(Invalidate.create(), 0, "full");
      const b = Invalidate.pane(Invalidate.create(), 1, "light");
      const result = Invalidate.merge(a, b);
      expect(result.panes[0]).toBe("full");
      expect(result.panes[1]).toBe("light");
    });

    it("takes higher pane level when overlapping", () => {
      const a = Invalidate.pane(Invalidate.create(), 0, "cursor");
      const b = Invalidate.pane(Invalidate.create(), 0, "full");
      const result = Invalidate.merge(a, b);
      expect(result.panes[0]).toBe("full");
    });
  });

  describe("dirty", () => {
    it("returns false for empty mask", () => {
      expect(Invalidate.dirty(Invalidate.create())).toBe(false);
    });

    it("returns true when chart is dirty", () => {
      const mask = Invalidate.chart(Invalidate.create(), "cursor");
      expect(Invalidate.dirty(mask)).toBe(true);
    });

    it("returns true when pane is dirty", () => {
      const mask = Invalidate.pane(Invalidate.create(), 0, "light");
      expect(Invalidate.dirty(mask)).toBe(true);
    });

    it("returns false when all panes are none", () => {
      const mask = Invalidate.pane(Invalidate.create(), 0, "none");
      expect(Invalidate.dirty(mask)).toBe(false);
    });
  });

  describe("reset", () => {
    it("creates clean mask", () => {
      const mask = Invalidate.reset();
      expect(mask.chart).toBe("none");
      expect(mask.panes).toEqual({});
    });
  });

  describe("Level priority", () => {
    it("has correct priority order", () => {
      const levels: Invalidate.Level[] = ["none", "cursor", "light", "full"];
      for (let i = 0; i < levels.length - 1; i++) {
        let mask = Invalidate.create();
        mask = Invalidate.chart(mask, levels[i + 1]!);
        mask = Invalidate.chart(mask, levels[i]!);
        expect(mask.chart).toBe(levels[i + 1]);
      }
    });
  });
});
