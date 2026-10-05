// Purpose: Keep tool buttons and core drawing completion on one state owner.
import type { Drawing } from "@openchart/chart-core";
import { useCallback } from "react";
import { useStore } from "zustand";

import type { ChartRuntime } from "@openchart/app/lib/chart/store";

/** Subscribe to a target chart's tool and operate on that same target. @example const {activeTool, selectTool} = useDrawingTool(chart); */
export function useDrawingTool(chart: ChartRuntime) {
  const activeTool = useStore(
    chart.store,
    (state) => state.drawings.activeTool,
  );
  const toolLocked = useStore(
    chart.store,
    (state) => state.drawings.toolLocked,
  );
  const selectTool = useCallback(
    (tool: Drawing.Type | null) => {
      chart.mutate((state) => {
        state.drawings.activeTool = tool;
        delete state.drawings.draft;
        delete state.drawings.selectedId;
      });
    },
    [chart],
  );
  const toggleLock = useCallback(() => {
    chart.mutate((state) => {
      state.drawings.toolLocked = !state.drawings.toolLocked;
    });
  }, [chart]);
  return { activeTool, toolLocked, selectTool, toggleLock };
}
