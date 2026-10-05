import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScaleButtons } from "@openchart/chart-core/scale/buttons";

describe("ScaleButtons", () => {
  describe("layout", () => {
    it("returns A/L at bottom row with menu below", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const layout = ScaleButtons.layout(bounds);

      expect(layout.buttons.length).toBe(3);
      const auto = layout.buttons.find((button) => button.type === "auto")!;
      const log = layout.buttons.find((button) => button.type === "log")!;
      const menu = layout.buttons.find((button) => button.type === "menu")!;

      expect(auto.y).toBe(log.y);
      expect(auto.x).toBeLessThan(log.x);
      expect(menu.y).toBeGreaterThan(auto.y);
      expect(auto.y).toBeGreaterThan(bounds.height / 2);
      expect(auto.y + auto.height).toBeLessThanOrEqual(bounds.height);
      expect(menu.y + menu.height).toBeLessThanOrEqual(bounds.height);
    });

    it("uses expected button labels", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const layout = ScaleButtons.layout(bounds);

      expect(layout.buttons.map((button) => button.label)).toEqual([
        "A",
        "L",
        "⋯",
      ]);
    });

    it("includes auto, log, and menu buttons", () => {
      const bounds = { x: 0, y: 0, width: 60, height: 400 };
      const layout = ScaleButtons.layout(bounds);

      const types = layout.buttons.map((b) => b.type);
      expect(types).toContain("auto");
      expect(types).toContain("log");
      expect(types).toContain("menu");
    });
  });

  describe("hitTest", () => {
    it("returns auto when clicking auto button", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const layout = ScaleButtons.layout(bounds);
      const auto = layout.buttons.find((b) => b.type === "auto")!;

      // Click center of button
      const hit = ScaleButtons.hitTest(
        auto.x + auto.width / 2,
        auto.y + auto.height / 2,
        bounds,
      );
      expect(hit).toBe("auto");
    });

    it("returns log when clicking log button", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const layout = ScaleButtons.layout(bounds);
      const log = layout.buttons.find((b) => b.type === "log")!;

      // Click center of button
      const hit = ScaleButtons.hitTest(
        log.x + log.width / 2,
        log.y + log.height / 2,
        bounds,
      );
      expect(hit).toBe("log");
    });

    it("returns menu when clicking menu button", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const layout = ScaleButtons.layout(bounds);
      const menu = layout.buttons.find((b) => b.type === "menu")!;

      const hit = ScaleButtons.hitTest(
        menu.x + menu.width / 2,
        menu.y + menu.height / 2,
        bounds,
      );
      expect(hit).toBe("menu");
    });

    it("returns null when clicking outside buttons", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };

      const hit = ScaleButtons.hitTest(741, 1, bounds);
      expect(hit).toBeNull();
    });

    it("returns null when clicking outside bounds", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };

      const hit = ScaleButtons.hitTest(100, 100, bounds);
      expect(hit).toBeNull();
    });

    it("detects click within button bounds", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const layout = ScaleButtons.layout(bounds);
      const auto = layout.buttons.find((b) => b.type === "auto")!;

      // Click at edge of button should still hit
      const hit = ScaleButtons.hitTest(auto.x + 1, auto.y + 1, bounds);
      expect(hit).toBe("auto");
    });
  });

  describe("render", () => {
    const mockCtx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "center" as CanvasTextAlign,
      textBaseline: "middle" as CanvasTextBaseline,
    } as unknown as CanvasRenderingContext2D;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("renders nothing when not hovered", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const scale = { autoScale: true, mode: "normal" as const };

      ScaleButtons.render(mockCtx, scale, bounds, false);

      expect(mockCtx.beginPath).not.toHaveBeenCalled();
    });

    it("renders backdrop plus three buttons when hovered", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const scale = { autoScale: true, mode: "normal" as const };

      ScaleButtons.render(mockCtx, scale, bounds, true);

      expect(mockCtx.beginPath).toHaveBeenCalledTimes(4);
    });

    it("highlights auto button when autoScale is true", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const scale = { autoScale: true, mode: "normal" as const };

      ScaleButtons.render(mockCtx, scale, bounds, true);

      // Auto button should be filled when active
      expect(mockCtx.fill).toHaveBeenCalled();
    });

    it("highlights log button when mode is logarithmic", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const scale = { autoScale: false, mode: "logarithmic" as const };

      ScaleButtons.render(mockCtx, scale, bounds, true);

      expect(mockCtx.fill).toHaveBeenCalled();
    });

    it("renders button labels when hovered", () => {
      const bounds = { x: 740, y: 0, width: 60, height: 400 };
      const scale = { autoScale: true, mode: "normal" as const };

      ScaleButtons.render(mockCtx, scale, bounds, true);

      expect(mockCtx.fillText).toHaveBeenCalledTimes(3);
    });
  });

  describe("toggle", () => {
    it("toggles auto off and sets visibleExtent", () => {
      const scale = {
        autoScale: true,
        mode: "normal" as const,
        visibleExtent: undefined as { min: number; max: number } | undefined,
      };
      const extent = { min: 100, max: 200 };

      ScaleButtons.toggle(scale, "auto", extent);

      expect(scale.autoScale).toBe(false);
      expect(scale.visibleExtent).toEqual(extent);
    });

    it("toggles auto on and clears visibleExtent", () => {
      const scale = {
        autoScale: false,
        mode: "normal" as const,
        visibleExtent: { min: 100, max: 200 },
      };

      ScaleButtons.toggle(scale, "auto", { min: 0, max: 100 });

      expect(scale.autoScale).toBe(true);
      expect(scale.visibleExtent).toBeUndefined();
    });

    it("toggles log mode on", () => {
      const scale = {
        autoScale: true,
        mode: "normal" as const,
      };

      ScaleButtons.toggle(scale, "log", { min: 0, max: 100 });

      expect(scale.mode).toBe("logarithmic");
    });

    it("toggles log mode off", () => {
      const scale = {
        autoScale: true,
        mode: "logarithmic" as const,
      };

      ScaleButtons.toggle(scale, "log", { min: 0, max: 100 });

      expect(scale.mode).toBe("normal");
    });

    it("does nothing when toggling menu button", () => {
      const scale = {
        autoScale: true,
        mode: "normal" as const,
        visibleExtent: undefined as { min: number; max: number } | undefined,
      };

      ScaleButtons.toggle(scale, "menu", { min: 0, max: 100 });

      expect(scale.autoScale).toBe(true);
      expect(scale.mode).toBe("normal");
      expect(scale.visibleExtent).toBeUndefined();
    });
  });
});
