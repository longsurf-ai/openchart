// Purpose: Create a Dashboard with its initial Binance BTCUSDT Chart atomically.

import { Transition } from "@openchart/server/lib/resource";
import { dashboardResource } from "@openchart/server/resources/dashboard";
import { Effect } from "effect";

import { createChartWidget } from "./create-chart-widget";

/**
 * Creates "New dashboard" with one Binance BTCUSDT daily Chart filling the desktop viewport,
 * including price and volume. The fixed preset needs no Feed access; market
 * data is loaded when the Chart is observed. Ordinary Dashboard create stays empty.
 * All identities are allocated during apply, and all writes share the caller's
 * transaction. Any failure rolls back the Dashboard, Chart, and placement.
 *
 * @example const { dashboard, chart } = yield* Transactor.run(createDashboardWithChart());
 */
export function createDashboardWithChart() {
  return Transition.from((tx) =>
    Effect.gen(function* () {
      const dashboard = yield* dashboardResource.transitions
        .create({ name: "New dashboard", favorite: false, widgets: [] })
        .apply(tx, undefined);
      return yield* createChartWidget({
        dashboardId: dashboard.id,
        expectedRevision: dashboard.revision,
        widgets: dashboard.widgets,
        layout: { x: 0, y: 0, w: 12, h: 24 },
      }).apply(tx, undefined);
    }),
  );
}
