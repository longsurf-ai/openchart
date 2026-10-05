// Purpose: Position empty pane containers for source-owned legend content.
import { Chart } from "@openchart/chart-core/chart/state";
import { v2 } from "@openchart/chart-core";
import { useCallback, type CSSProperties } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { useChart } from "@openchart/app/hooks/use-chart";
/** Render only legend placement surfaces; source lifetimes belong to ChartCell.
 * @example <ChartLegend panes={cell.panes} register={registerLegendTarget} />
 */
export function ChartLegend({
  panes: definitions,
  register,
}: {
  panes: readonly { id: string }[];
  register: (id: string, node: HTMLDivElement | null) => void;
}) {
  const chart = useChart();
  const { config, panes } = useStore(
    chart.store,
    useShallow((state) => ({ config: state.config, panes: state.panes })),
  );
  const layout = Chart.computeLayout(config);
  const paneLayouts = v2.ChartPaneLayout.paneLayouts(panes, layout.areaHeight);
  return (
    <>
      {definitions.map((pane, index) => {
        const geometry = paneLayouts[index];
        return geometry ? (
          <LegendPane
            key={pane.id}
            id={pane.id}
            label={`Pane ${index + 1} legend`}
            register={register}
            style={{
              top: geometry.top + 8,
              left: 12,
              right: layout.rightAxisWidth + 12,
              maxHeight: Math.max(0, geometry.height - 8),
            }}
          />
        ) : null;
      })}
    </>
  );
}

function LegendPane({
  id,
  label,
  register,
  style,
}: {
  id: string;
  label: string;
  register: (id: string, node: HTMLDivElement | null) => void;
  style: CSSProperties;
}) {
  const ref = useCallback(
    (node: HTMLDivElement | null) => register(id, node),
    [id, register],
  );
  return (
    <div
      ref={ref}
      data-legend-pane={id}
      role="group"
      aria-label={label}
      style={style}
      className="pointer-events-none absolute z-[3] flex flex-col items-start gap-0.5 overflow-auto [container-type:inline-size]"
    />
  );
}
