// Purpose: Provision Bars by native provider identity and enforce continuous session delivery.
import { Effect } from "effect";
import type { ProviderId } from "@openchart/market";
import type { Dataset } from "@openchart/server/data";
import { providerFeeds } from "@openchart/server/data/providers";
import { adaptDataset } from "@openchart/server/feed/adapter";
import { unavailable } from "@openchart/server/feed/errors";
import type { IBarsFeedService } from "./service";
const adapters = providerFeeds.map((feeds) => feeds.bars);

/** Build provider routing; no request is silently retried against another identity.
 * Construction acquires no resources; Bars sessions belong to their caller's Scope.
 * Duplicate routes and live sources without updates are wiring defects.
 * @example const service = yield* provisionBars(datasets);
 */
export function provisionBars(
  datasets: readonly Dataset[],
): Effect.Effect<IBarsFeedService> {
  return Effect.sync(() => {
    const routes = new Map<ProviderId, IBarsFeedService>();
    for (const dataset of datasets) {
      const source = adaptDataset(adapters, dataset);
      if (!source) continue;
      if (routes.has(source.provider))
        throw new Error(
          `More than one Bars Dataset routes provider ${source.provider}.`,
        );
      routes.set(source.provider, source.feed);
    }
    return {
      getCapabilities: (request) =>
        routes.get(request.provider)?.getCapabilities(request) ??
        Effect.succeed([]),
      observe: (request) => {
        const feed = routes.get(request.provider);
        if (!feed) return Effect.fail(unavailable(request.provider));
        return feed.observe(request).pipe(
          Effect.flatMap((session) => {
            if (request.to === "now" && !session.updates)
              return Effect.die(
                new Error("Bars source declared live but returned no updates."),
              );
            return Effect.succeed(session);
          }),
        );
      },
    } satisfies IBarsFeedService;
  });
}
