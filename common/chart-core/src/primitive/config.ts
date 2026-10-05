// Purpose: Zod-based default configuration for markers, tags, and lines, self-registered with ConfigRegistry.
// Module:  @openchart/chart-core / primitive

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ConfigRegistry } from "@openchart/chart-core/config/registry";

/**
 * Primitive configuration.
 * Default settings for primitive types like markers, tags, and lines.
 */
export namespace PrimitiveConfig {
  /**
   * Line style options.
   */
  export const LineStyle = z
    .enum(["solid", "dashed", "dotted"])
    .describe("Supported stroke styles for primitive line elements.");
  export type LineStyle = z.infer<typeof LineStyle>;

  /**
   * Default marker settings.
   */
  export const MarkerDefaults = z
    .object({
      radius: z
        .number()
        .positive()
        .default(4)
        .describe("Default marker radius in pixels"),
      borderWidth: z
        .number()
        .default(1)
        .describe("Default marker border width"),
      borderColor: z
        .string()
        .default("#000000")
        .describe("Default marker border color"),
    })
    .describe("Default visual styling for primitive markers.");
  export type MarkerDefaults = z.infer<typeof MarkerDefaults>;

  /**
   * Default tag settings.
   */
  export const TagDefaults = z
    .object({
      padding: z.number().default(4).describe("Default tag padding in pixels"),
      borderRadius: z.number().default(2).describe("Default tag border radius"),
      font: z.string().default("12px sans-serif").describe("Default tag font"),
    })
    .describe("Default visual styling for primitive tags.");
  export type TagDefaults = z.infer<typeof TagDefaults>;

  /**
   * Default line settings.
   */
  export const LineDefaults = z
    .object({
      width: z
        .number()
        .positive()
        .default(1)
        .describe("Default line width in pixels"),
      style: LineStyle.default("solid").describe("Default line style"),
      color: z.string().default("#758696").describe("Default line color"),
    })
    .describe("Default visual styling for primitive lines.");
  export type LineDefaults = z.infer<typeof LineDefaults>;

  /**
   * Full primitive config schema.
   */
  export const Schema = z
    .object({
      marker: MarkerDefaults.default({
        radius: 4,
        borderWidth: 1,
        borderColor: "#000000",
      }).describe("Default marker settings"),
      tag: TagDefaults.default({
        padding: 4,
        borderRadius: 2,
        font: "12px sans-serif",
      }).describe("Default tag settings"),
      line: LineDefaults.default({
        width: 1,
        style: "solid",
        color: "#758696",
      }).describe("Default line settings"),
    })
    .describe("Primitive rendering defaults used by the chart.");
  export type Schema = z.infer<typeof Schema>;

  /**
   * Config definition for registration.
   */
  export const definition = {
    key: "primitive",
    schema: Schema,
    defaults: Schema.parse({}),
  } as const;
}

// Self-register with ConfigRegistry
ConfigRegistry.register(PrimitiveConfig.definition);
