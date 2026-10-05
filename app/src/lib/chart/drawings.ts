// Purpose: Persist drawing edits through Resource RPCs and the shared Query cache.
import type { Drawing } from "@openchart/chart-core/drawing/types";
import type { ProviderListing } from "@openchart/market";
import {
  mutationOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";

import { resourceQueryKeys } from "@openchart/app/lib/resource/invalidation";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** Drawing ownership stays fixed for the lifetime of a mounted projection. */
export type DrawingScope = ProviderListing & { dashboardId: string };
/** A completed local edit; absence of data means removal. */
export type DrawingEdit = {
  id: string;
  data?: Drawing.Item;
  /** Update-only views retain their Resource identity through queuing and Retry. */
  existingResourceId?: string;
};
/** The wire contract comes from the existing Resource router. */
export type DrawingResource = Awaited<
  ReturnType<AppTransport["rpc"]["resources"]["drawing"]["get"]["query"]>
>;

/** Listing reference metadata is not part of its provider-scoped identity. @example drawingScopeKey(scope); */
export function drawingScopeKey(scope: DrawingScope) {
  return JSON.stringify([
    scope.dashboardId,
    scope.provider,
    scope.listing.symbol,
    scope.listing.venue ?? null,
    scope.listing.currency,
  ]);
}

/** Read every page of drawings for a dashboard and provider. @example useQuery(drawingList(transport, scope)); */
export function drawingList(transport: AppTransport, scope: DrawingScope) {
  return queryOptions({
    queryKey: [
      ...resourceQueryKeys.resource("drawing"),
      "list",
      transport.url,
      scope.dashboardId,
      scope.provider,
    ],
    queryFn: async ({ signal }) => {
      const items: DrawingResource[] = [];
      let cursor: string | undefined;
      do {
        const page = await transport.rpc.resources.drawing.list.query(
          {
            filter: {
              dashboardId: scope.dashboardId,
              provider: scope.provider,
            },
            limit: 100,
            cursor,
          },
          { signal },
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return items;
    },
  });
}

/** Serialize edits to the same listing, using each last saved revision. @example useMutation(drawingMutation(transport, client, scope)); */
export function drawingMutation(
  transport: AppTransport,
  client: QueryClient,
  scope: DrawingScope,
) {
  const list = drawingList(transport, scope);
  const key = drawingScopeKey(scope);
  const mutationKey = [
    ...resourceQueryKeys.resource("drawing"),
    "edit",
    transport.url,
    key,
  ];
  return mutationOptions({
    mutationKey,
    scope: { id: `drawing:${transport.url}:${key}` },
    // Keep failed geometry available for Retry while the app remains open.
    gcTime: Infinity,
    retry: false,
    mutationFn: async (edit: DrawingEdit) => {
      await client.cancelQueries({ queryKey: list.queryKey });
      await client.ensureQueryData(list);
      const current = client
        .getQueryData(list.queryKey)
        ?.find(
          (row) => row.data.id === edit.id && drawingScopeKey(row) === key,
        );
      if (
        edit.existingResourceId &&
        (!current ||
          current.id !== edit.existingResourceId ||
          !edit.data ||
          edit.data.id !== current.data.id ||
          edit.data.type !== current.data.type)
      ) {
        throw new Error("This view can only update the linked drawing.");
      }
      // The focused view shows hidden drawings locally; preserve saved visibility,
      // including changes made in another chart while this edit was queued.
      const data =
        edit.data && edit.existingResourceId && current
          ? { ...edit.data, hidden: current.data.hidden }
          : edit.data;
      if (!data) {
        if (!current) return;
        await transport.rpc.resources.drawing.delete.mutate({ id: current.id });
        client.setQueryData(list.queryKey, (rows) =>
          rows?.filter((row) => row.id !== current.id),
        );
      } else {
        if (current && JSON.stringify(current.data) === JSON.stringify(data))
          return current;
        const saved = current
          ? await transport.rpc.resources.drawing.patch.mutate({
              id: current.id,
              expectedRevision: current.revision,
              operations: [{ op: "replace", path: "/data", value: data }],
            })
          : await transport.rpc.resources.drawing.create.mutate({
              ...scope,
              data,
            });
        client.setQueryData(list.queryKey, (rows = []) => [
          ...rows.filter((row) => row.id !== saved.id),
          saved,
        ]);
        return saved;
      }
    },
    onSuccess: (_result, edit) => {
      for (const previous of client
        .getMutationCache()
        .findAll({ mutationKey })) {
        if (
          previous.state.status === "success" ||
          (previous.state.status === "error" &&
            (previous.state.variables as DrawingEdit).id === edit.id)
        )
          client.getMutationCache().remove(previous);
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: list.queryKey }),
  });
}
