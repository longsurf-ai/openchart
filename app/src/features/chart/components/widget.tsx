// Purpose: Adapt a Dashboard placement to the existing chart grid and its controls.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChartCandlestick } from "lucide-react";
import { useState, type PropsWithChildren } from "react";

import { useWidget } from "@openchart/app/hooks/use-widget";
import { ChartGridProvider } from "@openchart/app/lib/chart/grid";
import { Button } from "@openchart/app/components/ui/button";
import {
  chartList,
  chartDetail,
  createCell,
  chooseBarsOptions,
} from "../api/queries";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { SymbolPicker } from "./symbol-picker";
import { ResourceNotice } from "./resource-notice";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";

import { FocusedDrawingToolbar } from "./drawing-toolbar";
import { ChartGrid } from "./grid";
import { ChartToolbar } from "./toolbar";
import "./workspace.css";

function ChartPlacement({ children }: PropsWithChildren) {
  const { dashboardId, transport } = useWidget();
  const query = useQuery(chartList(transport, dashboardId));
  const chartId = query.data?.[0]?.id;
  if (!query.data)
    return query.isPending ? (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading chart…
      </p>
    ) : (
      <ResourceNotice
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  if (!chartId)
    return <CreateChart dashboardId={dashboardId} transport={transport} />;
  return (
    <ChartGridProvider key={chartId} chartId={chartId} transport={transport}>
      {children}
    </ChartGridProvider>
  );
}

function CreateChart({
  dashboardId,
  transport,
}: {
  dashboardId: string;
  transport: AppTransport;
}) {
  const client = useQueryClient();
  const [picking, setPicking] = useState(false);
  const create = useMutation({
    meta: { errorTitle: "Couldn’t create this chart" },
    mutationFn: (cell: ReturnType<typeof createCell>) =>
      transport.rpc.resources.chart.create.mutate({
        dashboardId,
        cells: [cell],
      }),
    onSuccess: (chart) => {
      client.setQueryData(chartDetail(transport, chart.id).queryKey, chart);
      client.setQueryData(chartList(transport, dashboardId).queryKey, [chart]);
    },
    onError: () => {
      void client.invalidateQueries({
        queryKey: chartList(transport, dashboardId).queryKey,
      });
    },
  });
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted-foreground">
        Choose a symbol to create your chart.
      </p>
      <Button
        variant="outline"
        disabled={create.isPending}
        onClick={() => setPicking(true)}
      >
        Choose symbol
      </Button>
      {picking ? (
        <SymbolPicker
          onClose={() => setPicking(false)}
          onSelect={async (listing, capabilities) => {
            await create.mutateAsync(
              createCell(listing, chooseBarsOptions(capabilities)),
            );
          }}
        />
      ) : null}
    </div>
  );
}

function ChartWidgetContent() {
  return (
    <div className="relative h-full min-h-0 min-w-0">
      <ChartGrid />
      <FocusedDrawingToolbar />
    </div>
  );
}

/** Chart controls and content share existing grid interactions, never Resource copies. */
export const chartWidget: WidgetDefinition = {
  kind: "chart",
  title: "Chart",
  Icon: ChartCandlestick,
  defaultSize: { w: 12, h: 12 },
  minSize: { w: 4, h: 6 },
  Provider: ChartPlacement,
  Controls: ChartToolbar,
  Content: ChartWidgetContent,
};
