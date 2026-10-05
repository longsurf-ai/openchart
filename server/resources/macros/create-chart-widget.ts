// Purpose: Creates a Chart and its Dashboard placement in one Resource transaction.

import { Revision, Transition } from "@openchart/server/lib/resource";
import { ProviderId } from "@openchart/market";
import {
  chartResource,
  ChartCellId,
  ChartMarketSourceId,
  ChartPaneId,
  ChartSeriesId,
} from "@openchart/server/resources/chart";
import {
  dashboardResource,
  DashboardId,
  WidgetLayout,
  WidgetPlacementId,
  WidgetPlacement,
} from "@openchart/server/resources/dashboard";
import { Effect, Schema, Struct } from "effect";

/** Supply the existing placements and new rectangle together; omitting chart creates the BTC daily starter. */
export const CreateChartWidgetInput = Schema.Struct({
  dashboardId: DashboardId,
  expectedRevision: Revision,
  // Chart's body has no server-managed fields. Its relational checks concern
  // cells and links, so omitting only dashboardId preserves every check.
  chart: chartResource.body
    .mapFields(Struct.omit(["dashboardId"]), {
      unsafePreserveChecks: true,
    })
    .pipe(Schema.optionalKey),
  widgets: Schema.Array(WidgetPlacement),
  layout: WidgetLayout,
});

/**
 * Adds a new Chart and saves all placement geometry atomically. Omitted chart
 * uses the Binance BTCUSDT daily preset without Feed access. A stale Dashboard revision or an
 * invalid placement rolls back Chart creation too; no side effects run at construction.
 *
 * @example
 * const result = yield* Transactor.run(createChartWidget(decodedInput));
 */
export function createChartWidget(input: typeof CreateChartWidgetInput.Type) {
  return Transition.from((tx) =>
    Effect.gen(function* () {
      yield* dashboardResource.transitions
        .get(input.dashboardId)
        .apply(tx, undefined);
      const chart = yield* chartResource.transitions
        .create({
          ...(input.chart ?? createDefaultChart()),
          dashboardId: input.dashboardId,
        })
        .apply(tx, undefined);
      const dashboard = yield* dashboardResource.transitions
        .patch({
          id: input.dashboardId,
          expectedRevision: input.expectedRevision,
          operations: [
            {
              op: "replace",
              path: "/widgets",
              value: [
                ...input.widgets,
                {
                  id: WidgetPlacementId.create(),
                  kind: "chart",
                  resourceId: chart.id,
                  layout: input.layout,
                },
              ],
            },
          ],
        })
        .apply(tx, undefined);
      return { dashboard, chart };
    }),
  );
}

function createDefaultChart(): NonNullable<
  typeof CreateChartWidgetInput.Type.chart
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
