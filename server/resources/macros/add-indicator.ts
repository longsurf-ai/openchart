// Purpose: Adds an Indicator and binds every output on its chart cell in one Resource transaction.

import {
  ResourceNotFound,
  Revision,
  RevisionConflict,
  Transition,
} from "@openchart/server/lib/resource";
import {
  ChartCellId,
  ChartId,
  ChartPaneId,
  ChartSeriesId,
  chartResource,
} from "@openchart/server/resources/chart";
import { indicatorResource } from "@openchart/server/resources/indicator";
import * as Tea from "@openchart/server/tea";

import { Effect, Schema } from "effect";

/** A Workspace script and explicit choices to attach to one cell of a chart. */
export const AddIndicatorInput = Schema.Struct({
  chartId: ChartId,
  expectedRevision: Revision,
  cellId: ChartCellId,
  source: indicatorResource.body.fields.source,
  parameterOverrides: indicatorResource.body.fields.parameterOverrides,
});

/**
 * Snapshots the script with its imports and compiles it outside the
 * transaction, rejecting unknown or invalid overrides and outputs a chart
 * cannot draw. Then, at the expected chart revision, creates the Indicator
 * and binds every output: to the main pane for an overlay, else to one new
 * pane. A stale revision or a missing cell rolls back both writes.
 *
 * @example
 * const { chart, indicator } = yield* Transactor.run(addIndicator(input));
 */
export function addIndicator(input: typeof AddIndicatorInput.Type) {
  return Transition.make({
    resolve: Effect.gen(function* () {
      const tea = yield* Tea.Service;
      const { snapshot, outputs, overlay } = yield* Effect.scoped(
        Effect.gen(function* () {
          const node = yield* Effect.acquireRelease(
            tea.compile({ ...input.source, includeSources: true }),
            (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
          );
          return yield* Effect.try({
            try: () => {
              Tea.teaParameters(node.definition, input.parameterOverrides);
              return {
                snapshot: node.sources!,
                outputs: Tea.indicatorOutputs(node).map(
                  (output) => output.name,
                ),
                overlay: node.declaration!.overlay,
              };
            },
            catch: (cause) =>
              new Tea.Error(
                {
                  code: "invalid_request",
                  message:
                    cause instanceof Error
                      ? cause.message
                      : "This script cannot be added to a chart",
                },
                { cause },
              ),
          });
        }),
      );
      return { snapshot, outputs, overlay };
    }),
    apply: (tx, { snapshot, outputs, overlay }) =>
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
        const index = chart.cells.findIndex((cell) => cell.id === input.cellId);
        const cell = chart.cells[index];
        if (!cell)
          return yield* new ResourceNotFound({
            resource: "chart_cell",
            id: input.cellId,
          });
        const indicator = yield* indicatorResource.transitions
          .create({
            chartId: input.chartId,
            cellId: input.cellId,
            source: input.source,
            snapshot,
            parameterOverrides: input.parameterOverrides,
          })
          .apply(tx, undefined);
        const series = outputs.map((output) => ({
          id: ChartSeriesId.create(),
          role: "normal" as const,
          source: {
            kind: "indicator" as const,
            indicatorId: indicator.id,
            output,
          },
        }));
        const panes = overlay
          ? cell.panes.map((pane) =>
              pane.series.some((binding) => binding.role === "main")
                ? { ...pane, series: [...pane.series, ...series] }
                : pane,
            )
          : [...cell.panes, { id: ChartPaneId.create(), series }];
        const updated = yield* chartResource.transitions
          .patch({
            id: chart.id,
            expectedRevision: chart.revision,
            operations: [
              { op: "replace", path: `/cells/${index}/panes`, value: panes },
            ],
          })
          .apply(tx, undefined);
        return { chart: updated, indicator };
      }),
  });
}
