// Purpose: Own durable search policy, provider write ordering and backend-lifetime index jobs.
import { randomUUID } from "node:crypto";
import { Context, Effect, Layer, Ref, Semaphore } from "effect";
import {
  FeedReasons,
  compareSymbolListings,
  type SymbolIndexState,
  type SymbolSearchRequest,
  type SymbolSearchResult,
} from "@openchart/feed";
import { Database } from "@openchart/server/db";
import { Transactor } from "@openchart/server/lib/resource";
import {
  symbologyResource,
  upsertListings,
  replaceScope,
} from "@openchart/server/resources/symbology";
import { ProviderId } from "@openchart/market";
import { feedError, unavailable } from "@openchart/server/feed/errors";
import { providerFeeds } from "@openchart/server/data/providers";
import { SymbolIndexUnavailable } from "./errors";
import type { ISymbologyFeedService, SymbologySource } from "./service";

/** Capabilities remain discoverable even when a Provider has no ready Dataset. */
const symbologyProviders = providerFeeds.flatMap(({ symbology }) =>
  symbology
    ? [{ providerId: symbology.providerId, indexable: symbology.indexable }]
    : [],
);

function ordered(
  results: SymbolSearchResult,
  request: SymbolSearchRequest,
): SymbolSearchResult {
  return results
    .filter(
      (hit) =>
        request.assetClass === undefined ||
        hit.listing.class === request.assetClass,
    )
    .sort(compareSymbolListings(request.query))
    .slice(0, request.limit);
}

/** Permanent coordinator; provisioned services retain their captured Dataset generation. */
export class SymbologyIndex extends Context.Service<
  SymbologyIndex,
  {
    readonly provision: (
      sources: readonly SymbologySource[],
    ) => ISymbologyFeedService;
  }
>()("feed/SymbologyIndex") {
  /** Own jobs and locks once per backend; shutdown interrupts jobs before closing SQLite. */
  static readonly layer = Layer.effect(
    SymbologyIndex,
    Effect.gen(function* () {
      const database = yield* Database.Service;
      const scope = yield* Effect.scope;
      const states = yield* Ref.make(new Map<string, SymbolIndexState>());
      const locks = new Map<string, Semaphore.Semaphore>();
      const lock = (provider: string) => {
        let value = locks.get(provider);
        if (!value) {
          value = Semaphore.makeUnsafe(1);
          locks.set(provider, value);
        }
        return value;
      };
      const set = (provider: string, state: SymbolIndexState) =>
        Ref.update(states, (previous) =>
          new Map(previous).set(provider, state),
        );
      const persist = <A, E>(effect: Effect.Effect<A, E, Database.Service>) =>
        effect.pipe(
          Effect.provideService(Database.Service, database),
          Effect.mapError((cause) => new SymbolIndexUnavailable({ cause })),
        );
      return {
        provision: (sources): ISymbologyFeedService => ({
          search: (request) =>
            Effect.gen(function* () {
              if (sources.length === 0)
                return yield* Effect.fail(unavailable());
              if (request.indexed) {
                const rows = yield* persist(
                  Transactor.run(
                    symbologyResource.transitions.search({
                      request,
                      providers: sources.map((source) => source.providerId),
                    }),
                  ),
                );
                if (rows.length)
                  return ordered(
                    rows.map(({ provider, listing }) => ({
                      provider,
                      listing,
                    })),
                    request,
                  );
              }
              const results = yield* Effect.all(
                sources.map((source) =>
                  Effect.gen(function* () {
                    const rows = yield* source.search(request);
                    yield* persist(Transactor.run(upsertListings(rows)));
                    return rows;
                  }).pipe(lock(source.providerId).withPermits(1)),
                ),
                { concurrency: "unbounded" },
              );
              return ordered(results.flat(), request);
            }),
          indexStatus: () =>
            Ref.get(states).pipe(
              Effect.map((jobs) =>
                symbologyProviders.map(({ providerId, indexable }) => ({
                  providerId,
                  indexable,
                  available: sources.some(
                    (source) => source.providerId === providerId,
                  ),
                  job: jobs.get(providerId) ?? { state: "idle" as const },
                })),
              ),
            ),
          index: (request) =>
            Effect.uninterruptible(
              Effect.gen(function* () {
                const source = sources.find(
                  (candidate) => candidate.providerId === request.providerId,
                );
                if (!source)
                  return yield* Effect.fail(
                    unavailable(ProviderId.make(request.providerId)),
                  );
                if (!source.select)
                  return yield* Effect.fail(
                    feedError(
                      new FeedReasons.InvalidRequest({
                        detail: "This provider cannot enumerate its catalog.",
                      }),
                    ),
                  );
                const runId = randomUUID();
                const base = { runId, filter: request.filter };
                const previous = yield* Ref.modify(states, (jobs) => {
                  const active = jobs.get(request.providerId);
                  return active?.state === "running"
                    ? ([active, jobs] as const)
                    : ([
                        undefined,
                        new Map(jobs).set(request.providerId, {
                          state: "running",
                          ...base,
                          phase: "fetching",
                        }),
                      ] as const);
                });
                if (previous) {
                  if (previous.filter.quoteAsset === request.filter.quoteAsset)
                    return { runId: previous.runId };
                  return yield* Effect.fail(
                    feedError(
                      new FeedReasons.InvalidRequest({
                        detail:
                          "This provider is already indexing another scope.",
                      }),
                    ),
                  );
                }
                const select = source.select;
                yield* Effect.gen(function* () {
                  // ponytail: buffer one catalog; add paged enumeration with disk staging if it outgrows memory.
                  const rows = yield* select(request.filter);
                  yield* set(request.providerId, {
                    state: "running",
                    ...base,
                    phase: "saving",
                  });
                  const listingCount = yield* persist(
                    Transactor.run(replaceScope(request, rows)),
                  );
                  yield* set(request.providerId, {
                    state: "succeeded",
                    ...base,
                    listingCount,
                  });
                }).pipe(
                  lock(request.providerId).withPermits(1),
                  Effect.catchTag("FeedError", (error) =>
                    Effect.logWarning("Symbology indexing failed", error).pipe(
                      Effect.andThen(
                        set(request.providerId, {
                          state: "failed",
                          ...base,
                          reason: error.reason,
                        }),
                      ),
                    ),
                  ),
                  // Index storage failures and defects have no public reason.
                  Effect.catchCause((cause) =>
                    Effect.logError("Symbology indexing failed", cause).pipe(
                      Effect.andThen(
                        set(request.providerId, {
                          state: "failed",
                          ...base,
                        }),
                      ),
                    ),
                  ),
                  Effect.interruptible,
                  Effect.forkIn(scope),
                );
                return { runId };
              }),
            ),
        }),
      };
    }),
  );
}
