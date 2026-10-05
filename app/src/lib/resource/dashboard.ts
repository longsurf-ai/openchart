// Purpose: Share Dashboard identity reads across app composition and widget adapters.
import { queryOptions } from "@tanstack/react-query";

import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** Persisted Dashboard shape inferred from the public RPC contract. */
export type Dashboard = Awaited<
  ReturnType<AppTransport["rpc"]["resources"]["dashboard"]["get"]["query"]>
>;

/** Read a Dashboard by identity; widgets independently select their placement. @example useQuery(dashboardQueryOptions(transport, id)); */
export function dashboardQueryOptions(transport: AppTransport, id: string) {
  return queryOptions({
    queryKey: [["resources", "dashboard", "get"], transport.url, id] as const,
    queryFn: ({ signal }) =>
      transport.rpc.resources.dashboard.get.query({ id }, { signal }),
  });
}
