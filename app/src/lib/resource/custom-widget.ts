// Purpose: Read saved custom widgets and their runnable code.
import { queryOptions } from "@tanstack/react-query";

import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { resourceQueryKeys } from "./invalidation";

const keys = resourceQueryKeys.resource("custom_widget");

/** The first page of saved widgets, for the Widgets menu. @example useQuery(customWidgetList(transport)); */
export function customWidgetList(transport: AppTransport) {
  return queryOptions({
    queryKey: [...keys, "list", transport.url],
    meta: { errorTitle: "Couldn’t load custom widgets" },
    queryFn: async ({ signal }) =>
      (await transport.rpc.resources.custom_widget.list.query({}, { signal }))
        .items,
  });
}

/** The saved widget with this kind as CommonJS, with its id and revision, or null when no widget has the kind. Saves and deletions refetch it. @example useQuery(customWidgetCode(transport, "rates")); */
export function customWidgetCode(transport: AppTransport, kind: string) {
  return queryOptions({
    queryKey: [...keys, "compiled", transport.url, kind],
    meta: { errorTitle: "Couldn’t load this widget" },
    queryFn: ({ signal }) =>
      transport.rpc.resources.custom_widget.compiled.query(
        { kind },
        { signal },
      ),
  });
}
