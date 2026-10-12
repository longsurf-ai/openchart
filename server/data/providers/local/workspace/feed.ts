// Purpose: Bind this Provider's runtime Datasets to the Feed series business by declaration identity.
import { Effect } from "effect";
import { ProviderId } from "@openchart/market";
import type { DatasetError } from "@openchart/server/data/dataset";
import type { ProviderFeeds } from "@openchart/server/feed/adapter";
import { datasetFailure } from "@openchart/server/feed/errors";
import type { DataFrame } from "@openchart/timeseries";
import { workspaceDatasetIdOf, type SelectQuery } from "./datasets";

/** The provider id Feed failures name for Workspace Datasets. */
export const workspaceProviderId = ProviderId.make("workspace");

/** A ready Workspace Dataset, typed by its declaration's single select mode. */
type ReadySeries = {
  readonly select: (
    query: SelectQuery,
  ) => Effect.Effect<DataFrame, DatasetError>;
};

/** Series ids are Workspace Dataset Resource ids. */
export const feeds: ProviderFeeds = {
  series: {
    adapt: (dataset) => {
      const id = workspaceDatasetIdOf(dataset.definition);
      if (id === undefined) return undefined;
      // @agent invariant: only declareWorkspaceDataset records ids, and it declares select only.
      const ready = dataset as unknown as ReadySeries;
      return {
        id,
        select: (time) =>
          ready
            .select({ time })
            .pipe(Effect.mapError(datasetFailure(workspaceProviderId))),
      };
    },
  },
};
