// Purpose: Read, list, and create Watchlists, and queue JSON Patch edits against the last saved revision.
import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  skipToken,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import { resourceQueryKeys } from "@openchart/app/lib/resource/invalidation";
import { missingResourceAsNull } from "@openchart/app/lib/resource/missing";
import type {
  AppTransport,
  ResourceInputs,
  ResourceOutputs,
} from "@openchart/app/lib/transport/transport";

import { watchlistIds, type Metric } from "../utils/tree";

/** One saved Watchlist as every read returns it. */
export type Watchlist = ResourceOutputs["watchlist"]["get"];

/** One RFC 6902 operation accepted by `watchlist.patch`. */
export type WatchlistOperation =
  ResourceInputs["watchlist"]["patch"]["operations"][number];

/** One placement shares a mutation observer; Query's scope also serializes other placements of the same Resource. */
export type WatchlistSave = UseMutationResult<
  Watchlist,
  Error,
  (watchlist: Watchlist) => readonly WatchlistOperation[]
>;

/** Read the selected Watchlist; undefined waits for selection, null data means deleted. Query owns cancellation and errors. @example useQuery(watchlistDetail(transport, selectedId)); */
export function watchlistDetail(
  transport: AppTransport,
  id: string | undefined,
) {
  return queryOptions({
    queryKey: [...resourceQueryKeys.resource("watchlist"), "get", id],
    meta: { errorTitle: "Couldn’t load this watchlist" },
    queryFn:
      id === undefined
        ? skipToken
        : ({ signal }) =>
            transport.rpc.resources.watchlist.get
              .query({ id }, { signal })
              .catch(missingResourceAsNull),
  });
}

/**
 * Queue edits to one Watchlist. Each edit receives the last saved revision and
 * returns the operations to apply to it, so array indexes always match the
 * revision they are sent with. An edit returning no operations saves nothing.
 * Missing selection rejects without a request. Failures toast once and the
 * next edit starts from refreshed data.
 * @example save.mutate((watchlist) => [{op: "remove", path: "/columns/0"}]);
 */
export function watchlistMutation(
  transport: AppTransport,
  queryClient: QueryClient,
  id: string | undefined,
) {
  const detail = watchlistDetail(transport, id);
  return mutationOptions({
    mutationKey: [...resourceQueryKeys.resource("watchlist"), "patch", id],
    scope: { id: `watchlist:${id}` },
    meta: { errorTitle: "Watchlist changes haven’t been saved" },
    retry: false,
    mutationFn: async (
      edit: (watchlist: Watchlist) => readonly WatchlistOperation[],
    ) => {
      if (!id) throw new Error("Choose a watchlist first.");
      // Reuse saved data, but an invalidated cache must finish refreshing.
      const watchlist = await queryClient.fetchQuery({
        ...detail,
        staleTime: Infinity,
      });
      if (!watchlist) throw new Error("This watchlist no longer exists.");
      const [first, ...rest] = edit(watchlist);
      if (!first) return watchlist;
      return transport.rpc.resources.watchlist.patch.mutate({
        id,
        expectedRevision: watchlist.revision,
        operations: [first, ...rest],
      });
    },
    onSuccess: (watchlist) => {
      queryClient.setQueryData(detail.queryKey, watchlist);
    },
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: detail.queryKey,
        refetchType: "all",
      }),
  });
}

/** Columns a new Watchlist starts with unless it copies another's. */
const STARTER_METRICS: readonly Metric[] = ["price", "change", "changePercent"];

/**
 * Create an empty, independent Watchlist; the caller then places it or
 * switches a placement to it. `metrics` defaults to price, change, and
 * change%. A failure toasts once and creates nothing.
 * @example useMutation({...createWatchlist(transport), onSuccess: (created) => place(created.id)}).mutate({name: "Tech"});
 */
export function createWatchlist(transport: AppTransport) {
  return mutationOptions({
    meta: { errorTitle: "Couldn’t create the watchlist" },
    mutationFn: ({
      name,
      metrics = STARTER_METRICS,
    }: {
      name: string;
      metrics?: readonly Metric[];
    }) =>
      transport.rpc.resources.watchlist.create.mutate({
        name,
        columns: metrics.map((kind) => ({
          id: watchlistIds.column.create(),
          metric: { kind },
        })),
      }),
  });
}

/** Read Watchlists in cursor order, twenty at a time. Query owns pages, cancellation and errors. @example useInfiniteQuery(watchlistList(transport)); */
export function watchlistList(transport: AppTransport) {
  return infiniteQueryOptions({
    queryKey: [...resourceQueryKeys.resource("watchlist"), "list"],
    meta: { errorTitle: "Couldn’t load watchlists" },
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      transport.rpc.resources.watchlist.list.query(
        { limit: 20, cursor: pageParam },
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}

/** Delete a Watchlist, treating an already missing list as success. Cancel stale detail reads, cache null, and refresh the directory; failures retain the current list and Query reports them. @example useMutation(deleteWatchlist(transport, client)).mutate(id); */
export function deleteWatchlist(transport: AppTransport, client: QueryClient) {
  return mutationOptions({
    meta: { errorTitle: "Couldn’t delete the watchlist" },
    mutationFn: (id: string) =>
      transport.rpc.resources.watchlist.delete
        .mutate({ id })
        .catch(missingResourceAsNull),
    onSuccess: async (_result, id) => {
      const queryKey = watchlistDetail(transport, id).queryKey;
      await client.cancelQueries({ queryKey, exact: true });
      client.setQueryData(queryKey, null);
      void client.invalidateQueries({
        queryKey: watchlistList(transport).queryKey,
      });
    },
  });
}
