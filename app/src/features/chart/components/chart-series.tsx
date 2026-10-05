// Purpose: Let React own one chart-native series, shared by market and Tea visuals.
import { useLayoutEffect } from "react";
import { v2 } from "@openchart/chart-core";
import { useChart } from "@openchart/app/hooks/use-chart";
import { removeOwnedSeries } from "@openchart/app/lib/chart/data";

type Definition = Parameters<typeof v2.ChartStateUtils.addSeries>[1];
/** A declarative series; removing it also clears its transient interaction references. */
export type ChartSeriesProps = {
  id: string;
  type: string;
  source: "provider" | "computed";
  pane: number;
  axisId: string;
  fieldMap: NonNullable<Definition["fieldMap"]>;
  options: NonNullable<Definition["options"]>;
  axisOptions: Parameters<typeof v2.ChartStateUtils.applyYAxisOptions>[2];
  data: readonly unknown[];
  main?: boolean;
};

/** Own registration, presentation and data separately; frames never recreate the series.
 * @example <ChartSeries id="price" type="Line" source="provider" pane={0} axisId="right" fieldMap={{x:"time", value:"close"}} options={{}} axisOptions={{}} data={rows} />
 */
export function ChartSeries({
  id,
  type,
  source,
  pane,
  axisId,
  fieldMap,
  options,
  axisOptions,
  data,
  main = false,
}: ChartSeriesProps) {
  const chart = useChart();
  // Axis preferences are JSON values; equal fresh props must not reset modeAnchor on each tick.
  const axisKey = JSON.stringify(axisOptions);
  useLayoutEffect(() => {
    chart.mutate((state) => {
      v2.ChartStateUtils.addSeries(state, {
        id,
        type,
        source,
        pane,
        yAxisId: axisId,
        fieldMap,
      });
    }, "full");
    return () => chart.mutate((state) => removeOwnedSeries(state, id), "full");
  }, [chart, id, type, source, pane, axisId, fieldMap]);
  useLayoutEffect(() => {
    chart.mutate((state) => {
      v2.ChartStateUtils.applySeriesOptions(state, id, options);
      v2.ChartStateModel.getSeriesObject(state, id)!.role = main
        ? "main"
        : "normal";
    }, "full");
  }, [chart, id, type, source, pane, axisId, fieldMap, options, main]);
  useLayoutEffect(() => {
    chart.mutate(
      (state) =>
        v2.ChartStateUtils.applyYAxisOptions(
          state,
          axisId,
          JSON.parse(axisKey) as ChartSeriesProps["axisOptions"],
        ),
      "full",
    );
  }, [chart, id, type, source, pane, axisId, fieldMap, axisKey]);
  useLayoutEffect(() => {
    chart.mutate((state) =>
      v2.ChartStateUtils.setSeriesData(state, id, [...data]),
    );
  }, [chart, id, type, source, pane, axisId, fieldMap, data]);
  return null;
}
