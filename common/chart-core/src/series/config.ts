// Purpose: Zod schemas for series-level config defaults (last-value tag, value line, crosshair marker)
// Module:  @openchart/chart-core / series

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ConfigRegistry } from "@openchart/chart-core/config/registry";

/**
 * Series-level configuration defaults.
 * Controls default settings for series features like last value display and value lines.
 */
export namespace SeriesConfig {
  /**
   * Line style options.
   */
  export const LineStyle = z
    .enum(["solid", "dashed", "dotted"])
    .describe("Supported line stroke styles for series decorations.");
  export type LineStyle = z.infer<typeof LineStyle>;

  /**
   * Last value tag configuration.
   * The tag shows the last visible value on the Y-axis.
   */
  export const LastValueTag = z
    .object({
      visible: z
        .boolean()
        .default(true)
        .describe("Show last value tag on Y-axis"),
      color: z
        .string()
        .optional()
        .describe("Tag background color (defaults to series color)"),
      textColor: z
        .string()
        .optional()
        .describe("Tag text color (auto-contrasts with background)"),
    })
    .describe(
      "Display settings for the last-value tag rendered on the Y-axis.",
    );
  export type LastValueTag = z.infer<typeof LastValueTag>;

  /**
   * Value line configuration.
   * The horizontal line connecting the last value to the Y-axis.
   *
   * Adjacency Logic:
   * When `showWhenAdjacent` is false (default), the line is only drawn when
   * there's a gap between the last visible data point and the plot area border.
   * If the last visible X touches the right edge of the plot area, no line is needed.
   */
  export const ValueLine = z
    .object({
      visible: z
        .boolean()
        .default(true)
        .describe("Enable the horizontal value line"),
      showWhenAdjacent: z
        .boolean()
        .default(true)
        .describe(
          "If true, always show line. If false, only show when last visible X doesn't touch the plot border",
        ),
      color: z
        .string()
        .optional()
        .describe("Line color (defaults to series color)"),
      style: LineStyle.default("dotted").describe("Line style"),
      width: z.number().positive().default(1).describe("Line width in pixels"),
    })
    .describe(
      "Display settings for the horizontal line projecting the last value.",
    );
  export type ValueLine = z.infer<typeof ValueLine>;

  /**
   * Crosshair marker configuration.
   * The marker shown at the crosshair intersection with series data.
   */
  export const CrosshairMarker = z
    .object({
      visible: z
        .boolean()
        .default(true)
        .describe("Show marker at crosshair position"),
      radius: z
        .number()
        .positive()
        .default(4)
        .describe("Marker radius in pixels"),
      borderWidth: z.number().default(1).describe("Marker border width"),
      borderColor: z
        .string()
        .optional()
        .describe("Marker border color (defaults to series color)"),
      backgroundColor: z
        .string()
        .optional()
        .describe("Marker fill color (defaults to white)"),
    })
    .describe("Display settings for the marker shown under the crosshair.");
  export type CrosshairMarker = z.infer<typeof CrosshairMarker>;

  /**
   * Value format configuration.
   */
  export const ValueFormat = z
    .object({
      type: z
        .enum(["value", "volume", "percent", "custom"])
        .default("value")
        .describe("Format type for displaying values"),
      precision: z.number().default(2).describe("Number of decimal places"),
      minMove: z.number().default(0.01).describe("Minimum value increment"),
    })
    .describe("Formatting rules for values rendered by a series.");
  export type ValueFormat = z.infer<typeof ValueFormat>;

  /**
   * Default settings applied to all new series.
   */
  export const Defaults = z
    .object({
      lastValueTag: LastValueTag.default({
        visible: true,
      }).describe("Default last value tag settings"),
      valueLine: ValueLine.default({
        visible: true,
        showWhenAdjacent: true,
        style: "dotted",
        width: 1,
      }).describe("Default value line settings"),
      crosshairMarker: CrosshairMarker.default({
        visible: true,
        radius: 4,
        borderWidth: 1,
      }).describe("Default crosshair marker settings"),
      valueFormat: ValueFormat.default({
        type: "value",
        precision: 2,
        minMove: 0.01,
      }).describe("Default value format settings"),
    })
    .describe("Defaults applied to newly created series.");
  export type Defaults = z.infer<typeof Defaults>;

  /**
   * Full series config schema.
   */
  export const Schema = z
    .object({
      defaults: Defaults.default({
        lastValueTag: { visible: true },
        valueLine: {
          visible: true,
          showWhenAdjacent: true,
          style: "dotted",
          width: 1,
        },
        crosshairMarker: { visible: true, radius: 4, borderWidth: 1 },
        valueFormat: { type: "value", precision: 2, minMove: 0.01 },
      }).describe("Default settings for new series"),
    })
    .describe("Series configuration document.");
  export type Schema = z.infer<typeof Schema>;

  /**
   * Config definition for registration.
   */
  export const definition = {
    key: "series",
    schema: Schema,
    defaults: Schema.parse({}),
  } as const;
}

// Self-register with ConfigRegistry
ConfigRegistry.register(SeriesConfig.definition);
