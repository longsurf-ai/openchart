// Purpose: Register independently owned feature widgets for Dashboard composition.
import { createElement, type PropsWithChildren } from "react";

import { ChartAlertsProvider } from "@openchart/app/app/alerts/chart-alerts";
import { SymbolPicker } from "@openchart/app/features/chart/components/symbol-picker";
import { chartWidget } from "@openchart/app/features/chart/components/widget";
import {
  WatchlistFormulaPicker,
  WatchlistSymbolPicker,
} from "@openchart/app/features/watchlist/components/context";
import { watchlistWidget } from "@openchart/app/features/watchlist/components/widget";
import { workspaceWidget } from "@openchart/app/features/workspace/components/widget";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";

import { WorkspaceChartActions } from "./workspace-chart-actions";
import { WorkspaceFileBeside } from "./workspace-file-beside";
import { FormulaCodePicker } from "./formula-code-picker";

/** Charts draw saved alerts and open Indicator code beside themselves. */
function ChartProvider({ children }: PropsWithChildren) {
  return createElement(
    WorkspaceFileBeside,
    null,
    createElement(ChartAlertsProvider, null, children),
  );
}

const WatchlistPlacement = watchlistWidget.Provider!;

/** Watchlists select market rows and Formula code, execute shared calculations, and open code beside themselves. */
function WatchlistProvider({ children }: PropsWithChildren) {
  return createElement(
    WorkspaceFileBeside,
    null,
    createElement(
      WatchlistSymbolPicker.Provider,
      { value: SymbolPicker },
      createElement(
        WatchlistFormulaPicker.Provider,
        { value: FormulaCodePicker },
        createElement(WatchlistPlacement, null, children),
      ),
    ),
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
    description: "Track live prices and formulas in collapsible sections.",
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
