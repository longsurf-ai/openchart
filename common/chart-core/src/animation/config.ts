// Purpose: Zod schemas and defaults for kinetic-scroll, zoom, and transition animation settings
// Module:  @openchart/chart-core / animation

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { z } from "zod";
import { ConfigRegistry } from "@openchart/chart-core/config/registry";

/**
 * Animation configuration.
 * Controls animation behavior for kinetic scrolling, zooming, and transitions.
 */
export namespace AnimationConfig {
  /**
   * Kinetic scrolling configuration.
   * Controls momentum-based scrolling after drag release.
   */
  export const Kinetic = z
    .object({
      enabled: z
        .boolean()
        .default(true)
        .describe("Enable kinetic/momentum scrolling"),
      duration: z
        .number()
        .positive()
        .default(1500)
        .describe("Animation duration in milliseconds"),
      minSpeed: z
        .number()
        .default(0.2)
        .describe("Minimum speed threshold to trigger kinetic scroll"),
      maxSpeed: z.number().default(7).describe("Maximum speed cap"),
      decay: z
        .number()
        .min(0)
        .max(1)
        .default(0.95)
        .describe("Velocity decay factor per frame"),
      minMove: z
        .number()
        .default(15)
        .describe("Minimum movement in pixels to trigger kinetic scroll"),
    })
    .describe("Momentum-scrolling animation settings.");
  export type Kinetic = z.infer<typeof Kinetic>;

  /**
   * Zoom animation configuration.
   */
  export const Zoom = z
    .object({
      animated: z.boolean().default(true).describe("Animate zoom transitions"),
      duration: z
        .number()
        .positive()
        .default(200)
        .describe("Zoom animation duration in milliseconds"),
      minFactor: z
        .number()
        .positive()
        .default(0.02)
        .describe("Minimum zoom factor"),
      maxMargin: z
        .number()
        .min(0)
        .max(1)
        .default(0.98)
        .describe("Maximum zoom margin"),
      decayFactor: z
        .number()
        .min(0)
        .max(1)
        .default(0.97)
        .describe("Zoom decay factor for smooth stopping"),
    })
    .describe("Zoom animation tuning parameters.");
  export type Zoom = z.infer<typeof Zoom>;

  /**
   * Transition animation configuration.
   * Controls general UI transitions.
   */
  export const Transition = z
    .object({
      enabled: z.boolean().default(true).describe("Enable UI transitions"),
      duration: z
        .number()
        .positive()
        .default(200)
        .describe("Default transition duration in milliseconds"),
    })
    .describe("Generic UI transition animation settings.");
  export type Transition = z.infer<typeof Transition>;

  /**
   * Full animation config schema.
   */
  export const Schema = z
    .object({
      enabled: z
        .boolean()
        .default(true)
        .describe("Master toggle for all animations"),
      kinetic: Kinetic.default({
        enabled: true,
        duration: 1500,
        minSpeed: 0.2,
        maxSpeed: 7,
        decay: 0.95,
        minMove: 15,
      }).describe("Kinetic scrolling settings"),
      zoom: Zoom.default({
        animated: true,
        duration: 200,
        minFactor: 0.02,
        maxMargin: 0.98,
        decayFactor: 0.97,
      }).describe("Zoom animation settings"),
      transition: Transition.default({
        enabled: true,
        duration: 200,
      }).describe("UI transition settings"),
    })
    .describe("Animation configuration document.");
  export type Schema = z.infer<typeof Schema>;

  /**
   * Config definition for registration.
   */
  export const definition = {
    key: "animation",
    schema: Schema,
    defaults: Schema.parse({}),
  } as const;
}

// Self-register with ConfigRegistry
ConfigRegistry.register(AnimationConfig.definition);
