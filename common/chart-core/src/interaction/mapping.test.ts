// Purpose: Tests for Mapping — verifies modifier-aware action-to-command translation
// Module:  @openchart/chart-core / interaction

import { describe, it, expect } from "vitest";
import { Mapping } from "./mapping";
import { Action } from "./action";

const shift = { ...Action.noMods, shift: true };

describe("Mapping", () => {
  describe("translateXY mode", () => {
    it("emits both translateX and translateY commands", () => {
      const action = Action.drag(
        { type: "canvas" },
        { x: 150, y: 120 },
        { x: 100, y: 100 },
        shift,
      );
      const ctx: Mapping.Context = { config: Mapping.defaults };
      const cmds = Mapping.map(action, ctx);

      expect(cmds).toHaveLength(2);
      expect(cmds[0]).toEqual({ effect: "translateX", dx: 50 });
      expect(cmds[1]).toEqual({ effect: "translateY", dy: 20 });
    });

    it("uses total delta from start, not incremental", () => {
      const action = Action.drag(
        { type: "canvas" },
        { x: 200, y: 180 },
        { x: 100, y: 100 },
        shift,
      );
      const ctx: Mapping.Context = { config: Mapping.defaults };
      const cmds = Mapping.map(action, ctx);

      expect(cmds[0]).toEqual({ effect: "translateX", dx: 100 });
      expect(cmds[1]).toEqual({ effect: "translateY", dy: 80 });
    });
  });

  describe("translateY command", () => {
    it("omits scale for canvas region", () => {
      const action = Action.drag(
        { type: "canvas" },
        { x: 100, y: 150 },
        { x: 100, y: 100 },
        shift,
      );
      const ctx: Mapping.Context = { config: Mapping.defaults };
      const cmds = Mapping.map(action, ctx);

      const translateY = cmds.find((c) => c.effect === "translateY");
      expect(translateY).toBeDefined();
      expect(translateY!.effect).toBe("translateY");
      expect((translateY as { scale?: string }).scale).toBeUndefined();
    });

    it("includes scale for yscale region", () => {
      const action = Action.drag(
        { type: "yscale", scale: "price" },
        { x: 100, y: 150 },
        { x: 100, y: 100 },
        shift,
      );
      const ctx: Mapping.Context = { config: Mapping.defaults };
      const cmds = Mapping.map(action, ctx);

      expect(cmds).toHaveLength(1);
      expect(cmds[0]).toEqual({ effect: "translateY", scale: "price", dy: 50 });
    });
  });

  describe("canvas normal drag", () => {
    it("only emits translateX without shift", () => {
      const action = Action.drag(
        { type: "canvas" },
        { x: 150, y: 120 },
        { x: 100, y: 100 },
        Action.noMods,
      );
      const ctx: Mapping.Context = { config: Mapping.defaults };
      const cmds = Mapping.map(action, ctx);

      expect(cmds).toHaveLength(1);
      expect(cmds[0]).toEqual({ effect: "translateX", dx: 50 });
    });
  });
});
