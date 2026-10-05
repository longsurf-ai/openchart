// Purpose: Keep the renderer and React on the same immutable chart state.
import type { v2 } from "@openchart/chart-core";
import type { ChartEvent } from "@openchart/chart-core/bus";
import type { z } from "zod";
import type { Observable } from "rxjs";
import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

/** A synchronous mutation; only the supplied draft may be changed. */
export type ChartMutation = (state: v2.Chart.State) => void;

/** State is transient; display preferences are persisted separately. @example const store = createChartStore(v2.createState()); */
export function createChartStore(initial: v2.Chart.State) {
  return createStore<v2.Chart.State>()(
    subscribeWithSelector(immer(() => initial)),
  );
}

/** One mounted chart's vanilla Zustand store. */
export type ChartStore = ReturnType<typeof createChartStore>;

/** Committed interactions consumed by the page and data hooks. */
export type ChartOutput =
  | { type: "paint" }
  | ({ type: "chart-explain" } & z.infer<
      typeof ChartEvent.ChartExplainRange.schema
    >)
  | { type: "range"; from: number; to: number }
  | { type: "crosshair"; index: number | undefined; x: number; y: number };

/** Stable capabilities for one mounted renderer; never persisted. */
export interface ChartRuntime {
  readonly id: string;
  readonly store: ChartStore;
  readonly renderer: v2.ChartRenderer;
  readonly output$: Observable<ChartOutput>;
  /** Commit a mutation and schedule painting. @example chart.mutate(s => { s.drawings.activeTool = null; }, 'light'); */
  readonly mutate: (recipe: ChartMutation, level?: "light" | "full") => void;
}
