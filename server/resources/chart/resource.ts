// Purpose: Composes the chart grid Resource and exposes its canonical contract.

import { defineResource } from "@openchart/server/lib/resource/definition";

import { ChartEntity } from "./entity";
import { chartStore } from "./store";

export {
  ChartEntity,
  ChartId,
  ChartCellId,
  ChartPaneId,
  ChartMarketSourceId,
  ChartSeriesId,
  getMainSource,
} from "./entity";

/** The complete grid Resource, with dashboardId as its only list filter. */
export const chartResource = defineResource({
  name: "chart",
  description:
    "A saved chart grid belonging to a dashboard, with cells, market sources, indicator file references, panes, series, and links that synchronize listings or crosshairs between cells. A series can draw one column of a workspace_dataset on the cell's bar timeline.",
  entity: ChartEntity,
  store: chartStore,
});

/** Complete chart grid returned by Resource reads and writes. */
export type Chart = typeof chartResource.entity.Type;
