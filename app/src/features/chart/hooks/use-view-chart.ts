// Purpose: Answer the Dashboard's ViewChart intent by showing a listing in this chart's target cell.
import { providerListingKey } from "@openchart/market";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { chartMutation } from "@openchart/app/features/chart/api/queries";
import {
  getMainSource,
  replaceListing,
  targetCell,
} from "@openchart/app/features/chart/utils/resource";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import { useDatafeed } from "@openchart/app/hooks/use-datafeed";
import { useIntentHandler } from "@openchart/app/hooks/use-intent";
import type { IntentPayload } from "@openchart/app/lib/widget/intent/intent";
import { viewChart } from "@openchart/app/lib/widget/intent/intents";

/**
 * Answer ViewChart while this chart grid is mounted: the Dashboard's target cell
 * (the focused cell while visible, else the first) shows the listing, and cells
 * linked to it follow. The same provider keeps the cell's session and adjustment;
 * another provider starts from its defaults. The write queues behind other edits
 * of this Chart, re-reading focus when it applies. A listing already shown saves
 * nothing. Failures, including a source without chart data, toast once and leave
 * the Chart unchanged. Requires ChartGridProvider and FeedProvider.
 * @example function ChartIntents({ children }: PropsWithChildren) { useViewChart(); return <>{children}</>; }
 */
export function useViewChart() {
  const { chartId, transport, focusedId } = useChartGrid();
  const client = useQueryClient();
  const feed = useDatafeed();
  // `view` reports the whole request, so the nested Chart write stays quiet.
  const save = useMutation({
    ...chartMutation(transport, client, chartId),
    meta: { silent: true },
  });
  const view = useMutation({
    meta: { errorTitle: "Couldn’t show this symbol" },
    mutationFn: async ({ listing }: IntentPayload<typeof viewChart>) => {
      const capabilities = await feed.bars.getCapabilities(listing);
      if (!capabilities.length)
        throw new Error("This source does not currently provide chart data.");
      await save.mutateAsync((resource) => {
        const cell = targetCell(resource, focusedId);
        if (!cell) throw new Error("This chart has no visible cell.");
        return providerListingKey(getMainSource(cell)) ===
          providerListingKey(listing)
          ? resource
          : replaceListing(resource, cell.id, listing, capabilities);
      });
    },
  });
  useIntentHandler(viewChart, (payload) => view.mutateAsync(payload));
}
