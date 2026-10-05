// Purpose: Share only chart/cell selection between the Dashboard header and its widgets.
import { createContext } from "react";

/** The Dashboard owns this transient selection; Resources remain in React Query. */
export interface ChartSelectionContextValue {
  readonly activeChartId: string | undefined;
  readonly focusedCells: Readonly<Record<string, string>>;
  readonly focus: (chartId: string, cellId: string) => void;
}

/** Share target IDs without exposing renderer handles to the page header. */
export const ChartSelectionContext = createContext<
  ChartSelectionContextValue | undefined
>(undefined);
