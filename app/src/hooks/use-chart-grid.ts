// Purpose: Access the chart grid's identity and local cell interactions.
import { useContext } from "react";

import { ChartGridContext } from "@openchart/app/lib/chart/grid";

/** Read grid capabilities; Resource consumers subscribe through Query themselves. @example const { chartId, transport } = useChartGrid(); */
export function useChartGrid() {
  const grid = useContext(ChartGridContext);
  if (!grid) throw new Error("Chart grid controls require ChartGridProvider.");
  return grid;
}
