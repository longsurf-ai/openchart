// Purpose: CoordSysRegistry — registry mapping coordinate system type names to factory functions
// Module:  @openchart/chart-core / coord

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { CoordSys } from "./def";
import { createCartesian2D } from "./cartesian";
import { createNone } from "./none";

type Factory = (
  bounds: CoordSys.Bounds,
  extents: CoordSys.Extents,
  defaultYScale?: string,
  scaleConfigs?: Record<string, CoordSys.ScaleConfig>,
) => CoordSys.State;

const factories = new Map<string, Factory>();

export namespace CoordSysRegistry {
  export function get(type: string): Factory | undefined {
    return factories.get(type);
  }

  export function register(type: string, factory: Factory): void {
    factories.set(type, factory);
  }

  export function has(type: string): boolean {
    return factories.has(type);
  }

  export function types(): string[] {
    return Array.from(factories.keys());
  }
}

CoordSysRegistry.register("cartesian2d", createCartesian2D);
CoordSysRegistry.register("none", (bounds) => createNone(bounds));
