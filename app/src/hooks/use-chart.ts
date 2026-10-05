// Purpose: Read the mounted chart and subscribe only to the state a view uses.
import type { v2 } from "@openchart/chart-core";
import { useContext } from "react";
import { useStore } from "zustand";

import { ChartContext } from "@openchart/app/lib/chart/context";

/** Read stable chart capabilities, without subscribing to state. @example const chart = useChart(); */
export function useChart() {
  const chart = useContext(ChartContext);
  if (!chart) throw new Error("Chart hooks require a mounted ChartCore.");
  return chart;
}

/** Subscribe to a selected chart value. @example const tool = useChartState(s => s.drawings.activeTool); */
export function useChartState<T>(selector: (state: v2.Chart.State) => T) {
  return useStore(useChart().store, selector);
}
