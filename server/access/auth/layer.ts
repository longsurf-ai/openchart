// Purpose: Project local account state from Integration and serialize account writes.

import { Effect, Layer, Schema, Semaphore } from "effect";
import { Integration } from "@openchart/server/access/integration";
import { Auth } from "./auth";

/** Account identity and connection cleanup supplied by application composition. */
export interface Configuration {
  readonly integrationID: Integration.IntegrationID;
  /** Cancel old account connections before an account write returns. @example resetConnections: () => openchart.reset() */
  readonly resetConnections: () => Effect.Effect<void>;
}

const Metadata = Schema.Struct({
  user: Auth.User,
  // Earlier SDK handoffs saved only the secret/profile. Preserve those keys,
  // but restoration requires an actual Clerk ID; never invent one locally.
  apiKeyID: Schema.optionalKey(Schema.NonEmptyString),
});
const unavailable = () => new Auth.SessionUnavailable({});
const failed = (reason: Auth.AuthOperationFailed["reason"]) =>
  new Auth.AuthOperationFailed({ reason });

/**
 * Reads the local key/profile on demand without Clerk or a renderer. Credential
 * remains the source of truth; Auth maintains no account or session-token cache.
 * Account writes and injected connection cleanup share one serialized,
 * uninterruptible operation. Auth owns no transport implementation.
 * @example const auth = layer({integrationID, resetConnections: () => openchart.reset()});
 */
export function layer(options?: Configuration) {
  return Layer.effect(
    Auth.Service,
    Effect.gen(function* () {
      if (!options)
        return Auth.Service.of({
          getState: () => Effect.fail(unavailable()),
          getSavedKey: () => Effect.fail(unavailable()),
          restoreSignIn: () => Effect.fail(failed("closed")),
          completeSignIn: () => Effect.fail(failed("closed")),
          logout: () => Effect.fail(failed("closed")),
        });
      const integration = yield* Integration.Service;
      const writes = yield* Semaphore.make(1);
      const readSaved = Effect.fn("Auth.readSaved")(function* () {
        const credential = yield* integration.connection
          .getSavedCredential(options.integrationID)
          .pipe(Effect.mapError(unavailable));
        if (!credential) return undefined;
        if (credential.value.type !== "key") return yield* unavailable();
        const metadata = yield* Schema.decodeUnknownEffect(Metadata)(
          credential.value.metadata,
        ).pipe(Effect.mapError(unavailable));
        return { credential, metadata };
      });
      const getState = Effect.fn("Auth.getState")(
        function* (): Effect.fn.Return<Auth.State, Auth.SessionUnavailable> {
          const value = yield* integration.connection
            .resolveCredential(options.integrationID)
            .pipe(Effect.mapError(unavailable));
          if (!value) return { status: "signed-out" };
          if (value.type !== "key") return yield* unavailable();
          const { user } = yield* Schema.decodeUnknownEffect(Metadata)(
            value.metadata,
          ).pipe(Effect.mapError(unavailable));
          return { status: "signed-in", user };
        },
      );
      return Auth.Service.of({
        getState,
        getSavedKey: Effect.fn("Auth.getSavedKey")(function* (userID) {
          const saved = yield* readSaved();
          if (
            !saved ||
            saved.metadata.user.id !== userID ||
            !saved.metadata.apiKeyID
          )
            return null;
          return { apiKeyID: saved.metadata.apiKeyID };
        }),
        restoreSignIn: Effect.fn("Auth.restoreSignIn")(
          function* (input) {
            const saved = yield* readSaved().pipe(
              Effect.mapError(() => failed("storage")),
            );
            if (
              !saved ||
              saved.metadata.user.id !== input.userID ||
              saved.metadata.apiKeyID !== input.apiKeyID
            )
              return yield* failed("credential-mismatch");
            if (saved.credential.active) return;
            yield* integration.connection
              .setActive(options.integrationID, true)
              .pipe(Effect.mapError(() => failed("storage")));
            yield* options.resetConnections();
          },
          writes.withPermits(1),
          Effect.uninterruptible,
        ),
        completeSignIn: Effect.fn("Auth.completeSignIn")(
          function* (input) {
            const state = yield* getState().pipe(
              Effect.mapError(() => failed("storage")),
            );
            if (state.status === "signed-in") return yield* failed("busy");
            yield* integration.connection
              .setApiKey({
                integrationID: options.integrationID,
                key: input.key,
                metadata: { user: input.user, apiKeyID: input.apiKeyID },
              })
              .pipe(Effect.mapError(() => failed("storage")));
            yield* options.resetConnections();
          },
          writes.withPermits(1),
          Effect.uninterruptible,
        ),
        logout: Effect.fn("Auth.logout")(
          function* () {
            yield* integration.connection
              .setActive(options.integrationID, false)
              .pipe(Effect.mapError(() => failed("storage")));
            yield* options.resetConnections();
          },
          writes.withPermits(1),
          Effect.uninterruptible,
        ),
      });
    }),
  );
}
