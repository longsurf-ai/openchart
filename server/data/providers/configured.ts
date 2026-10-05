// Purpose: Public Providers own enabled-config observation and scoped Dataset replacement.
import {
  Config,
  ConfigProvider,
  Deferred,
  Effect,
  Schedule,
  Schema,
  Stream,
  type Scope,
} from "effect";
import { ConfigProviderUpdates } from "@openchart/server/config/provider";
import type { Dataset } from "@openchart/server/data/dataset/dataset";
import type { DatasetFailure } from "@openchart/server/data/dataset";
import type { ProviderAccess } from "@openchart/server/data/provider";

/** Every Provider's public setting, shared by activation and the Settings API; enabled by default. */
export const ProviderSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true)),
  ),
}).pipe(Schema.withDecodingDefaultKey(Effect.succeed({})));

/** Read `providers.<id>.enabled`; only missing values default, malformed fields or namespaces fail.
 * @example const config = providerEnabled("binance");
 */
export function providerEnabled(id: string): Config.Config<boolean> {
  return Config.schema(
    Schema.Struct({
      providers: Schema.Struct({ [id]: ProviderSettings }).pipe(
        Schema.withDecodingDefaultKey(Effect.succeed({})),
      ),
    }),
  ).pipe(
    // @agent invariant: the decoding default always fills the `id` key.
    Config.map((settings) => settings.providers[id]!.enabled),
  );
}

/**
 * Turns a Provider's enabled setting into a stream of ready Dataset sets:
 * - Acquires datasets only when enabled and access is granted.
 * - Access requirements and `Dataset.AccessDenied` wait for a refresh; other
 *   failures are logged and retried. A defect (wiring error) is not retried
 *   and ends the watch.
 * - Publishes [] while disabled, misconfigured, or waiting for acquisition.
 * - On disable or unsubscribe, cancels acquisition, closes its scope,
 *   and signals retirement.
 * @example const watch = yield* configuredDatasets(config, retired => acquire(retired), checkAccess);
 */
export const configuredDatasets = Effect.fn("configuredDatasets")(function* (
  config: Config.Config<boolean>,
  acquire: (
    retired: Deferred.Deferred<void>,
  ) => Effect.Effect<readonly Dataset[], DatasetFailure, Scope.Scope>,
  checkAccess: () => Effect.Effect<ProviderAccess, DatasetFailure>,
) {
  const dataProvider = yield* ConfigProvider.ConfigProvider;
  const updates = (yield* ConfigProviderUpdates)(dataProvider);
  return Stream.concat(
    Stream.concat(Stream.succeed(dataProvider), updates),
    Stream.never,
  ).pipe(
    Stream.mapEffect((source) =>
      config
        .parse(source)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError(
              "Provider config unavailable; withdrawing datasets",
              cause,
            ).pipe(Effect.as(false)),
          ),
        ),
    ),
    Stream.changes,
    Stream.switchMap((enabled) =>
      enabled
        ? Stream.concat(
            Stream.succeed<readonly Dataset[]>([]),
            Stream.unwrap(
              Effect.gen(function* () {
                const access = yield* checkAccess();
                if (access.status !== "granted") return [];
                const retired = yield* Deferred.make<void>();
                yield* Effect.addFinalizer(() =>
                  Deferred.succeed(retired, undefined),
                );
                return yield* acquire(retired);
              }).pipe(
                Effect.tapError((error) =>
                  Effect.logError(
                    error.reason._tag === "Dataset.AccessDenied"
                      ? "Provider access denied; waiting for refresh"
                      : "Provider acquisition failed; retrying",
                    error,
                  ),
                ),
                Effect.map((datasets) =>
                  Stream.concat(Stream.succeed(datasets), Stream.never),
                ),
              ),
            ).pipe(
              Stream.catch((error) =>
                error.reason._tag === "Dataset.AccessDenied"
                  ? Stream.never
                  : Stream.fail(error),
              ),
              Stream.retry(Schedule.spaced("5 seconds")),
              Stream.orDie,
            ),
          )
        : Stream.succeed<readonly Dataset[]>([]),
    ),
  );
});
