// Purpose: Read and mutate persisted Dashboards through the shared Resource transport.
import {
  infiniteQueryOptions,
  mutationOptions,
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { resourceQueryKeys } from "@openchart/app/lib/resource/invalidation";
import { missingResourceAsNull } from "@openchart/app/lib/resource/missing";
import type {
  AppTransport,
  ResourceInputs,
} from "@openchart/app/lib/transport/transport";

import {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/lib/resource/dashboard";
export {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/lib/resource/dashboard";

/** Read fifteen Dashboards at a time; Query owns pages and cancellation. @example useInfiniteQuery(dashboardsQueryOptions(transport)); */
export function dashboardsQueryOptions(
  transport: AppTransport,
  orderBy?: Exclude<ResourceInputs["dashboard"]["list"], void>["orderBy"],
) {
  return infiniteQueryOptions({
    meta: { errorTitle: "Couldn’t load dashboards" },
    queryKey: [
      ["resources", "dashboard", "list"],
      transport.url,
      orderBy,
    ] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      transport.rpc.resources.dashboard.list.query(
        {
          limit: 15,
          cursor: pageParam,
          ...(orderBy ? { orderBy, order: "desc" as const } : {}),
        },
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}

/** Create a Dashboard with the backend's default Chart, cache its placements and refresh the directory. @example const create = useCreateDashboard(transport); await create.mutateAsync(); */
export function useCreateDashboard(transport: AppTransport) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn’t create a dashboard" },
    mutationFn: () =>
      transport.rpc.resources.macro.createDashboardWithChart
        .mutate()
        .then((result) => result.dashboard),
    retry: false,
    onSuccess: (dashboard) => {
      queryClient.setQueryData(
        dashboardQueryOptions(transport, dashboard.id).queryKey,
        dashboard,
      );
      const queryKey = [["resources", "dashboard", "list"], transport.url];
      void queryClient
        .cancelQueries({ queryKey })
        .then(() => queryClient.invalidateQueries({ queryKey }));
    },
  });
}

/** Rename at the displayed revision; refresh Query after success or failure so updates and conflict retries work without SSE. @example const rename = useRenameDashboard(transport); rename.mutate({ dashboard, name }); */
export function useRenameDashboard(transport: AppTransport) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn’t rename this dashboard" },
    mutationFn: ({ dashboard, name }: { dashboard: Dashboard; name: string }) =>
      transport.rpc.resources.dashboard.patch.mutate({
        id: dashboard.id,
        expectedRevision: dashboard.revision,
        operations: [{ op: "replace", path: "/name", value: name }],
      }),
    retry: false,
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: resourceQueryKeys.resource("dashboard"),
      }),
  });
}

/** Delete a confirmed Dashboard; already absent is success. onSuccess cancels stale detail reads, caches null and refreshes the directory without waiting. Other failures preserve cached data. Compose onSettled in the confirming dialog for closing and caller navigation. @example useMutation({ ...deleteDashboardMutationOptions(transport, client), onSettled }); */
export function deleteDashboardMutationOptions(
  transport: AppTransport,
  queryClient: QueryClient,
) {
  return mutationOptions({
    meta: { errorTitle: "Couldn’t delete this dashboard" },
    mutationFn: (id: string) =>
      transport.rpc.resources.dashboard.delete
        .mutate({ id })
        .catch(missingResourceAsNull),
    retry: false,
    onSuccess: async (_result, id) => {
      const detailKey = dashboardQueryOptions(transport, id).queryKey;
      await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
      queryClient.setQueryData(detailKey, null);
      const queryKey = [["resources", "dashboard", "list"], transport.url];
      void queryClient
        .cancelQueries({ queryKey })
        .then(() => queryClient.invalidateQueries({ queryKey }));
    },
  });
}

/** Commit placements or a new Chart against the captured Dashboard revision; both share pending/recovery state. @example useMutation(dashboardMutationOptions(transport, client, id)); */
export function dashboardMutationOptions(
  transport: AppTransport,
  queryClient: QueryClient,
  id: string,
) {
  return mutationOptions({
    meta: { errorTitle: "Dashboard changes haven’t been saved" },
    mutationKey: [
      ["resources", "dashboard", "patch"],
      transport.url,
      id,
    ] as const,
    retry: false,
    mutationFn: (
      input:
        | {
            expectedRevision: number;
            widgets: Dashboard["widgets"];
          }
        | Omit<CreateChartWidgetInput, "dashboardId">,
    ) =>
      "layout" in input
        ? transport.rpc.resources.macro.createChartWidget
            .mutate({ dashboardId: id, ...input })
            .then((result) => result.dashboard)
        : transport.rpc.resources.dashboard.patch.mutate({
            id,
            expectedRevision: input.expectedRevision,
            operations: [
              { op: "replace", path: "/widgets", value: input.widgets },
            ],
          }),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: resourceQueryKeys.resource("dashboard"),
      });
    },
  });
}

/** Input for the atomic Chart-plus-placement command. */
export type CreateChartWidgetInput = Parameters<
  AppTransport["rpc"]["resources"]["macro"]["createChartWidget"]["mutate"]
>[0];
