// Purpose: Use existing Resource RPCs and invalidation keys for chart Resources.
import type { BarsCapabilities, BarsSeries } from "@openchart/feed";
import { defineId } from "@openchart/identifier";
import type { ProviderListing } from "@openchart/market";
import {
  mutationOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";

import { resourceQueryKeys } from "@openchart/app/lib/resource/invalidation";
import type {
  AppTransport,
  ResourceOutputs,
} from "@openchart/app/lib/transport/transport";

/** The wire contract is derived from the shared transport, not copied from server schemas. */
export type ChartResource = Awaited<
  ReturnType<AppTransport["rpc"]["resources"]["chart"]["get"]["query"]>
>;
export type CellDefinition = ChartResource["cells"][number];
/** One chart Indicator Resource: a stored snapshot and explicit parameter choices. */
export type IndicatorResource = ResourceOutputs["indicator"]["get"];
/** Child identities use the same checked identifier primitive as the Resource owner. */
export const chartIds = {
  cell: defineId("ccl", "ChartCell.ID"),
  source: defineId("cms", "ChartMarketSource.ID"),
  pane: defineId("cpn", "ChartPane.ID"),
  series: defineId("csr", "ChartSeries.ID"),
  link: defineId("clk", "ChartLink.ID"),
};

/** Read one current revision for conflict-safe edits. @example useQuery(chartDetail(transport, id)); */
export function chartDetail(transport: AppTransport, id: string) {
  return queryOptions({
    queryKey: [...resourceQueryKeys.resource("chart"), "get", id],
    queryFn: () => transport.rpc.resources.chart.get.query({ id }),
    enabled: !!id,
  });
}

/** Read all saved grids in a Dashboard without creating or changing placements.
 * @example useQuery(chartList(transport, dashboardId));
 */
export function chartList(transport: AppTransport, dashboardId: string) {
  return queryOptions({
    queryKey: [
      ...resourceQueryKeys.resource("chart"),
      "list",
      transport.url,
      dashboardId,
    ],
    meta: { errorTitle: "Couldn’t load charts." },
    enabled: !!dashboardId,
    queryFn: async ({ signal }) => {
      const charts: ChartResource[] = [];
      let cursor: string | undefined;
      do {
        const page = await transport.rpc.resources.chart.list.query(
          {
            filter: { dashboardId },
            limit: 100,
            cursor,
          },
          { signal },
        );
        charts.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return charts;
    },
  });
}

/** Read a chart's Indicators; Resource events refresh it.
 * @example useQuery(indicatorList(transport, chartId));
 */
export function indicatorList(transport: AppTransport, chartId: string) {
  return queryOptions({
    queryKey: [
      ...resourceQueryKeys.resource("indicator"),
      "list",
      transport.url,
      chartId,
    ],
    meta: { errorTitle: "Couldn’t load indicators." },
    enabled: !!chartId,
    queryFn: async ({ signal }) => {
      const indicators: IndicatorResource[] = [];
      let cursor: string | undefined;
      do {
        const page = await transport.rpc.resources.indicator.list.query(
          { filter: { chartId }, limit: 100, cursor },
          { signal },
        );
        indicators.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return indicators;
    },
  });
}

/**
 * Where a built-in script the chart runs itself lives, such as the visible
 * range's volume profile. The location never changes while the app runs.
 */
export function chartBuiltinScript(
  transport: AppTransport,
  id: "volume-profile-range",
) {
  return queryOptions({
    queryKey: ["indicators", "chartBuiltin", transport.url, id],
    meta: { errorTitle: "Couldn’t find the volume profile script." },
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      transport.rpc.indicators.chartBuiltin.query({ id }, { signal }),
  });
}

/** Share pending state and serialization across every editor of one Resource. */
export function chartMutationKey(id: string) {
  return [...resourceQueryKeys.resource("chart"), "patch", id] as const;
}

/** Apply each queued edit to the last saved revision, regardless of its initiating component. */
export function chartMutation(
  transport: AppTransport,
  queryClient: QueryClient,
  id: string,
) {
  const detail = chartDetail(transport, id);
  return mutationOptions({
    mutationKey: chartMutationKey(id),
    scope: { id: `chart:${id}` },
    mutationFn: async (edit: (resource: ChartResource) => ChartResource) => {
      const resource =
        queryClient.getQueryData(detail.queryKey) ??
        (await queryClient.fetchQuery(detail));
      const next = edit(resource);
      const [first, ...rest] = (["cells", "links", "preset"] as const).flatMap(
        (field) =>
          next[field] === resource[field]
            ? []
            : [
                {
                  op: "replace" as const,
                  path: `/${field}`,
                  value: next[field],
                },
              ],
      );
      if (!first) return resource;
      return transport.rpc.resources.chart.patch.mutate({
        id,
        expectedRevision: resource.revision,
        operations: [first, ...rest],
      });
    },
    onSuccess: (resource) => {
      queryClient.setQueryData(detail.queryKey, resource);
    },
  });
}

/**
 * Run a server macro that changes this chart and its Indicators together, such
 * as adding or removing an Indicator, in the same queue as chart edits. The
 * command receives the last saved chart for its expected revision.
 * @example save.mutate((chart) => transport.rpc.resources.macro.removeIndicator.mutate({chartId, expectedRevision: chart.revision, indicatorId}));
 */
export function chartCommand(
  transport: AppTransport,
  queryClient: QueryClient,
  id: string,
) {
  const detail = chartDetail(transport, id);
  return mutationOptions({
    mutationKey: chartMutationKey(id),
    scope: { id: `chart:${id}` },
    mutationFn: async (
      run: (resource: ChartResource) => Promise<{ chart: ChartResource }>,
    ) =>
      (
        await run(
          queryClient.getQueryData(detail.queryKey) ??
            (await queryClient.fetchQuery(detail)),
        )
      ).chart,
    onSuccess: (resource) => {
      queryClient.setQueryData(detail.queryKey, resource);
      void queryClient.invalidateQueries({
        queryKey: indicatorList(transport, id).queryKey,
      });
    },
  });
}

/** A new selected market: main price with volume overlaid in the same pane, each an independently addressable renderer object. @example const cell = createCell(selectedListing); */
export function createCell(
  selected: ProviderListing,
  options: Pick<BarsSeries, "resolution" | "session" | "adjustment">,
): CellDefinition {
  const sourceId = chartIds.source.create();
  return {
    id: chartIds.cell.create(),
    resolution: options.resolution,
    session: options.session,
    adjustment: options.adjustment,
    marketSources: [
      { id: sourceId, provider: selected.provider, listing: selected.listing },
    ],
    panes: [
      {
        id: chartIds.pane.create(),
        series: [
          {
            id: chartIds.series.create(),
            role: "main",
            source: {
              kind: "market",
              marketSourceId: sourceId,
              output: "price",
            },
          },
          {
            id: chartIds.series.create(),
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
  };
}

/** Keep the preferred combination when supported, otherwise use the source's default at that resolution. @example const options = chooseBarsOptions(capabilities, cell); */
export function chooseBarsOptions(
  capabilities: BarsCapabilities,
  preferred?: Pick<BarsSeries, "resolution"> &
    Partial<Pick<BarsSeries, "session" | "adjustment">>,
) {
  const choice =
    capabilities.find(
      (value) =>
        value.resolution === preferred?.resolution &&
        value.session === preferred.session &&
        value.adjustment === preferred.adjustment,
    ) ??
    capabilities.find((value) => value.resolution === preferred?.resolution) ??
    capabilities.find((value) => value.resolution === "1d") ??
    capabilities[0];
  if (!choice)
    throw new Error("This source does not currently provide chart data.");
  return {
    resolution: choice.resolution,
    session: choice.session,
    adjustment: choice.adjustment,
  };
}
