// Purpose: Removes an Indicator with its chart bindings in one Resource transaction.

import {
  ResourceNotFound,
  Revision,
  RevisionConflict,
  Transition,
} from "@openchart/server/lib/resource";
import { ChartId, chartResource } from "@openchart/server/resources/chart";
import {
  IndicatorId,
  indicatorResource,
} from "@openchart/server/resources/indicator";
import { Effect, Schema } from "effect";

/** One Indicator of one chart, removed at the chart's expected revision. */
export const RemoveIndicatorInput = Schema.Struct({
  chartId: ChartId,
  expectedRevision: Revision,
  indicatorId: IndicatorId,
});

/**
 * Drops every chart binding of the Indicator and each pane that removal
 * leaves empty, then deletes the Indicator. A stale chart revision, or an
 * Indicator of another chart, changes nothing.
 *
 * @example
 * const { chart } = yield* Transactor.run(removeIndicator(input));
 */
export function removeIndicator(input: typeof RemoveIndicatorInput.Type) {
  return Transition.from((tx) =>
    Effect.gen(function* () {
      const chart = yield* chartResource.transitions
        .get(input.chartId)
        .apply(tx, undefined);
      if (chart.revision !== input.expectedRevision)
        return yield* new RevisionConflict({
          resource: "chart",
          id: chart.id,
          expected: input.expectedRevision,
          actual: chart.revision,
        });
      const indicator = yield* indicatorResource.transitions
        .get(input.indicatorId)
        .apply(tx, undefined);
      if (indicator.chartId !== chart.id)
        return yield* new ResourceNotFound({
          resource: "indicator",
          id: input.indicatorId,
        });
      const bound = (
        binding: (typeof chart.cells)[number]["panes"][number]["series"][number],
      ) =>
        binding.source.kind === "indicator" &&
        binding.source.indicatorId === input.indicatorId;
      const cells = chart.cells.map((cell) => ({
        ...cell,
        panes: cell.panes.flatMap((pane) => {
          const series = pane.series.filter((binding) => !bound(binding));
          return series.length ? [{ ...pane, series }] : [];
        }),
      }));
      const updated = chart.cells.some((cell) =>
        cell.panes.some((pane) => pane.series.some(bound)),
      )
        ? yield* chartResource.transitions
            .patch({
              id: chart.id,
              expectedRevision: chart.revision,
              operations: [{ op: "replace", path: "/cells", value: cells }],
            })
            .apply(tx, undefined)
        : chart;
      yield* indicatorResource.transitions
        .remove(input.indicatorId)
        .apply(tx, undefined);
      return { chart: updated };
    }),
  );
}
