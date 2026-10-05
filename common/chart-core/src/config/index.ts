// Purpose: Unified ChartConfig namespace — triggers side-effect registrations, provides create/update/set/get/diff helpers, and re-exports types
// Module:  @openchart/chart-core / config

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ConfigRegistry } from "./registry";
import { ConfigTypes } from "./types";

// Side-effect imports to trigger self-registration
import "@openchart/chart-core/chart/config";
import "@openchart/chart-core/scale/config";
import "@openchart/chart-core/interaction/config";
import "@openchart/chart-core/series/config";
import "@openchart/chart-core/animation/config";
import "@openchart/chart-core/primitive/config";

// Type imports for explicit Full type definition
import type { ChartConfig as ChartConfigDef } from "@openchart/chart-core/chart/config";
import type {
  YAxisConfig,
  XAxisConfig,
} from "@openchart/chart-core/scale/config";
import type { InteractionConfig } from "@openchart/chart-core/interaction/config";
import type { SeriesConfig } from "@openchart/chart-core/series/config";
import type { AnimationConfig } from "@openchart/chart-core/animation/config";
import type { PrimitiveConfig } from "@openchart/chart-core/primitive/config";

/**
 * ChartConfig - Unified configuration interface for OpenChart.
 *
 * All component configs are composed into a single interface.
 * Components register their schemas via ConfigRegistry, and this
 * namespace provides the unified access point.
 */
export namespace ChartConfig {
  /**
   * Full composed config type.
   * Explicitly defined from component types for proper IntelliSense support.
   */
  export type Full = {
    chart: ChartConfigDef.Schema;
    yAxis: YAxisConfig.Schema;
    xAxis: XAxisConfig.Schema;
    interaction: InteractionConfig.Schema;
    series: SeriesConfig.Schema;
    animation: AnimationConfig.Schema;
    primitive: PrimitiveConfig.Schema;
  };

  /**
   * Create a new config with defaults, optionally merged with partial input.
   */
  export function create(partial: ConfigTypes.DeepPartial<Full> = {}): Full {
    const merged = { ...ConfigRegistry.defaults(), ...partial };
    const result = ConfigRegistry.safeParse(merged);
    if (!result.success) {
      throw new Error(`Invalid config: ${result.error.message}`);
    }
    return result.data as Full;
  }

  /**
   * Immutable update of a specific config section.
   *
   * @param config - Current config
   * @param key - Top-level key to update
   * @param updater - Function that receives current value and returns new value
   * @returns New config with updated section
   */
  export function update<K extends keyof Full>(
    config: Full,
    key: K,
    updater: ConfigTypes.Update<Full[K]>,
  ): Full {
    return { ...config, [key]: updater(config[key]) };
  }

  /**
   * Deep set a value at a dot-separated path.
   *
   * @param config - Current config
   * @param path - Dot-separated path (e.g., "interaction.crosshair.mode")
   * @param value - New value to set
   * @returns New config with value set
   */
  export function set<T>(config: Full, path: string, value: T): Full {
    const parts = path.split(".");
    const result = structuredClone(config) as Record<string, unknown>;
    let current: Record<string, unknown> = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]!;
      if (typeof current[key] !== "object" || current[key] === null) {
        current[key] = {};
      }
      current[key] = { ...(current[key] as Record<string, unknown>) };
      current = current[key] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]!] = value;
    return result as Full;
  }

  /**
   * Get a value at a dot-separated path.
   *
   * @param config - Config to read from
   * @param path - Dot-separated path (e.g., "interaction.crosshair.mode")
   * @returns Value at path, or undefined if not found
   */
  export function get<T>(config: Full, path: string): T | undefined {
    const parts = path.split(".");
    let current: unknown = config;

    for (const part of parts) {
      if (typeof current !== "object" || current === null) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current as T;
  }

  /**
   * Validate a config object against the composed schema.
   *
   * @throws ZodError if validation fails
   */
  export function validate(config: unknown): Full {
    return ConfigRegistry.parse(config) as Full;
  }

  /**
   * Safe validate - returns result object instead of throwing.
   */
  export function safeValidate(
    config: unknown,
  ): { success: true; data: Full } | { success: false; error: z.ZodError } {
    const result = ConfigRegistry.safeParse(config);
    if (result.success) return { success: true, data: result.data as Full };
    return { success: false, error: result.error };
  }

  /**
   * Compute the difference between two configs.
   * Returns array of changed paths with old and new values.
   */
  export function diff(
    oldConfig: Full,
    newConfig: Full,
  ): Array<{ path: string; oldValue: unknown; newValue: unknown }> {
    const changes: Array<{
      path: string;
      oldValue: unknown;
      newValue: unknown;
    }> = [];

    function compare(a: unknown, b: unknown, path: string): void {
      if (a === b) return;

      if (
        typeof a !== "object" ||
        typeof b !== "object" ||
        a === null ||
        b === null
      ) {
        changes.push({ path, oldValue: a, newValue: b });
        return;
      }

      const aObj = a as Record<string, unknown>;
      const bObj = b as Record<string, unknown>;
      const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);

      for (const key of allKeys) {
        compare(aObj[key], bObj[key], path ? `${path}.${key}` : key);
      }
    }

    compare(oldConfig, newConfig, "");
    return changes;
  }
}

// Re-export types and registry
export { ConfigRegistry } from "./registry";
export type { ConfigTypes } from "./types";

// Re-export component config modules for external type access
export type { ChartConfig as ChartConfigDef } from "@openchart/chart-core/chart/config";
export type {
  YAxisConfig,
  XAxisConfig,
} from "@openchart/chart-core/scale/config";
export type { InteractionConfig } from "@openchart/chart-core/interaction/config";
export type { SeriesConfig } from "@openchart/chart-core/series/config";
export type { AnimationConfig } from "@openchart/chart-core/animation/config";
export type { PrimitiveConfig } from "@openchart/chart-core/primitive/config";
