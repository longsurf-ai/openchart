// Purpose: Bind provider-owned implementations to exact Dataset declarations.
import type {
  DatasetDefinition,
  Dataset,
} from "@openchart/server/data/dataset";
import type { ProviderId } from "@openchart/market";
import type { IBarsFeedService } from "@openchart/server/feed/bar/service";
import type { SymbologySource } from "@openchart/server/feed/symbology/service";
import type { ILogosFeedService } from "@openchart/server/feed/logo/service";
import type { ICalendarFeedService } from "@openchart/server/feed/calendar/service";

/** A pure adapter; only its exact Dataset declaration establishes compatibility. */
export interface DatasetAdapter<A> {
  readonly definition: DatasetDefinition;
  readonly adapt: (dataset: Dataset) => A | undefined;
}

/** Bind typed adaptation without acquiring resources or guessing from fields.
 * @example const adapter = datasetAdapter(barsDefinition, makeBarsFeed);
 */
export function datasetAdapter<D extends DatasetDefinition, A>(
  definition: D,
  adapt: (dataset: Dataset<D>) => A,
): DatasetAdapter<A> {
  return {
    definition,
    // @agent invariant: exact Definition identity justifies the erased cast.
    adapt: (dataset) =>
      dataset.definition === definition
        ? adapt(dataset as Dataset<D>)
        : undefined,
  };
}

/** Adapt through the first binding for this exact declaration; unbound Datasets return undefined.
 * @example const source = adaptDataset(providerFeeds.map((feeds) => feeds.bars), dataset);
 */
export function adaptDataset<A>(
  adapters: readonly (DatasetAdapter<A> | undefined)[],
  dataset: Dataset,
): A | undefined {
  for (const adapter of adapters) {
    const adapted = adapter?.adapt(dataset);
    if (adapted !== undefined) return adapted;
  }
  return undefined;
}

/** Provider contributions; metadata remains discoverable without ready instances. */
export interface ProviderFeeds {
  readonly bars?: DatasetAdapter<{
    readonly provider: ProviderId;
    readonly feed: IBarsFeedService;
  }>;
  readonly symbology?: DatasetAdapter<SymbologySource> & {
    readonly providerId: ProviderId;
    readonly indexable: boolean;
  };
  readonly logos?: DatasetAdapter<ILogosFeedService>;
  readonly calendar?: DatasetAdapter<{
    readonly provider: ProviderId;
    readonly feed: ICalendarFeedService;
  }>;
}
