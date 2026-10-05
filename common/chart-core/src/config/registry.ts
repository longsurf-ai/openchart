// Purpose: Global registry where components register their config schemas; composes them into a single validated schema with caching
// Module:  @openchart/chart-core / config

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ConfigTypes } from "./types";

/**
 * ConfigRegistry - Core registration mechanism for the federated config system.
 *
 * Components register their config schemas here. The registry composes all
 * schemas into a unified schema that can be accessed centrally.
 *
 * Pattern follows SeriesRegistry and CoordSysRegistry from the codebase.
 */
export namespace ConfigRegistry {
  // Internal storage for registered definitions
  const definitions = new Map<string, ConfigTypes.Definition>();

  // Cached composed schema (invalidated on new registration)
  let composedSchema: z.ZodObject<z.ZodRawShape> | null = null;
  let composedDefaults: Record<string, unknown> | null = null;

  /**
   * Register a config definition.
   * Each component calls this to register its config schema.
   *
   * @throws Error if key is already registered
   */
  export function register<T extends z.ZodTypeAny>(
    def: ConfigTypes.Definition<T>,
  ): void {
    if (definitions.has(def.key)) {
      throw new Error(`Config "${def.key}" already registered`);
    }
    definitions.set(def.key, def);
    // Invalidate cache
    composedSchema = null;
    composedDefaults = null;
  }

  /**
   * Get a specific definition by key.
   */
  export function get<T extends z.ZodTypeAny>(
    key: string,
  ): ConfigTypes.Definition<T> | undefined {
    return definitions.get(key) as ConfigTypes.Definition<T> | undefined;
  }

  /**
   * Check if a key is registered.
   */
  export function has(key: string): boolean {
    return definitions.has(key);
  }

  /**
   * List all registered keys.
   */
  export function keys(): string[] {
    return Array.from(definitions.keys());
  }

  /**
   * Compose all registered schemas into a single Zod schema.
   * Result is cached until a new registration invalidates it.
   */
  export function compose(): z.ZodObject<z.ZodRawShape> {
    if (composedSchema) return composedSchema;

    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, def] of definitions) {
      // Wrap each schema with its defaults
      shape[key] = def.schema.default(def.defaults);
    }
    composedSchema = z.object(shape);
    return composedSchema;
  }

  /**
   * Get composed default values for all registered configs.
   */
  export function defaults(): Record<string, unknown> {
    if (composedDefaults) return composedDefaults;

    const result: Record<string, unknown> = {};
    for (const [key, def] of definitions) {
      result[key] = def.defaults;
    }
    composedDefaults = result;
    return result;
  }

  /**
   * Parse and validate input against the composed schema.
   */
  export function parse(input: unknown): Record<string, unknown> {
    return compose().parse(input);
  }

  /**
   * Safe parse - returns result object with success/error.
   */
  export function safeParse(input: unknown) {
    return compose().safeParse(input);
  }

  /**
   * Get the inferred TypeScript type of the composed schema.
   * Usage: type Full = ConfigRegistry.Infer
   */
  export type Infer = z.infer<ReturnType<typeof compose>>;

  /**
   * Clear all registrations (useful for testing).
   */
  export function clear(): void {
    definitions.clear();
    composedSchema = null;
    composedDefaults = null;
  }
}
