// Purpose: Adapt OpenChart native listings to the consumer search contract.
import { Effect } from "effect";
import type { ProviderId } from "@openchart/market";
import type { Dataset } from "@openchart/server/data/dataset";
import { datasetFailure } from "@openchart/server/feed/errors";
import type { SymbologySource } from "@openchart/server/feed/symbology/service";
import { openchartSymbology } from "@openchart/server/data/providers/openchart/datasets/definitions/symbology";
/** Preserve numeric listing identities; OpenChart search cannot enumerate a full index.
 * @example const symbols = openchartSymbologyFeed(dataset, providerId);
 */
export function openchartSymbologyFeed(
  dataset: Dataset<typeof openchartSymbology>,
  providerId: ProviderId,
): SymbologySource {
  return {
    providerId,
    search: (request) =>
      dataset.search({ query: request.query }).pipe(
        Effect.mapError(datasetFailure(providerId)),
        Effect.map((rows) =>
          rows.map((listing) => ({ provider: providerId, listing })),
        ),
      ),
  };
}
