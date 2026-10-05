// Purpose: Zod schemas and defaults for Y-axis and X-axis configuration (mode, margins, styling, spacing)
// Module:  @openchart/chart-core / scale

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ConfigRegistry } from "@openchart/chart-core/config/registry";

/**
 * Y-Axis configuration (formerly "price axis" / "price scale").
 * Defines the vertical axis settings for displaying values.
 */
export namespace YAxisConfig {
  /**
   * Which side of the chart the axis appears on.
   */
  export const Side = z
    .enum(["left", "right"])
    .describe("Which side of the chart the Y-axis is rendered on.");
  export type Side = z.infer<typeof Side>;

  /**
   * Scale calculation mode.
   */
  export const Mode = z
    .enum(["normal", "logarithmic", "percentage", "indexed"])
    .describe("How Y-axis values are normalized and displayed.");
  export type Mode = z.infer<typeof Mode>;

  /**
   * Margins for data rendering within the axis bounds.
   * Values are fractional (0-1) representing percentage of axis height.
   */
  export const Margins = z
    .object({
      top: z
        .number()
        .min(0)
        .max(1)
        .default(0.1)
        .describe("Top margin as fraction (0-1) of axis height"),
      bottom: z
        .number()
        .min(0)
        .max(1)
        .default(0.1)
        .describe("Bottom margin as fraction (0-1) of axis height"),
    })
    .describe("Top and bottom margins reserved around plotted data.");
  export type Margins = z.infer<typeof Margins>;

  /**
   * Manual override for visible value extent.
   */
  export const VisibleExtent = z
    .object({
      min: z.number().describe("Minimum visible value"),
      max: z.number().describe("Maximum visible value"),
    })
    .describe("Manual Y-axis bounds override.");
  export type VisibleExtent = z.infer<typeof VisibleExtent>;

  /**
   * Explicit anchor used by relative y-axis modes. When present, percentage
   * and indexed scales use the nearest series value at or before this time
   * instead of the first visible bar.
   */
  export const ModeAnchor = z
    .object({
      time: z.number().describe("Epoch time for the comparison anchor."),
    })
    .describe("Optional explicit baseline anchor for relative scale modes.");
  export type ModeAnchor = z.infer<typeof ModeAnchor>;

  /**
   * Styling for the axis.
   */
  export const Style = z
    .object({
      textColor: z
        .string()
        .optional()
        .describe("Text color (falls back to chart.layout.textColor)"),
      borderVisible: z
        .boolean()
        .default(false)
        .describe("Show axis border line"),
      borderColor: z.string().default("#2B2B43").describe("Border line color"),
      ticksVisible: z.boolean().default(false).describe("Show tick marks"),
      tickSpacing: z
        .number()
        .positive()
        .default(50)
        .describe("Target spacing between ticks in pixels"),
    })
    .describe("Visual styling applied to the Y-axis.");
  export type Style = z.infer<typeof Style>;

  /**
   * Axis label visibility + presentation.
   */
  export const Labels = z
    .object({
      visible: z
        .boolean()
        .default(true)
        .describe("Show last value labels on this axis"),
      style: z
        .enum(["default", "muted"])
        .default("default")
        .describe("Label style preset"),
      tagColor: z
        .string()
        .optional()
        .describe("Optional color override for last value label background"),
      textColor: z
        .string()
        .optional()
        .describe("Optional color override for last value label text"),
    })
    .describe("Last-value label visibility and styling for the Y-axis.");
  export type Labels = z.infer<typeof Labels>;

  /**
   * Value line behavior for this axis.
   */
  export const ValueLine = z
    .object({
      visible: z
        .boolean()
        .default(true)
        .describe("Show value line for series using this axis"),
      mode: z
        .enum(["off", "partial", "extended"])
        .default("extended")
        .describe("Whether value lines are hidden, partial, or fully extended"),
      style: z
        .enum(["dashed", "dotted", "solid"])
        .default("dotted")
        .describe("Stroke style for value lines"),
      color: z
        .string()
        .optional()
        .describe("Optional axis-level override for value line color"),
    })
    .describe("Shared value-line behavior for series attached to the Y-axis.");
  export type ValueLine = z.infer<typeof ValueLine>;

