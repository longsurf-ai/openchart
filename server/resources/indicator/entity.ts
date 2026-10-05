// Purpose: Derive the Indicator Resource entity and require that its snapshot holds its own script.
import { listKey } from "@openchart/server/lib/resource/annotation";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { withInvariants } from "@openchart/server/lib/resource/invariant";
import { ChartCellId } from "@openchart/server/resources/chart";
import * as Tea from "@openchart/tea";
import { ReadInput } from "@openchart/server/workspace/contract";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Schema } from "effect";

import { IndicatorId, indicatorTable } from "./schema";

export { IndicatorId } from "./schema";

// chartId stays a plain list key, as chart.dashboardId and drawing.dashboardId do.
const columns = createSelectSchema(indicatorTable, {
  cellId: ChartCellId,
  workspaceId: ReadInput.fields.workspaceId,
  scriptPath: ReadInput.fields.path.check(
    Schema.makeFilter((path) => path.endsWith(".tea")),
  ),
  snapshot: Tea.SnapshotSources.fields.sources,
  parameterOverrides: Schema.Record(
    Schema.String,
    Schema.Union([Schema.Finite, Schema.Boolean, Schema.String]),
  ),
});

/**
 * One chart Indicator with its own revision. Its Tea program is the snapshot
 * plus explicit parameter overrides; declared defaults come from compiling the
 * snapshot, and the market comes from its chart cell. `source` records where
 * the snapshot was taken, and Reload is the only path from the file.
 */
export const IndicatorEntity = withInvariants(
  Schema.Struct({
    ...envelopeFields(IndicatorId),
    chartId: listKey(columns.fields.chartId),
    cellId: columns.fields.cellId,
    source: Schema.Struct({
      workspaceId: columns.fields.workspaceId,
      path: columns.fields.scriptPath,
    }),
    snapshot: columns.fields.snapshot,
    parameterOverrides: columns.fields.parameterOverrides,
  }),
  (invariant) => [
    invariant(
      "The snapshot must contain the script at source.path",
      (indicator, { expect }) => {
        expect(Object.hasOwn(indicator.snapshot, indicator.source.path), {
          path: ["snapshot"],
        }).toBe(true);
      },
      { code: "indicator.snapshot_entry" },
    ),
  ],
);

/** Complete Indicator returned by Resource reads. */
export type IndicatorEntity = typeof IndicatorEntity.Type;
