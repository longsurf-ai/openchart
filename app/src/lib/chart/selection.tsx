// Purpose: Share the Dashboard symbol target (a chart cell or a custom widget) between the header and its widgets.
import { createContext } from "react";

/**
 * The Dashboard owns this transient selection; Resources remain in React Query.
 * Focusing a chart cell clears the widget target.
 */
export interface ChartSelectionContextValue {
  readonly activeChartId: string | undefined;
  readonly focusedCells: Readonly<Record<string, string>>;
  readonly focus: (chartId: string, cellId: string) => void;
  /** The custom widget placement whose symbol the header edits, if one was focused last. */
  readonly activeWidgetId: string | undefined;
  readonly focusWidget: (placementId: string) => void;
}

/** Share target IDs without exposing renderer handles to the page header. */
export const ChartSelectionContext = createContext<
  ChartSelectionContextValue | undefined
>(undefined);
