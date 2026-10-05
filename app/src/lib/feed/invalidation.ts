// Purpose: Refresh local-first symbol queries after catalog commits without changing Feed availability.
import type { QueryClient } from "@tanstack/react-query";
import { auditTime, filter } from "rxjs";
import { ResourceChanged } from "@openchart/app/lib/resource/invalidation";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** Coalesce catalog bursts and reconnect recovery; live requests never invalidate themselves. @example subscribeSymbologyInvalidation(transport, queryClient); */
export function subscribeSymbologyInvalidation(
  transport: Pick<AppTransport, "events">,
  queryClient: QueryClient,
  onError: (error: unknown) => void = console.error,
) {
  return transport.events
    .pipe(
      filter(
        (frame) =>
          frame.kind === "ready" ||
          (frame.kind === "event" &&
            frame.event.type === "resource.changed" &&
            ResourceChanged.parse(frame.event.data).resource === "symbology"),
      ),
      auditTime(100),
    )
    .subscribe({
      next: () => {
        const filters = {
          predicate: (query: { queryKey: readonly unknown[] }) => {
            if (
              query.queryKey[0] === "symbology" &&
              query.queryKey[1] === "indexStatus"
            )
              return true;
            const [, domain, operation, request] = query.queryKey;
            return (
              domain === "symbology" &&
              operation === "search" &&
              typeof request === "object" &&
              request !== null &&
              "indexed" in request &&
              request.indexed === true
            );
          },
        };
        void queryClient
          .cancelQueries(filters)
          .then(() => queryClient.invalidateQueries(filters))
          .catch(onError);
      },
      error: onError,
    });
}
