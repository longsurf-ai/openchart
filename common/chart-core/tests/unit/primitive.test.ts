import { describe, it, expect, vi } from "vitest";
import { Primitive, PriceLine, Marker } from "@openchart/chart-core/primitive";

describe("Primitive", () => {
  describe("ZOrder", () => {
    it("parses valid z-orders", () => {
      expect(Primitive.ZOrder.parse("background")).toBe("background");
      expect(Primitive.ZOrder.parse("normal")).toBe("normal");
      expect(Primitive.ZOrder.parse("top")).toBe("top");
    });
  });

  describe("view", () => {
    it("creates pane view", () => {
      const renderer = { draw: vi.fn() };
      const view = Primitive.view("normal", renderer);
      expect(view.zOrder()).toBe("normal");
      expect(view.renderer()).toBe(renderer);
    });
  });
});

describe("PriceLine", () => {
  describe("Options", () => {
    it("parses with defaults", () => {
      const opts = PriceLine.Options.parse({ price: 100 });
      expect(opts.price).toBe(100);
      expect(opts.color).toBe("#758696");
      expect(opts.lineWidth).toBe(1);
      expect(opts.lineStyle).toBe("solid");
      expect(opts.title).toBe("");
      expect(opts.axisLabelVisible).toBe(true);
    });

    it("accepts custom options", () => {
      const opts = PriceLine.Options.parse({
        price: 150,
        color: "#ff0000",
        lineWidth: 2,
        lineStyle: "dashed",
        title: "Support",
        axisLabelVisible: false,
      });
      expect(opts.price).toBe(150);
      expect(opts.color).toBe("#ff0000");
      expect(opts.lineWidth).toBe(2);
      expect(opts.lineStyle).toBe("dashed");
      expect(opts.title).toBe("Support");
      expect(opts.axisLabelVisible).toBe(false);
    });
  });

  describe("create", () => {
    it("creates price line primitive", () => {
      const line = PriceLine.create({ price: 100 });
      expect(line.id).toBeDefined();
      expect(line.id).toContain("price-line-");
      expect(line.zOrder).toBe("normal");
    });

    it("returns pane views array", () => {
      const line = PriceLine.create({ price: 100 });
      const views = line.paneViews();
      expect(Array.isArray(views)).toBe(true);
    });

    it("has updateAllViews method", () => {
      const line = PriceLine.create({ price: 100 });
      expect(line.updateAllViews).toBeDefined();
    });

    it("has hitTest method", () => {
      const line = PriceLine.create({ price: 100 });
      expect(line.hitTest).toBeDefined();
    });
  });

  describe("manager", () => {
    it("creates manager", () => {
      const attach = vi.fn();
      const detach = vi.fn();
      const mgr = PriceLine.manager(attach, detach);

      expect(mgr.lines).toBeDefined();
      expect(mgr.add).toBeDefined();
      expect(mgr.remove).toBeDefined();
      expect(mgr.update).toBeDefined();
      expect(mgr.all).toBeDefined();
    });

    it("adds price lines", () => {
      const attach = vi.fn();
      const detach = vi.fn();
      const mgr = PriceLine.manager(attach, detach);

      const id = mgr.add({ price: 100 });

      expect(id).toBeDefined();
      expect(attach).toHaveBeenCalled();
    });

    it("removes price lines", () => {
      const attach = vi.fn();
      const detach = vi.fn().mockReturnValue(true);
      const mgr = PriceLine.manager(attach, detach);

      const id = mgr.add({ price: 100 });
      const result = mgr.remove(id);

      expect(result).toBe(true);
      expect(detach).toHaveBeenCalledWith(id);
    });

    it("updates price lines", () => {
      const attach = vi.fn();
      const detach = vi.fn();
      const mgr = PriceLine.manager(attach, detach);

      const id = mgr.add({ price: 100, color: "#ff0000" });
      const result = mgr.update(id, { price: 150 });

      expect(result).toBe(true);
    });

    it("lists all price lines", () => {
      const attach = vi.fn();
      const detach = vi.fn();
      const mgr = PriceLine.manager(attach, detach);

      mgr.add({ price: 100 });
      mgr.add({ price: 200 });

      const all = mgr.all();
      expect(all).toHaveLength(2);
    });
  });
});

