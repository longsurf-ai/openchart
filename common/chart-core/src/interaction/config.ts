// Purpose: Zod schema and defaults for interaction settings (toggles, region mappings, crosshair)
// Module:  @openchart/chart-core / interaction

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ConfigRegistry } from "@openchart/chart-core/config/registry";

/**
 * Interaction configuration.
 * Controls user interactions like scrolling, zooming, panning, and crosshair behavior.
 */
export namespace InteractionConfig {
  /**
   * Interaction effect modes for drag/wheel actions.
   */
  export const EffectMode = z
    .enum(["translateX", "translateXY", "translateY", "zoomX", "zoomY"])
    .describe("Interaction effect applied by a gesture.");
  export type EffectMode = z.infer<typeof EffectMode>;

  /**
   * Modifier key mappings for a region.
   */
  export const ModifierMapping = z
    .object({
      normal: EffectMode.describe("Action with no modifier key"),
      shift: EffectMode.describe("Action with shift key held"),
    })
    .describe("Gesture mapping for default and shift-modified input.");
  export type ModifierMapping = z.infer<typeof ModifierMapping>;

  /**
   * Region-specific interaction mappings.
   * Defines what happens when user interacts with different chart regions.
   */
  export const RegionMapping = z
    .object({
      canvas: ModifierMapping.default({
        normal: "translateX",
        shift: "translateXY",
      }).describe("Interaction mode for main chart area"),
      yAxis: ModifierMapping.default({
        normal: "zoomY",
        shift: "translateY",
      }).describe("Interaction mode for Y-axis area"),
      xAxis: ModifierMapping.default({
        normal: "translateX",
        shift: "zoomX",
      }).describe("Interaction mode for X-axis area"),
    })
    .describe("Per-region gesture mappings for chart interaction.");
  export type RegionMapping = z.infer<typeof RegionMapping>;

  /**
   * Individual interaction toggles.
   * Allows fine-grained control over which interactions are enabled.
   */
  export const Toggles = z
    .object({
      scroll: z
        .boolean()
        .default(true)
        .describe("Enable horizontal scrolling/panning"),
      zoom: z.boolean().default(true).describe("Enable zoom via mouse wheel"),
      pan: z.boolean().default(true).describe("Enable pan via mouse drag"),
      pinch: z.boolean().default(true).describe("Enable pinch-to-zoom gesture"),
      wheel: z
        .boolean()
        .default(true)
        .describe("Enable mouse wheel interactions"),
      drag: z
        .boolean()
        .default(true)
        .describe("Enable drag interactions on axes"),
    })
    .describe("Feature toggles for interaction behaviors.");
  export type Toggles = z.infer<typeof Toggles>;

  /**
   * Crosshair mode.
   */
  export const CrosshairMode = z
    .enum(["normal", "magnet", "hidden"])
    .describe("Crosshair tracking mode.");
  export type CrosshairMode = z.infer<typeof CrosshairMode>;

  /**
   * Crosshair configuration.
   */
  export const Crosshair = z
    .object({
      mode: CrosshairMode.default("normal").describe(
        "Crosshair behavior: 'normal' follows cursor exactly, 'magnet' snaps to data points, 'hidden' disables display",
      ),
      color: z.string().default("#758696").describe("Crosshair line color"),
      lineWidth: z
        .number()
        .positive()
        .default(1)
        .describe("Crosshair line width"),
      horzLine: z
        .boolean()
        .default(true)
        .describe("Show horizontal crosshair line"),
      vertLine: z
        .boolean()
        .default(true)
        .describe("Show vertical crosshair line"),
      xLabel: z.boolean().default(true).describe("Show value label on X-axis"),
      yLabel: z.boolean().default(true).describe("Show value label on Y-axis"),
    })
    .describe("Crosshair visibility and presentation settings.");
  export type Crosshair = z.infer<typeof Crosshair>;

  /**
   * Full interaction config schema.
   */
  export const Schema = z
    .object({
      enabled: z
        .boolean()
        .default(true)
        .describe("Master toggle for all interactions"),
      toggles: Toggles.default({
        scroll: true,
        zoom: true,
        pan: true,
        pinch: true,
        wheel: true,
        drag: true,
      }).describe("Individual interaction toggles"),
      mapping: RegionMapping.default({
        canvas: { normal: "translateX", shift: "translateXY" },
        yAxis: { normal: "zoomY", shift: "translateY" },
        xAxis: { normal: "translateX", shift: "zoomX" },
      }).describe("Modifier key mappings per region"),
      crosshair: Crosshair.default({
        mode: "normal",
        color: "#758696",
        lineWidth: 1,
        horzLine: true,
        vertLine: true,
        xLabel: true,
        yLabel: true,
      }).describe("Crosshair configuration"),
    })
    .describe("Chart interaction configuration document.");
  export type Schema = z.infer<typeof Schema>;

  /**
   * Config definition for registration.
   */
  export const definition = {
    key: "interaction",
    schema: Schema,
    defaults: Schema.parse({}),
  } as const;
}

// Self-register with ConfigRegistry
ConfigRegistry.register(InteractionConfig.definition);
