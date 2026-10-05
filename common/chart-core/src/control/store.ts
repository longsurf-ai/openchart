// Purpose: In-memory store (Map) for control panel entries, keyed by panel ID
// Module:  @openchart/chart-core / control

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import type { ControlPanelConfig } from "./config";

export namespace ControlPanelStore {
  export type Entry = {
    id: string;
    state: ControlPanelConfig.State;
    options: ControlPanelConfig.Options;
  };

  const panels = new Map<string, Entry>();

  export function get(id: string): Entry {
    const entry = panels.get(id);
    if (!entry) throw new Error(`ControlPanel ${id} not found`);
    return entry;
  }

  export function tryGet(id: string): Entry | undefined {
    return panels.get(id);
  }

  export function set(id: string, entry: Entry): void {
    panels.set(id, entry);
  }

  export function remove(id: string): boolean {
    return panels.delete(id);
  }
}