  /**
   * Configuration for a single Y-axis.
   */
  export const Axis = z
    .object({
      id: z.string().describe("Unique axis identifier"),
      paneId: z
        .string()
        .optional()
        .describe("Pane that owns this axis. Omitted means main pane."),
      side: Side.default("right").describe(
        "Which side of chart the axis appears on",
      ),
      visible: z.boolean().default(true).describe("Show the axis"),
      fixed: z
        .boolean()
        .default(true)
        .describe(
          "Fixed axes are pinned to a chart edge; non-fixed axes are contextual/floating",
        ),
      mode: Mode.default("normal").describe("Scale calculation mode"),
      autoScale: z
        .boolean()
        .default(true)
        .describe("Automatically fit to visible data"),
      invertScale: z
        .boolean()
        .default(false)
        .describe("Invert axis direction (low values at top)"),
      lockZero: z
        .boolean()
        .default(false)
        .describe("Always include zero in the range"),
      margins: Margins.default({
        top: 0.1,
        bottom: 0.1,
      }).describe("Data rendering margins"),
      visibleExtent: VisibleExtent.optional().describe(
        "Manual visible extent override",
      ),
      modeAnchor: ModeAnchor.optional().describe(
        "Explicit anchor used by percentage/indexed relative scale modes.",
      ),
      style: Style.default({
        borderVisible: false,
        borderColor: "#2B2B43",
        ticksVisible: false,
        tickSpacing: 50,
      }).describe("Axis styling"),
      labels: Labels.default({
        visible: true,
        style: "default",
      }).describe("Last-value label visibility and styling for the Y-axis."),
      valueLine: ValueLine.default({
        visible: true,
        mode: "extended",
        style: "dotted",
      }).describe(
        "Shared value-line behavior for series attached to the Y-axis.",
      ),
    })
    .describe("Configuration for a single Y-axis instance.");
  export type Axis = z.infer<typeof Axis>;

  /**
   * Full Y-axis config schema.
   */
  export const Schema = z
    .object({
      axes: z
        .array(Axis)
        .default([
          {
            id: "right",
            side: "right",
            visible: true,
            fixed: true,
            mode: "normal",
            autoScale: true,
            invertScale: false,
            lockZero: false,
            margins: { top: 0.1, bottom: 0.1 },
            style: {
              borderVisible: false,
              borderColor: "#2B2B43",
              ticksVisible: false,
              tickSpacing: 50,
            },
            labels: {
              visible: true,
              style: "default",
            },
            valueLine: {
              visible: true,
              mode: "extended",
              style: "dotted",
            },
          },
        ])
        .describe("Y-axis configurations"),
      width: z.number().positive().default(60).describe("Axis width in pixels"),
    })
    .describe("Full Y-axis configuration document.");
  export type Schema = z.infer<typeof Schema>;

  /**
   * Config definition for registration.
   */
  export const definition = {
    key: "yAxis",
    schema: Schema,
    defaults: Schema.parse({}),
  } as const;
}

/**
 * X-Axis configuration (formerly "time scale").
 * Defines the horizontal axis settings for displaying time/index.
 */
export namespace XAxisConfig {
  /**
   * X-axis scale mode.
   * - ordinal: index-based spacing (financial default)
   * - linear: value-proportional spacing (irregular x values)
   */
  export const Mode = z
    .enum(["ordinal", "linear"])
    .describe("How X-axis values are interpreted and spaced.");
  export type Mode = z.infer<typeof Mode>;

  /**
   * Styling for the axis.
   */
  export const Style = z
    .object({
      textColor: z
        .string()
        .optional()
        .describe("Text color (falls back to chart.layout.textColor)"),
      borderVisible: z
        .boolean()
        .default(false)
        .describe("Show axis border line"),
      borderColor: z.string().default("#2B2B43").describe("Border line color"),
      ticksVisible: z.boolean().default(false).describe("Show tick marks"),
    })
    .describe("Visual styling applied to the X-axis.");
  export type Style = z.infer<typeof Style>;

