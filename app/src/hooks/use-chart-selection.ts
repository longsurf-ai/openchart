// Purpose: Read the Dashboard-owned chart/cell selection.
import { useContext } from "react";
import { ChartSelectionContext } from "@openchart/app/lib/chart/selection";

/** Read the one selection shared by the page and chart widgets. @example const selection = useChartSelection(); */
export function useChartSelection() {
  const selection = useContext(ChartSelectionContext);
  if (!selection)
    throw new Error("Chart selection requires ChartSelectionContext.");
  return selection;
}
