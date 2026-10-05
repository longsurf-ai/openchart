// Purpose: Provision concurrent native-identity searches with one global sort and limit.
import { Effect } from "effect";
import type { Dataset } from "@openchart/server/data";
import { providerFeeds } from "@openchart/server/data/providers";
import { adaptDataset } from "@openchart/server/feed/adapter";
import type { ISymbologyFeedService } from "./service";
import { SymbologyIndex } from "./symbology";
const adapters = providerFeeds.map((feeds) => feeds.symbology);

/** Search concurrently; deterministic lexical order and one global limit, with no identity merge.
 * Construction acquires no resources; Dataset access remains Provider-owned.
 * Two Datasets for one provider are a wiring defect.
 * @example const service = yield* provisionSymbology(datasets);
 */
export function provisionSymbology(
  datasets: readonly Dataset[],
): Effect.Effect<ISymbologyFeedService, never, SymbologyIndex> {
  return Effect.gen(function* () {
    const index = yield* SymbologyIndex;
    return yield* Effect.sync(() => {
      const providers = new Set<string>();
      const sources = datasets.flatMap((dataset) => {
        const source = adaptDataset(adapters, dataset);
        if (!source) return [];
        if (providers.has(source.providerId))
          throw new Error(
            `More than one Symbology Dataset routes provider ${source.providerId}.`,
          );
        providers.add(source.providerId);
        return [source];
      });
      return index.provision(sources);
    });
  });
}
