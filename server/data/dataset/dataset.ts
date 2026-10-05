// Purpose: Admit calls to ready Datasets; each accepted operation owns its resources.

import { Effect, Exit, Scope, Stream } from "effect";
import {
  DatasetError,
  DatasetReasons,
  type DatasetDefinition,
  type DatasetFailure,
  type DatasetInput,
  type DatasetOutput,
  type Mode,
} from "@openchart/server/data/dataset";

const ready: unique symbol = Symbol("Dataset.ready");

/**
 * Methods derive directly from the declaration's operation schemas. Providers
 * fail with a {@link DatasetFailure}; ready handles fail with a located
 * {@link DatasetError}.
 * @example const methods: ProviderFor<typeof bars> = { select: query => fetchBars(query), stream: query => openBars(query) };
 */
export type ProviderFor<
  D extends DatasetDefinition,
  R = never,
  E = DatasetFailure,
> = {
  [M in keyof D["access"]]: (
    query: DatasetInput<D, Extract<M, Mode>>,
  ) => M extends "stream"
    ? Effect.Effect<
        Stream.Stream<DatasetOutput<D, "stream">, E>,
        E,
        Scope.Scope | R
      >
    : Effect.Effect<DatasetOutput<D, Extract<M, Mode>>, E, R>;
};

/** An access handle fixed to one Provider activation, with only declared methods. */
export type Dataset<D extends DatasetDefinition = DatasetDefinition> = {
  readonly definition: D;
  readonly [ready]: true;
} & (DatasetDefinition extends D
  ? object
  : ProviderFor<D, never, DatasetError>);

/**
 * Wraps Provider implementations as a ready Dataset:
 * - Dies when methods do not match the definition (a wiring defect).
 * - Locates Provider failures as DatasetError with this Dataset and operation.
 * - Rejects new calls with `Dataset.Retired` after the Provider scope closes.
 * - Gives each finite call its own scope. Each stream has a child of the caller's
 *   scope, acquired before consumption and closed on acquisition failure or stream exit.
 *   A closed subscription cannot be consumed again.
 *
 * In-flight finite calls can finish after Provider retirement.
 * @example const dataset = yield* makeDataset(definition, {select: query => fetchRows(query)});
 */
export const makeDataset = Effect.fn("makeDataset")(function* <
  D extends DatasetDefinition,
>(
  definition: D,
  methods: ProviderFor<D, Scope.Scope>,
): Effect.fn.Return<Dataset<D>, never, Scope.Scope> {
  const owner = yield* Effect.scope;
  const active = () => owner.state._tag !== "Closed";
  const supplied = methods as Record<string, unknown>;
  const dataset: Record<PropertyKey, unknown> = { definition, [ready]: true };
  for (const mode of ["select", "search", "stream"] as const) {
    const declared = definition.access[mode] !== undefined;
    if (
      declared
        ? typeof supplied[mode] !== "function"
        : supplied[mode] !== undefined
    ) {
      return yield* Effect.die(
        new Error(
          `${definition.name}: ${mode} implementation must match its declaration`,
        ),
      );
    }
    if (!declared) continue;
    // The declaration/method check is the single erased runtime dispatch boundary.
    const method = supplied[mode] as (
      query: unknown,
    ) => Effect.Effect<unknown, DatasetFailure, Scope.Scope>;
    const locate = (failure: DatasetFailure) =>
      new DatasetError({
        dataset: definition.name,
        operation: mode,
        reason: failure.reason,
        cause: failure.cause,
      });
    const retired = new DatasetError({
      dataset: definition.name,
      operation: mode,
      reason: new DatasetReasons.Retired(),
    });
    // @agent invariant: retirement closes admission, never races accepted work.
    const guard = <A, R>(effect: Effect.Effect<A, DatasetError, R>) =>
      Effect.suspend(() => (active() ? effect : Effect.fail(retired)));
    if (mode === "stream") {
      dataset[mode] = (query: unknown) =>
        guard(
          Effect.gen(function* () {
            const request = yield* Effect.scope;
            if (request.state._tag === "Closed")
              return yield* Effect.fail(retired);
            const subscription = yield* Scope.fork(request);
            const value = (yield* method(query).pipe(
              Scope.provide(subscription),
              Effect.onError((cause) =>
                Scope.close(subscription, Exit.failCause(cause)),
              ),
              Effect.mapError(locate),
            )) as Stream.Stream<unknown, DatasetFailure>;
            return Stream.suspend(() =>
              subscription.state._tag === "Closed"
                ? Stream.fail(retired)
                : value.pipe(Stream.mapError(locate)),
            ).pipe(Stream.onExit((exit) => Scope.close(subscription, exit)));
          }),
        );
      continue;
    }
    dataset[mode] = (query: unknown) =>
      guard(
        Effect.scoped(Effect.suspend(() => method(query))).pipe(
          Effect.mapError(locate),
        ),
      );
  }
  return dataset as Dataset<D>;
});
