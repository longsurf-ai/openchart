// Purpose: In-memory registry of active grid views, mapping view IDs to their layout state and DOM elements
// Module:  @openchart/chart-core / view

/* eslint-disable @typescript-eslint/no-namespace -- Namespace exports are the intentional public API for this module. */
import { GridLayout } from "./layout";

export namespace ViewStore {
  export type CellEntry = {
    element: HTMLElement;
    chartId: string;
  };

  export type Entry = {
    id: string;
    state: GridLayout.State;
    container: HTMLElement;
    viewElement: HTMLElement;
    cells: Map<string, CellEntry>;
    resizeObserver: ResizeObserver;
  };

  const views = new Map<string, Entry>();

  export function get(id: string): Entry {
    const v = views.get(id);
    if (!v) throw new Error(`View ${id} not found`);
    return v;
  }

  export function tryGet(id: string): Entry | undefined {
    return views.get(id);
  }

  export function set(id: string, entry: Entry): void {
    views.set(id, entry);
  }

  export function remove(id: string): boolean {
    return views.delete(id);
  }

  export function has(id: string): boolean {
    return views.has(id);
  }
}
