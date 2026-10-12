// Purpose: Register independently owned feature widgets for Dashboard composition.
import { createElement, type PropsWithChildren } from "react";

import { ChartAlertsProvider } from "@openchart/app/app/alerts/chart-alerts";
import { SymbolPicker } from "@openchart/app/features/chart/components/symbol-picker";
import { chartWidget } from "@openchart/app/features/chart/components/widget";
import { WatchlistSymbolPicker } from "@openchart/app/features/watchlist/components/context";
import { watchlistWidget } from "@openchart/app/features/watchlist/components/widget";
import { workspaceWidget } from "@openchart/app/features/workspace/components/widget";
import type {
  WidgetDefinition,
  WidgetResolver,
} from "@openchart/app/lib/widget/widget";

import {
  CUSTOM_WIDGET_PREFIX,
  customWidgetDefinition,
} from "./custom/custom-widget";

import { WorkspaceChartActions } from "./workspace-chart-actions";
import { WorkspaceFileBeside } from "./workspace-file-beside";

/** Charts draw saved alerts and open Indicator code beside themselves. */
function ChartProvider({ children }: PropsWithChildren) {
  return createElement(
    WorkspaceFileBeside,
    null,
    createElement(ChartAlertsProvider, null, children),
  );
}

const WatchlistPlacement = watchlistWidget.Provider!;

/** Watchlists add rows through the chart feature's symbol search. */
function WatchlistProvider({ children }: PropsWithChildren) {
  return createElement(
    WatchlistSymbolPicker.Provider,
    { value: SymbolPicker },
    createElement(WatchlistPlacement, null, children),
  );
}

/** One inventory supplies both the widget gallery and mounted dashboard content. */
export const widgetCatalog = {
  chart: {
    definition: { ...chartWidget, Provider: ChartProvider },
    description: "Explore market prices and indicators.",
  },
  workspace: {
    definition: { ...workspaceWidget, Provider: WorkspaceChartActions },
    description: "Read and edit files alongside your charts.",
  },
  watchlist: {
    definition: { ...watchlistWidget, Provider: WatchlistProvider },
    description: "Track live prices in collapsible sections.",
  },
};

/** Only composition imports feature widget definitions. Unknown kinds remain visible. */
export const widgetRegistry: Readonly<
  Record<string, WidgetDefinition | undefined>
> = Object.fromEntries(
  Object.values(widgetCatalog).map(({ definition }) => [
    definition.kind,
    definition,
  ]),
);

/** Built-in kinds first; any `custom:<kind>` resolves to its saved widget, loaded inside its card. */
export const resolveWidget: WidgetResolver = (kind) =>
  widgetRegistry[kind] ??
  (kind.startsWith(CUSTOM_WIDGET_PREFIX)
    ? customWidgetDefinition(kind.slice(CUSTOM_WIDGET_PREFIX.length))
    : undefined);
