// Purpose: Share mount-private chart/cell selection across composed dashboard controls.
import { useCallback, useMemo, useState, type PropsWithChildren } from "react";
import {
  ChartSelectionContext,
  type ChartSelectionContextValue,
} from "@openchart/app/lib/chart/selection";

/** Scope selection to the mounted dashboard; Resource data stays in Query. @example <ChartSelectionProvider>{children}</ChartSelectionProvider> */
export function ChartSelectionProvider({ children }: PropsWithChildren) {
  const [selection, setSelection] = useState<
    Pick<ChartSelectionContextValue, "activeChartId" | "focusedCells">
  >({ activeChartId: undefined, focusedCells: {} });
  const [activeWidgetId, focusWidget] = useState<string>();
  const focus = useCallback((chartId: string, cellId: string) => {
    focusWidget(undefined);
    setSelection((previous) => ({
      activeChartId: chartId,
      focusedCells: { ...previous.focusedCells, [chartId]: cellId },
    }));
  }, []);
  const value = useMemo(
    () => ({ ...selection, focus, activeWidgetId, focusWidget }),
    [selection, focus, activeWidgetId],
  );
  return (
    <ChartSelectionContext.Provider value={value}>
      {children}
    </ChartSelectionContext.Provider>
  );
}
