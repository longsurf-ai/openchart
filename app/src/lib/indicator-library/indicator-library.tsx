// Purpose: Let app composition open the study library for a captured chart cell.
import { createContext, type ContextType } from "react";
import { WorkspaceFileNavigation } from "@openchart/app/lib/workspace/workspace";

/** The initiating chart and its existing Workspace navigation capability. */
export type IndicatorLibraryTarget = {
  chartId: string;
  cellId: string;
  openFile: NonNullable<ContextType<typeof WorkspaceFileNavigation>>;
};

/**
 * App composition supplies the modal host; chart controls capture their target
 * before opening it. No route or Agent feature belongs to the chart.
 * @example const open = useContext(IndicatorLibraryNavigation); open?.(target);
 */
export const IndicatorLibraryNavigation = createContext<
  ((target: IndicatorLibraryTarget) => void) | null
>(null);
