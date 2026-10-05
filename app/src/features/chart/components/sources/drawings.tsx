// Purpose: Read drawing ownership where this chart's persistent overlay is consumed.
import { useQuery } from "@tanstack/react-query";
import type { BarsSeries } from "@openchart/feed";
import type { ReactNode } from "react";

import { chartDetail } from "@openchart/app/features/chart/api/queries";
import { ChartExplainDrawings } from "@openchart/app/features/chart/components/chart-explain-drawings";
import { AnnotationCard } from "@openchart/app/features/chart/components/annotation-card";
import { ChartDrawingAlerts } from "@openchart/app/features/chart/components/alert-lines";
import { AnnotationSourceBadges } from "@openchart/app/features/chart/components/annotation-source-badges";
import { ResourceNotice } from "@openchart/app/features/chart/components/resource-notice";
import { FixedRangeVolumeProfiles } from "@openchart/app/features/chart/components/sources/volume-profile";
import { getMainSource } from "@openchart/app/features/chart/utils/resource";
import { useChart } from "@openchart/app/hooks/use-chart";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import { useDrawingResources } from "@openchart/app/hooks/use-drawing-resources";
import {
  drawingScopeKey,
  type DrawingScope,
} from "@openchart/app/lib/chart/drawings";

type DrawingChildren = (
  drawings: ReturnType<typeof useDrawingResources>,
) => ReactNode;
/** Consume the current cell's listing; changing ownership remounts only its drawing projection. @example <DrawingSource cellId={cellId} /> */
export function DrawingSource({
  cellId,
  drawingId,
  readOnly = false,
  children,
}: {
  cellId: string;
  drawingId?: string;
  /** Show every drawing locked, without alerts, Chart Explain or edits. */
  readOnly?: boolean;
  children?: DrawingChildren;
}) {
  const { chartId, transport } = useChartGrid();
  const { data } = useQuery({
    ...chartDetail(transport, chartId),
    select: (resource) => {
      const cell = resource.cells.find((cell) => cell.id === cellId);
      if (!cell) return undefined;
      const { provider, listing } = getMainSource(cell);
      return {
        scope: { dashboardId: resource.dashboardId, provider, listing },
        settings: {
          resolution: cell.resolution,
          session: cell.session,
          adjustment: cell.adjustment,
        },
      };
    },
  });
  return data ? (
    <DrawingProjection
      key={`${drawingScopeKey(data.scope)}:${drawingId ?? "all"}:${readOnly}`}
      scope={data.scope}
      drawingId={drawingId}
      readOnly={readOnly}
      settings={data.settings}
    >
      {children}
    </DrawingProjection>
  ) : null;
}

function DrawingProjection({
  scope,
  drawingId,
  readOnly,
  settings,
  children,
}: {
  scope: DrawingScope;
  drawingId?: string;
  readOnly: boolean;
  settings: Pick<BarsSeries, "resolution" | "session" | "adjustment">;
  children?: DrawingChildren;
}) {
  const chart = useChart();
  const { transport } = useChartGrid();
  const drawings = useDrawingResources(
    chart,
    transport,
    scope,
    drawingId,
    readOnly,
  );
  const { error, retry } = drawings;
  return (
    <>
      {children?.(drawings)}
      <FixedRangeVolumeProfiles
        scope={scope}
        settings={settings}
        drawingId={drawingId}
      />
      {!drawingId && !readOnly ? (
        <>
          <ChartDrawingAlerts
            bindings={drawings.resourceIds}
            settings={settings}
          />
          <AnnotationSourceBadges transport={transport} />
          <ChartExplainDrawings
            chart={chart}
            scope={scope}
            settings={settings}
          />
          <AnnotationCard />
        </>
      ) : null}
      {error ? (
        <div className="absolute bottom-10 left-14 right-16 z-20">
          <ResourceNotice error={error} onRetry={() => void retry()} />
        </div>
      ) : null}
    </>
  );
}
