// Purpose: Read one Workspace Dataset through Feed, refreshing when its file or availability changes.
import type { ClientFailure, FeedError } from "@openchart/feed";
import type { DataFrame } from "@openchart/timeseries";
import { useQuery } from "@tanstack/react-query";

import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { useDatafeed, useFeedVersion } from "./use-datafeed";

/** The identity and file of a Workspace Dataset Resource. */
export interface DatasetFile {
  readonly id: string;
  readonly source: { readonly workspaceId: string; readonly path: string };
}

/**
 * Reads every declared column of a Workspace Dataset as one DataFrame.
 * The key starts with the Workspace file key, so the app's Workspace
 * observation re-reads it whenever a collection rewrites the file; the Feed
 * version re-reads it when the Dataset is re-declared. Undefined makes no request.
 * @example const { data: frame } = useDataset(transport, dataset);
 */
export function useDataset(
  transport: AppTransport,
  dataset: DatasetFile | undefined,
) {
  const client = useDatafeed();
  const version = useFeedVersion();
  return useQuery<DataFrame, FeedError | ClientFailure>({
    queryKey: [
      ["workspace"],
      transport.url,
      dataset?.source.workspaceId,
      "file",
      dataset?.source.path,
      "series",
      version,
      dataset?.id,
    ],
    queryFn: async ({ signal }) =>
      (await client.series.select({ id: dataset!.id }, { signal })).data,
    enabled: version !== undefined && dataset !== undefined,
    staleTime: Infinity,
  });
}
