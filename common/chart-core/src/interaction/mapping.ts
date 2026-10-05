// Purpose: Maps raw actions + region + modifiers into typed Command objects (translateX, zoomY, etc.)
// Module:  @openchart/chart-core / interaction

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { Action } from "./action";

export namespace Mapping {
  export const Command = z.discriminatedUnion("effect", [
    z.object({ effect: z.literal("translateX"), dx: z.number() }),
    z.object({ effect: z.literal("zoomX"), dy: z.number(), x: z.number() }),
    z.object({
      effect: z.literal("translateY"),
      scale: z.string().optional(),
      dy: z.number(),
    }),
    z.object({
      effect: z.literal("zoomY"),
      scale: z.string(),
      factor: z.number(),
    }),
    z.object({ effect: z.literal("resetX") }),
    z.object({ effect: z.literal("resetY"), scale: z.string() }),
    z.object({ effect: z.literal("none") }),
  ]);
  export type Command = z.infer<typeof Command>;

  const Mode = z.enum([
    "translateX",
    "translateXY",
    "translateY",
    "zoomX",
    "zoomY",
  ]);
  type Mode = z.infer<typeof Mode>;

  const Modifier = z.enum(["normal", "shift"]);
  type Modifier = z.infer<typeof Modifier>;

  const Modifiers = z.object({
    normal: Mode,
    shift: Mode,
  });

  export const Config = z.object({
    canvas: Modifiers.default({ normal: "translateX", shift: "translateXY" }),
    yscale: Modifiers.default({ normal: "zoomY", shift: "translateY" }),
    xscale: Modifiers.default({ normal: "translateX", shift: "zoomX" }),
  });
  export type Config = z.infer<typeof Config>;

  export const defaults = Config.parse({});

  export type Context = {
    config: Config;
    height?: number;
    locked?: boolean;
    start?: { y: number; extent: { min: number; max: number } };
  };

  export function map(action: Action.Any, ctx: Context): Command[] {
    switch (action.type) {
      case "drag":
        return mapDrag(action, ctx);
      case "wheel":
        return mapWheel(action, ctx);
      case "reset":
        return mapReset(action);
      case "pinch":
        return [
          {
            effect: "zoomX",
            dy: action.scale > 1 ? -1 : 1,
            x: action.center.x,
          },
        ];
      default:
        return [{ effect: "none" }];
    }
  }

  function modifier(mods: { shift?: boolean }): Modifier {
    return mods.shift ? "shift" : "normal";
  }

  function mapDrag(action: Action.DragMove, ctx: Context): Command[] {
    const region = action.region;
    const mod = modifier(action.mods);

    switch (region.type) {
      case "series":
        return [
          { effect: "translateY", scale: region.scale, dy: action.delta.y },
        ];
      case "canvas":
      case "yscale":
      case "xscale":
        return applyMode(ctx.config[region.type][mod], action, ctx);
      default:
        return [{ effect: "none" }];
    }
  }

  function applyMode(
    mode: Mode,
    action: Action.DragMove,
    ctx: Context,
  ): Command[] {
    switch (mode) {
      case "translateX":
        return [{ effect: "translateX", dx: action.delta.x }];
      case "translateXY":
        return [
          { effect: "translateX", dx: action.delta.x },
          { effect: "translateY", dy: action.delta.y },
        ];
      case "zoomX":
        return [{ effect: "zoomX", dy: action.delta.y, x: action.point.x }];
      case "translateY":
        if (action.region.type !== "yscale") return [{ effect: "none" }];
        return [
          {
            effect: "translateY",
            scale: action.region.scale,
            dy: action.delta.y,
          },
        ];
      case "zoomY": {
        if (action.region.type !== "yscale") return [{ effect: "none" }];
        if (!ctx.start || !ctx.height || ctx.height < 10)
          return [{ effect: "none" }];
        // Locked scales (histograms): drag down = zoom out (bars shorter)
        // Non-locked scales (price): drag down = zoom in (prices compressed)
        const dy = action.point.y - ctx.start.y;
        const raw = ctx.locked ? 1 + dy / ctx.height : 1 - dy / ctx.height;
        const factor = Math.max(0.1, Math.min(10, raw));
        return [{ effect: "zoomY", scale: action.region.scale, factor }];
      }
    }
  }

  function mapWheel(action: Action.Wheel, ctx: Context): Command[] {
    void ctx;
    switch (action.region.type) {
      case "canvas":
        if (action.mods.ctrl || action.mods.meta)
          return [{ effect: "zoomX", dy: action.delta.y, x: action.point.x }];
        if (action.mods.shift)
          return [{ effect: "translateX", dx: action.delta.y }];
        if (Math.abs(action.delta.y) > Math.abs(action.delta.x))
          return [{ effect: "zoomX", dy: action.delta.y, x: action.point.x }];
        return [{ effect: "translateX", dx: action.delta.x }];
      case "yscale": {
        const factor = action.delta.y > 0 ? 1.1 : 0.9;
        return [{ effect: "zoomY", scale: action.region.scale, factor }];
      }
      case "xscale":
        return [{ effect: "zoomX", dy: action.delta.y, x: action.point.x }];
      default:
        return [{ effect: "none" }];
    }
  }

  function mapReset(action: Action.Reset): Command[] {
    switch (action.region.type) {
      case "canvas":
        return [{ effect: "resetX" }];
      case "yscale":
        return [{ effect: "resetY", scale: action.region.scale }];
      case "xscale":
        return [{ effect: "resetX" }];
      default:
        return [{ effect: "none" }];
    }
  }
}
