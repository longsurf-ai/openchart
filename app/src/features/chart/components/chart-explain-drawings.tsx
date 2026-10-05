// Purpose: Own Chart Explain gestures, Drawing persistence and scanner progress in Chart.
import { Drawing } from "@openchart/chart-core/drawing/types";
import type { BarsSeries } from "@openchart/feed";
import { Schema } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { ResourceNotice } from "@openchart/app/features/chart/components/resource-notice";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import {
  drawingList,
  drawingMutation,
  drawingScopeKey,
  type DrawingResource,
  type DrawingScope,
} from "@openchart/app/lib/chart/drawings";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";
import { useAgentContext } from "@openchart/app/lib/agent/provider";
import { useBoundSession } from "@openchart/app/lib/agent/use-bound-session";

const bindingKey = (resourceId: string) => `drawing:${resourceId}`;
type BarSettings = Pick<BarsSeries, "resolution" | "session" | "adjustment">;

/** Own selection-triggered submission and read-only restoration of saved session drawings.
 * Unmount detaches progress and clears previews without cancelling Agent execution.
 * @example <ChartExplainDrawings chart={chart} scope={scope} settings={settings} />
 */
export function ChartExplainDrawings({
  chart,
  scope,
  settings,
}: {
  chart: ChartRuntime;
  scope: DrawingScope;
  settings: BarSettings;
}) {
  const { transport } = useChartGrid();
  const { agent } = useAgentContext();
  const client = useQueryClient();
  const resources = useQuery(drawingList(transport, scope));
  const save = useMutation(drawingMutation(transport, client, scope));
  const start = useMutation({
    retry: false,
    mutationFn: async ({
      data,
      previewStartedAt,
      settings,
    }: {
      data: Drawing.AgentSessionItem;
      previewStartedAt: number | undefined;
      settings: BarSettings;
    }) => {
      try {
        const model = agent.defaultModel;
        if (!model)
          throw new Error(
            "Choose an available agent model before explaining a selection.",
          );
        const drawing = await save.mutateAsync({ id: data.id, data });
        if (!drawing) throw new Error("The selection was not saved.");
        const session = await agent.getOrCreateBoundSession.mutateAsync({
          key: bindingKey(drawing.id),
          title: `Explain ${scope.listing.symbol} selection`,
          kind: "chart_explain",
        });
        await agent.submitPrompt.mutateAsync({
          sessionID: session.id,
          model,
          parts: [
            {
              type: "plugin_input",
              input: {
                type: "chart_explain",
                drawingId: drawing.id,
                ...settings,
              },
            },
          ],
        });
      } finally {
        chart.mutate((state) => {
          if (state.chartExplain?.draftBand?.startedAtMs === previewStartedAt)
            delete state.chartExplain?.draftBand;
        });
      }
    },
  });
  const { mutate } = start;
  useEffect(() => {
    const subscription = chart.output$.subscribe((event) => {
      if (event.type !== "chart-explain") return;
      mutate({
        settings: { ...settings },
        data: Schema.decodeUnknownSync(Drawing.AgentSessionItem)({
          id: crypto.randomUUID(),
          type: "agent_session",
          anchors: [],
          range: {
            // Chart core emits seconds; saved selection Drawings use epoch ms.
            from: event.selection.fromTs * 1_000,
            to: event.selection.toTs * 1_000,
          },
          style: { lineColor: event.color },
          locked: true,
        }),
        previewStartedAt:
          chart.store.getState().chartExplain?.draftBand?.startedAtMs,
      });
    });
    return () => {
      subscription.unsubscribe();
      chart.mutate((state) => {
        delete state.chartExplain?.draftBand;
      });
    };
  }, [chart, mutate, settings]);
  return (
    <>
      {resources.data
        ?.filter(
          (row) =>
            row.data.type === "agent_session" &&
            drawingScopeKey(row) === drawingScopeKey(scope),
        )
        .map((drawing) => (
          <BoundDrawing key={drawing.id} drawing={drawing} chart={chart} />
        ))}
      {start.error ? (
        <div className="absolute bottom-10 left-14 right-16 z-20">
          <ResourceNotice
            error={start.error}
            onRetry={() => {
              if (start.variables) mutate(start.variables);
            }}
          />
        </div>
      ) : null}
    </>
  );
}

function BoundDrawing({
  drawing,
  chart,
}: {
  drawing: DrawingResource;
  chart: ChartRuntime;
}) {
  const { transport } = useChartGrid();
  const { progress, error, retry } = useBoundSession(
    transport,
    bindingKey(drawing.id),
  );
  const id = drawing.data.id;
  useEffect(() => {
    chart.mutate((state) => {
      if (progress) {
        const startedAtMs = progress.startedAt - performance.timeOrigin;
        const lines = progress.lines.length
          ? progress.lines.slice(-3)
          : [progress.status === "queued" ? "Queued…" : "Thinking…"];
        (state.drawings.sessionProgress ??= {})[id] = {
          startedAtMs,
          progressLog: lines.map((text) => ({ text, atMs: startedAtMs })),
        };
      } else delete state.drawings.sessionProgress?.[id];
    });
  }, [chart, id, progress]);
  useEffect(
    () => () => {
      chart.mutate((state) => {
        delete state.drawings.sessionProgress?.[id];
      });
    },
    [chart, id],
  );
  return error ? (
    <div className="absolute bottom-10 left-14 right-16 z-20">
      <ResourceNotice error={error} onRetry={retry} />
    </div>
  ) : null;
}
