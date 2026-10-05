// Purpose: Zod-validated action types (drag, wheel, pinch, reset) with region and modifier metadata
// Module:  @openchart/chart-core / interaction

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

export namespace Action {
  export const Region = z.discriminatedUnion("type", [
    z.object({ type: z.literal("canvas") }),
    z.object({ type: z.literal("xscale") }),
    z.object({ type: z.literal("yscale"), scale: z.string() }),
    z.object({
      type: z.literal("series"),
      series: z.string(),
      scale: z.string(),
    }),
  ]);
  export type Region = z.infer<typeof Region>;

  export const Modifiers = z.object({
    shift: z.boolean(),
    ctrl: z.boolean(),
    meta: z.boolean(),
    alt: z.boolean(),
  });
  export type Modifiers = z.infer<typeof Modifiers>;

  export const Point = z.object({ x: z.number(), y: z.number() });
  export type Point = z.infer<typeof Point>;

  export const DragMove = z.object({
    type: z.literal("drag"),
    region: Region,
    mods: Modifiers,
    point: Point,
    start: Point,
    delta: Point,
  });
  export type DragMove = z.infer<typeof DragMove>;

  export const Wheel = z.object({
    type: z.literal("wheel"),
    region: Region,
    mods: Modifiers,
    point: Point,
    delta: Point,
  });
  export type Wheel = z.infer<typeof Wheel>;

  export const Pinch = z.object({
    type: z.literal("pinch"),
    region: Region,
    center: Point,
    scale: z.number(),
  });
  export type Pinch = z.infer<typeof Pinch>;

  export const Reset = z.object({
    type: z.literal("reset"),
    region: Region,
  });
  export type Reset = z.infer<typeof Reset>;

  export const Any = z.discriminatedUnion("type", [
    DragMove,
    Wheel,
    Pinch,
    Reset,
  ]);
  export type Any = z.infer<typeof Any>;

  export function drag(
    region: Region,
    point: Point,
    start: Point,
    mods: Modifiers,
  ): DragMove {
    return {
      type: "drag",
      region,
      point,
      start,
      delta: { x: point.x - start.x, y: point.y - start.y },
      mods,
    };
  }

  export function wheel(
    region: Region,
    point: Point,
    delta: Point,
    mods: Modifiers,
  ): Wheel {
    return { type: "wheel", region, point, delta, mods };
  }

  export function pinch(region: Region, center: Point, scale: number): Pinch {
    return { type: "pinch", region, center, scale };
  }

  export function reset(region: Region): Reset {
    return { type: "reset", region };
  }

  export function mods(e: {
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }): Modifiers {
    return {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      alt: e.altKey,
    };
  }

  export const noMods: Modifiers = {
    shift: false,
    ctrl: false,
    meta: false,
    alt: false,
  };
}
