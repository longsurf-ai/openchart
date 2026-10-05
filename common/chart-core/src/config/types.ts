// Purpose: Zod-based type definitions for the federated configuration system (Definition, Update, Selector, ChangeEvent, DeepPartial)
// Module:  @openchart/chart-core / config

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";

/**
 * Core types for the federated configuration system.
 *
 * Each component defines its own config schema locally and registers it
 * with the ConfigRegistry. The registry composes all schemas into a
 * unified ChartConfig.
 */
export namespace ConfigTypes {
  /**
   * A config definition that components register with the registry.
   * @template T - The Zod schema type
   */
  export type Definition<T extends z.ZodTypeAny = z.ZodTypeAny> = {
    /** Unique namespace key (e.g., "chart", "yAxis", "interaction") */
    key: string;
    /** Zod schema for validation and type inference */
    schema: T;
    /** Default values (parsed through schema) */
    defaults: z.infer<T>;
    /** Optional version for migration support */
    version?: number;
  };

  /**
   * Immutable update function type.
   * Takes current value, returns new value.
   */
  export type Update<T> = (current: T) => T;

  /**
   * Selector function for extracting a specific part of config.
   */
  export type Selector<Full, Part> = (config: Full) => Part;

  /**
   * Event emitted when config changes.
   */
  export type ChangeEvent<T = unknown> = {
    /** Dot-separated path to changed value (e.g., "interaction.crosshair.mode") */
    path: string;
    /** Value before change */
    oldValue: unknown;
    /** Value after change */
    newValue: unknown;
    /** Full config after change */
    config: T;
  };

  /**
   * Handler for config change events.
   */
  export type ChangeHandler<T = unknown> = (event: ChangeEvent<T>) => void;

  /**
   * Unsubscribe function returned by subscription methods.
   */
  export type Unsubscribe = () => void;

  /**
   * Deep partial type utility - makes all nested properties optional.
   * Used for partial config updates where any nested property can be optional.
   */
  export type DeepPartial<T> = T extends object
    ? { [P in keyof T]?: DeepPartial<T[P]> }
    : T;
}