  /**
   * Bar spacing configuration.
   */
  export const Spacing = z
    .object({
      barSpacing: z
        .number()
        .positive()
        .default(6)
        .describe("Spacing between data points in pixels"),
      minBarSpacing: z
        .number()
        .positive()
        .default(0.5)
        .describe("Minimum bar spacing (zoom out limit)"),
      maxBarSpacing: z
        .number()
        .positive()
        .default(50)
        .describe("Maximum bar spacing (zoom in limit)"),
      rightOffset: z
        .number()
        .default(0)
        .describe(
          "Pixel offset: positive adds future space; negative scrolls into history",
        ),
    })
    .describe("Scroll and zoom spacing state for an X-axis.");
  export type Spacing = z.infer<typeof Spacing>;

  /**
   * Optional linear-domain viewport for linear mode.
   * When absent, domain is derived from bound series data.
   */
  export const Domain = z
    .object({
      min: z.number(),
      max: z.number(),
      minSpan: z.number().positive().default(1e-6),
    })
    .describe("Explicit numeric viewport domain for a linear X-axis.");
  export type Domain = z.infer<typeof Domain>;

  /**
   * Configuration for a single X-axis.
   */
  export const Axis = z
    .object({
      id: z.string().default("main").describe("Unique X-axis identifier"),
      mode: Mode.default("ordinal").describe("X-axis mode"),
      visible: z.boolean().default(true).describe("Show this axis when active"),
      field: z
        .string()
        .default("time")
        .describe("Default data field used for X values"),
      spacing: Spacing.default({
        barSpacing: 6,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        rightOffset: 0,
      }).describe("Per-axis spacing/scroll state"),
      domain: Domain.optional().describe("Viewport domain for linear mode"),
    })
    .describe("Configuration for a single X-axis instance.");
  export type Axis = z.infer<typeof Axis>;

  /**
   * Edge behavior configuration.
   */
  export const Edges = z
    .object({
      fixLeftEdge: z
        .boolean()
        .default(false)
        .describe("Prevent scrolling past left edge of data"),
      fixRightEdge: z
        .boolean()
        .default(false)
        .describe("Prevent scrolling past right edge of data"),
    })
    .describe("Rules for clamping scroll behavior at chart edges.");
  export type Edges = z.infer<typeof Edges>;

  /**
   * Time display options.
   */
  export const TimeDisplay = z
    .object({
      timeVisible: z
        .boolean()
        .default(false)
        .describe("Show time in axis labels"),
      secondsVisible: z
        .boolean()
        .default(true)
        .describe("Show seconds when time is visible"),
    })
    .describe("Formatting options for timestamps rendered on the X-axis.");
  export type TimeDisplay = z.infer<typeof TimeDisplay>;

  /**
   * Full X-axis config schema.
   */
  export const Schema = z
    .object({
      visible: z.boolean().default(true).describe("Show the X-axis"),
      height: z
        .number()
        .positive()
        .default(30)
        .describe("Axis height in pixels"),
      activeId: z
        .string()
        .default("main")
        .describe("Active X-axis id used for rendering + interaction"),
      axes: z
        .array(Axis)
        .default([
          {
            id: "main",
            mode: "ordinal",
            visible: true,
            field: "time",
            spacing: {
              barSpacing: 6,
              minBarSpacing: 0.5,
              maxBarSpacing: 50,
              rightOffset: 0,
            },
          },
        ])
        .describe("Configured X-axes"),
      style: Style.default({
        borderVisible: false,
        borderColor: "#2B2B43",
        ticksVisible: false,
      }).describe("Visual styling applied to the X-axis."),
      /** @deprecated Use axes[].spacing instead. Kept for schema backward compatibility only. */
      spacing: Spacing.default({
        barSpacing: 6,
        minBarSpacing: 0.5,
        maxBarSpacing: 50,
        rightOffset: 0,
      }).describe("@deprecated - use axes[].spacing instead"),
      edges: Edges.default({
        fixLeftEdge: false,
        fixRightEdge: false,
      }).describe("Edge behavior configuration"),
      timeDisplay: TimeDisplay.default({
        timeVisible: false,
        secondsVisible: true,
      }).describe("Time display options"),
    })
    .describe("Full X-axis configuration document.");
  export type Schema = z.infer<typeof Schema>;

  /**
   * Config definition for registration.
   */
  export const definition = {
    key: "xAxis",
    schema: Schema,
    defaults: Schema.parse({}),
  } as const;
}

// Self-register with ConfigRegistry
ConfigRegistry.register(YAxisConfig.definition);
ConfigRegistry.register(XAxisConfig.definition);
