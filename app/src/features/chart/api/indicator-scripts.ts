// Purpose: Resolve editable indicators without chart mutations.
import type * as Tea from "@openchart/tea";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { queryOptions } from "@tanstack/react-query";

export type IndicatorSelection = string | Tea.WorkspaceSources;

/** Discovery content is inferred from the existing catalog RPC. */
export type IndicatorCatalogEntry = Awaited<
  ReturnType<AppTransport["rpc"]["indicators"]["list"]["query"]>
>[number];

/** Read bundled study content without compiling its scripts. @example useQuery(indicatorCatalogQueryOptions(transport)); */
export function indicatorCatalogQueryOptions(transport: AppTransport) {
  return queryOptions({
    queryKey: ["indicators", transport.url],
    queryFn: ({ signal }) =>
      transport.rpc.indicators.list.query(undefined, { signal }),
    meta: { errorTitle: "Couldn’t load studies" },
  });
}

/** Resolve a template through create-only installation, or keep an existing file's identity. @example await resolveIndicator(transport, "sma"); */
export async function resolveIndicator(
  transport: AppTransport,
  selection: IndicatorSelection,
) {
  return typeof selection === "string"
    ? transport.rpc.indicators.install.mutate({ id: selection })
    : { workspaceId: selection.workspaceId, path: selection.path };
}
