// Purpose: Data-point marker primitive (circle, square, arrow) positioned relative to bars, with a manager for dynamic add/remove.
// Module:  @openchart/chart-core / primitive

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Primitive } from "./def";
import { CoordSys } from "@openchart/chart-core/coord";
import { UUID } from "@openchart/chart-core/util";

export namespace Marker {
  export const Shape = z.enum(["circle", "square", "arrowUp", "arrowDown"]);
  export type Shape = z.infer<typeof Shape>;

  export const Position = z.enum(["aboveBar", "belowBar", "inBar"]);
  export type Position = z.infer<typeof Position>;

  export const Item = z.object({
    time: z.union([
      z.number(),
      z.string(),
      z.object({
        year: z.number(),
        month: z.number(),
        day: z.number(),
      }),
    ]),
    position: Position.default("aboveBar"),
    shape: Shape.default("circle"),
    color: z.string().default("#2196F3"),
    size: z.number().default(1),
    text: z.string().optional(),
    id: z.string().optional(),
  });
  export type Item = z.infer<typeof Item>;
  export type ItemInput = z.input<typeof Item>;

  type Rendered = {
    item: Item;
    x: number;
    y: number;
    dataIndex: number;
  };

  export function create(
    rawItems: ItemInput[] = [],
  ): Primitive.SeriesPrimitive {
    const items = rawItems.map((i) => Item.parse(i));
    let markers: Rendered[] = [];
    const id = `markers-${UUID.random()}`;

    return {
      id,
      zOrder: "top",

      updateAllViews(context, data) {
        markers = [];

        if (!data.data.length) return;

        const scale =
          context.coord.scales.y.right ??
          Object.values(context.coord.scales.y)[0];
        if (!scale) return;

        for (const item of items) {
          const idx = findIndex(data.data, item.time);
          if (idx < 0) continue;

          const x = context.xPositions[idx];
          if (x === undefined) continue;

          const dataPoint = data.data[idx] as {
            value?: number;
            high?: number;
            low?: number;
            close?: number;
          };
          const baseY = getBaseY(dataPoint, item.position, scale);
          const offset = getOffset(item.position, item.size);

          markers.push({
            item,
            x,
            y: baseY + offset,
            dataIndex: idx,
          });
        }
      },

      paneViews() {
        if (markers.length === 0) return [];

        return [
          Primitive.view("top", {
            draw(ctx) {
              for (const m of markers) {
                drawMarker(ctx, m);
              }
            },
          }),
        ];
      },

      hitTest(x, y, context) {
        void x;
        void y;
        void context;
        // Could implement hit detection on markers
        return null;
      },
    };
  }

  function findIndex(data: unknown[], time: unknown): number {
    const timeStr = JSON.stringify(time);

    for (let i = 0; i < data.length; i++) {
      const d = data[i] as { time?: unknown };
      if (d && JSON.stringify(d.time) === timeStr) return i;
    }

    return -1;
  }

  function getBaseY(
    point: { value?: number; high?: number; low?: number; close?: number },
    position: Position,
    scale: CoordSys.Scale,
  ): number {
    const value =
      position === "belowBar"
        ? (point.low ?? point.value ?? 0)
        : position === "aboveBar"
          ? (point.high ?? point.value ?? 0)
          : (point.close ?? point.value ?? 0);

    return CoordSys.toPixel(value, scale);
  }

  function getOffset(position: Position, size: number): number {
    const base = 12 * size;
    if (position === "aboveBar") return -base;
    if (position === "belowBar") return base;
    return 0;
  }

  function drawMarker(ctx: CanvasRenderingContext2D, m: Rendered): void {
    const { item, x, y } = m;
    const size = 8 * item.size;

    ctx.save();
    ctx.fillStyle = item.color;
    ctx.strokeStyle = item.color;

    switch (item.shape) {
      case "circle":
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        break;

      case "square":
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        break;

      case "arrowUp":
        ctx.beginPath();
        ctx.moveTo(x, y - size / 2);
        ctx.lineTo(x + size / 2, y + size / 2);
        ctx.lineTo(x - size / 2, y + size / 2);
        ctx.closePath();
        ctx.fill();
        break;

      case "arrowDown":
        ctx.beginPath();
        ctx.moveTo(x, y + size / 2);
        ctx.lineTo(x + size / 2, y - size / 2);
        ctx.lineTo(x - size / 2, y - size / 2);
        ctx.closePath();
        ctx.fill();
        break;
    }

    if (item.text) {
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = item.position === "aboveBar" ? "bottom" : "top";
      ctx.fillText(
        item.text,
        x,
        y + (item.position === "aboveBar" ? -size / 2 - 2 : size / 2 + 2),
      );
    }

    ctx.restore();
  }

  export type Manager = {
    items: Item[];
    primitive: Primitive.SeriesPrimitive | null;
    setMarkers(items: ItemInput[]): void;
  };

  export function manager(
    attach: (p: Primitive.SeriesPrimitive) => void,
    detach: (id: string) => boolean,
  ): Manager {
    let items: Item[] = [];
    let primitive: Primitive.SeriesPrimitive | null = null;

    return {
      items,
      primitive,

      setMarkers(newItems) {
        // Remove old primitive
        if (primitive) {
          detach(primitive.id);
        }

        items = newItems.map((i) => Item.parse(i));
        if (items.length === 0) {
          primitive = null;
          return;
        }

        primitive = create(items);
        attach(primitive);
      },
    };
  }
}
