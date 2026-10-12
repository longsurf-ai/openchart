// Purpose: Catalog subscribes Providers and owns the current collection of ready Datasets.
import {
  Context,
  Deferred,
  Effect,
  Layer,
  Stream,
  SubscriptionRef,
  type Scope,
} from "effect";
import { listDefinitions } from "@openchart/server/data/dataset";
import type { Dataset } from "@openchart/server/data/dataset/index";
import type { IDatasetProvider } from "./provider";

/** Runtime registry of ready Datasets; declarations remain separately discoverable. */
export class Catalog extends Context.Service<
  Catalog,
  {
    /** Read current callable instances; dies after an invalid contribution. @example yield* catalog.list(); */
    list(): Effect.Effect<readonly Dataset[]>;
    /** Observe complete snapshots, including the initial state. @example catalog.watch(); */
    watch(): Stream.Stream<readonly Dataset[]>;
  }
>()("@openchart/server/data/Catalog") {}

/** Subscribe once per Provider in the Catalog scope; Providers retain ownership of their instances.
 * @example catalogLayer(Effect.all([BinanceProvider, YFinanceProvider]));
 */
export function catalogLayer<E, R>(
  providers: Effect.Effect<readonly IDatasetProvider[], E, R>,
): Layer.Layer<Catalog, E, Exclude<R, Scope.Scope>> {
  return Layer.effect(
    Catalog,
    Effect.gen(function* () {
      const pviders = yield* providers;
      const current = yield* SubscriptionRef.make<readonly Dataset[]>([]);
      const failed = yield* Deferred.make<never>();
      const contributions: (readonly Dataset[])[] = pviders.map(() => []);
      const replace = (index: number, datasets: readonly Dataset[]) =>
        SubscriptionRef.update(current, (previous) => {
          const host = pviders[index]!;
          const next = contributions.flatMap((old, i) =>
            i === index ? [...datasets] : [...old],
          );
          const names = new Set<string>();
          for (const dataset of datasets) {
            if (
              !host.definitions.includes(dataset.definition) ||
              !listDefinitions().includes(dataset.definition)
            )
              throw new Error(
                `Provider published undeclared Dataset ${dataset.definition.name}`,
              );
          }
          for (const dataset of next) {
            if (names.has(dataset.definition.name))
              throw new Error(`Duplicate Dataset ${dataset.definition.name}`);
            names.add(dataset.definition.name);
          }
          contributions[index] = [...datasets];
          return next.length === previous.length &&
            next.every((dataset) => previous.includes(dataset))
            ? previous
            : Object.freeze(next);
        });
      yield* Effect.forEach(pviders, (provider, index) =>
        provider.watch().pipe(
          Stream.concat(
            Stream.fromEffect(
              Effect.logError(
                "Provider watch ended; withdrawing datasets",
              ).pipe(Effect.as<readonly Dataset[]>([])),
            ),
          ),
          Stream.catchCause((cause) =>
            Stream.fromEffect(
              Effect.logError(
                "Provider watch failed; withdrawing datasets",
                cause,
              ).pipe(Effect.as<readonly Dataset[]>([])),
            ),
          ),
          Stream.runForEach((datasets) => replace(index, datasets)),
          Effect.catchCause((cause) =>
            Effect.logError("Invalid Catalog contribution", cause).pipe(
              Effect.andThen(Deferred.failCause(failed, cause)),
            ),
          ),
          Effect.forkScoped,
        ),
      );
      return Catalog.of({
        list: () =>
          Effect.suspend(() =>
            Deferred.isDoneUnsafe(failed)
              ? Deferred.await(failed)
              : SubscriptionRef.get(current),
          ),
        watch: () =>
          SubscriptionRef.changes(current).pipe(
            Stream.changesWith((a, b) => a === b),
            Stream.interruptWhen(Deferred.await(failed)),
          ),
      });
    }),
  );
}