describe("Marker", () => {
  describe("Shape", () => {
    it("parses valid shapes", () => {
      expect(Marker.Shape.parse("circle")).toBe("circle");
      expect(Marker.Shape.parse("square")).toBe("square");
      expect(Marker.Shape.parse("arrowUp")).toBe("arrowUp");
      expect(Marker.Shape.parse("arrowDown")).toBe("arrowDown");
    });
  });

  describe("Position", () => {
    it("parses valid positions", () => {
      expect(Marker.Position.parse("aboveBar")).toBe("aboveBar");
      expect(Marker.Position.parse("belowBar")).toBe("belowBar");
      expect(Marker.Position.parse("inBar")).toBe("inBar");
    });
  });

  describe("Item", () => {
    it("parses with defaults", () => {
      const item = Marker.Item.parse({ time: 1000 });
      expect(item.time).toBe(1000);
      expect(item.position).toBe("aboveBar");
      expect(item.shape).toBe("circle");
      expect(item.color).toBe("#2196F3");
      expect(item.size).toBe(1);
    });

    it("accepts custom options", () => {
      const item = Marker.Item.parse({
        time: 1000,
        position: "belowBar",
        shape: "arrowUp",
        color: "#00ff00",
        text: "Buy",
        size: 2,
      });
      expect(item.position).toBe("belowBar");
      expect(item.shape).toBe("arrowUp");
      expect(item.color).toBe("#00ff00");
      expect(item.text).toBe("Buy");
      expect(item.size).toBe(2);
    });

    it("accepts time as object", () => {
      const item = Marker.Item.parse({
        time: { year: 2025, month: 1, day: 15 },
      });
      expect(item.time).toEqual({ year: 2025, month: 1, day: 15 });
    });

    it("accepts time as string", () => {
      const item = Marker.Item.parse({ time: "2025-01-15" });
      expect(item.time).toBe("2025-01-15");
    });
  });

  describe("create", () => {
    it("creates marker primitive", () => {
      const marker = Marker.create();
      expect(marker.id).toBeDefined();
      expect(marker.id).toContain("markers-");
      expect(marker.zOrder).toBe("top");
    });

    it("accepts initial items", () => {
      const items = [
        { time: 1000, text: "A" },
        { time: 2000, text: "B" },
      ];
      const marker = Marker.create(items);
      expect(marker.id).toBeDefined();
    });

    it("returns pane views array", () => {
      const marker = Marker.create();
      const views = marker.paneViews();
      expect(Array.isArray(views)).toBe(true);
    });

    it("has updateAllViews method", () => {
      const marker = Marker.create();
      expect(marker.updateAllViews).toBeDefined();
    });
  });

  describe("manager", () => {
    it("creates manager", () => {
      const attach = vi.fn();
      const detach = vi.fn();
      const mgr = Marker.manager(attach, detach);

      expect(mgr.items).toBeDefined();
      expect(mgr.setMarkers).toBeDefined();
    });

    it("sets markers", () => {
      const attach = vi.fn();
      const detach = vi.fn();
      const mgr = Marker.manager(attach, detach);

      mgr.setMarkers([{ time: 1000 }, { time: 2000 }]);

      expect(attach).toHaveBeenCalled();
    });

    it("removes markers when setting empty", () => {
      const attach = vi.fn();
      const detach = vi.fn().mockReturnValue(true);
      const mgr = Marker.manager(attach, detach);

      mgr.setMarkers([{ time: 1000 }]);
      mgr.setMarkers([]);

      expect(detach).toHaveBeenCalled();
    });
  });
});

describe("PrimitiveWrapper lifecycle", () => {
  it("calls attached when added", () => {
    const attached = vi.fn();
    const primitive: Primitive.SeriesPrimitive = {
      id: "test",
      zOrder: "normal",
      attached,
      paneViews: () => [],
    };
    primitive.attached?.({} as Primitive.DrawContext);
    expect(attached).toHaveBeenCalled();
  });

  it("calls detached when removed", () => {
    const detached = vi.fn();
    const primitive: Primitive.SeriesPrimitive = {
      id: "test",
      zOrder: "normal",
      detached,
      paneViews: () => [],
    };
    primitive.detached?.();
    expect(detached).toHaveBeenCalled();
  });
});
