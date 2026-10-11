// Purpose: Create a Dashboard with its initial Binance BTCUSDT Chart atomically.

import { Transition } from "@openchart/server/lib/resource";
import {
  dashboardResource,
  WidgetPlacementId,
} from "@openchart/server/resources/dashboard";
import { Effect } from "effect";

import { ProviderId } from "@openchart/market";
import {
  chartResource,
  ChartCellId,
  ChartMarketSourceId,
  ChartPaneId,
  ChartSeriesId,
} from "@openchart/server/resources/chart";

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
        .create({
          name: "New dashboard",
          favorite: false,
          widgets: [
            {
              id: WidgetPlacementId.create(),
              kind: "chart",
              layout: { x: 0, y: 0, w: 12, h: 24 },
            },
          ],
        })
        .apply(tx, undefined);
      const chart = yield* chartResource.transitions
        .create({
          ...createDefaultChart(),
          dashboardId: dashboard.id,
        })
        .apply(tx, undefined);
      return { dashboard, chart };
    }),
  );
}

function createDefaultChart(): Pick<
  typeof chartResource.body.Type,
  "preset" | "cells" | "links"
> {
  const sourceId = ChartMarketSourceId.create();
  return {
    preset: "1",
    links: [],
    cells: [
      {
        id: ChartCellId.create(),
        resolution: "1d",
        session: "24h",
        adjustment: "raw",
        marketSources: [
          {
            id: sourceId,
            provider: ProviderId.make("binance"),
            listing: {
              symbol: "BTCUSDT",
              name: "BTC / USDT",
              class: "crypto",
              venue: "Binance",
              currency: "USDT",
            },
          },
        ],
        panes: [
          {
            id: ChartPaneId.create(),
            series: [
              {
                id: ChartSeriesId.create(),
                role: "main",
                source: {
                  kind: "market",
                  marketSourceId: sourceId,
                  output: "price",
                },
              },
              {
                id: ChartSeriesId.create(),
                role: "normal",
                source: {
                  kind: "market",
                  marketSourceId: sourceId,
                  output: "volume",
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
