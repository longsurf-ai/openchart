// Purpose: Horizontal price-line primitive drawn at a fixed price level, with hit-testing and a manager for CRUD operations.
// Module:  @openchart/chart-core / primitive

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Primitive } from "./def";
import { CoordSys } from "@openchart/chart-core/coord";
import { UUID } from "@openchart/chart-core/util";

export namespace PriceLine {
  export const Options = z.object({
    price: z.number(),
    color: z.string().default("#758696"),
    lineWidth: z.number().default(1),
    lineStyle: z.enum(["solid", "dashed", "dotted"]).default("solid"),
    title: z.string().default(""),
    axisLabelVisible: z.boolean().default(true),
    axisLabelColor: z.string().optional(),
    axisLabelTextColor: z.string().default("#ffffff"),
  });
  export type Options = z.infer<typeof Options>;

  type State = {
    options: Options;
    y: number | null;
    width: number;
  };

  export function create(
    options: Partial<Options> & { price: number },
  ): Primitive.SeriesPrimitive {
    const opts = Options.parse(options);
    const state: State = {
      options: opts,
      y: null,
      width: 0,
    };

    const id = `price-line-${UUID.random()}`;

    return {
      id,
      zOrder: "normal",

      updateAllViews(context) {
        const scale =
          context.coord.scales.y.right ??
          Object.values(context.coord.scales.y)[0];
        if (!scale) {
          state.y = null;
          return;
        }

        state.y = CoordSys.toPixel(state.options.price, scale);
        state.width = context.width;
      },

      paneViews() {
        if (state.y === null) return [];

        return [
          Primitive.view("normal", {
            draw(ctx) {
              drawLine(ctx, state);
            },
          }),
        ];
      },

      hitTest(x, y, context) {
        void x;
        void context;
        if (state.y === null) return null;

        const threshold = 5;
        if (Math.abs(y - state.y) > threshold) return null;

        return {
          type: "primitive",
          id,
          distance: Math.abs(y - state.y),
          zOrder: 0,
          data: { price: state.options.price },
        };
      },
    };
  }

  function drawLine(ctx: CanvasRenderingContext2D, state: State): void {
    if (state.y === null) return;

    const y = Math.round(state.y) + 0.5;
    const opts = state.options;

    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = opts.lineWidth;

    if (opts.lineStyle === "dashed") {
      ctx.setLineDash([6, 4]);
    } else if (opts.lineStyle === "dotted") {
      ctx.setLineDash([2, 2]);
    }

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.width, y);
    ctx.stroke();

    ctx.setLineDash([]);

    if (opts.title) {
      ctx.font = "12px sans-serif";
      ctx.fillStyle = opts.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.title, 4, y - 4);
    }

    ctx.restore();
  }

  export type Manager = {
    lines: Map<
      string,
      { primitive: Primitive.SeriesPrimitive; options: Options }
    >;
    add(options: Partial<Options> & { price: number }): string;
    remove(id: string): boolean;
    update(id: string, options: Partial<Options>): boolean;
    all(): Array<{ id: string; options: Options }>;
  };

  export function manager(
    attach: (p: Primitive.SeriesPrimitive) => void,
    detach: (id: string) => boolean,
  ): Manager {
    const lines = new Map<
      string,
      { primitive: Primitive.SeriesPrimitive; options: Options }
    >();

    return {
      lines,

      add(options) {
        const primitive = create(options);
        const opts = Options.parse(options);
        lines.set(primitive.id, { primitive, options: opts });
        attach(primitive);
        return primitive.id;
      },

      remove(id) {
        const entry = lines.get(id);
        if (!entry) return false;
        lines.delete(id);
        return detach(id);
      },

      update(id, options) {
        const entry = lines.get(id);
        if (!entry) return false;
        Object.assign(entry.options, options);
        return true;
      },

      all() {
        return Array.from(lines.entries()).map(([id, entry]) => ({
          id,
          options: entry.options,
        }));
      },
    };
  }
}
