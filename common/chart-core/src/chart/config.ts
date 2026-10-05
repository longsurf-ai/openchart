// Purpose: Zod schemas and defaults for chart-level configuration (dimensions, layout, grid)
// Module:  @openchart/chart-core / chart

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ConfigRegistry } from "@openchart/chart-core/config/registry";
import { Constants } from "@openchart/chart-core/util";

/**
 * Chart-level configuration.
 * Covers dimensions, layout styling, and grid settings.
 */
export namespace ChartConfig {
  /**
   * Chart dimensions.
   */
  export const Dimensions = z
    .object({
      width: z
        .number()
        .positive()
        .default(800)
        .describe("Chart width in pixels"),
      height: z
        .number()
        .positive()
        .default(400)
        .describe("Chart height in pixels"),
      autoResize: z
        .boolean()
        .default(false)
        .describe("Automatically resize to fit container"),
    })
    .describe("Chart canvas dimensions and autoresize behavior.");
  export type Dimensions = z.infer<typeof Dimensions>;

  /**
   * Layout styling - background, text, and typography.
   */
  export const Layout = z
    .object({
      background: z
        .string()
        .default("var(--chart-bg)")
        .describe("Chart background color"),
      textColor: z
        .string()
        .default("var(--chart-text)")
        .describe("Default text color for labels and axes"),
      fontSize: z
        .number()
        .positive()
        .default(12)
        .describe("Base font size in pixels"),
      fontFamily: z
        .string()
        .default(Constants.DEFAULT_FONT_FAMILY)
        .describe("Font family for all text rendering"),
    })
    .describe("Chart-wide typography and color styling.");
  export type Layout = z.infer<typeof Layout>;

  /**
   * Grid line settings.
   */
  export const Grid = z
    .object({
      visible: z.boolean().default(true).describe("Show grid lines"),
      color: z
        .string()
        .default("var(--chart-grid)")
        .describe("Grid line color"),
      horzLines: z
        .boolean()
        .default(true)
        .describe("Show horizontal grid lines"),
      vertLines: z.boolean().default(true).describe("Show vertical grid lines"),
    })
    .describe("Grid line visibility and styling.");
  export type Grid = z.infer<typeof Grid>;

  /**
   * Full chart config schema.
   */
  export const Schema = z
    .object({
      dimensions: Dimensions.default({
        width: 800,
        height: 400,
        autoResize: false,
      }).describe("Chart canvas dimensions and autoresize behavior."),
      layout: Layout.default({
        background: "var(--chart-bg)",
        textColor: "var(--chart-text)",
        fontSize: 12,
        fontFamily: Constants.DEFAULT_FONT_FAMILY,
      }).describe("Chart-wide typography and color styling."),
      grid: Grid.default({
        visible: true,
        color: "var(--chart-grid)",
        horzLines: true,
        vertLines: true,
      }).describe("Grid line visibility and styling."),
    })
    .describe(
      "Chart-level configuration for layout, dimensions, and grid settings.",
    );
  export type Schema = z.infer<typeof Schema>;

  /**
   * Config definition for registration.
   */
  export const definition = {
    key: "chart",
    schema: Schema,
    defaults: Schema.parse({}),
  } as const;
}

// Self-register with ConfigRegistry
ConfigRegistry.register(ChartConfig.definition);
