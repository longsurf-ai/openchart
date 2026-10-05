// Purpose: Implements the Integration registry, credential resolution, and scoped OAuth attempts.

import { Credential } from "@openchart/server/access/credential";
import { Events } from "@openchart/server/events";
import {
  Cause,
  Clock,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Schedule,
  Scope,
  SynchronizedRef,
} from "effect";
import { Integration } from "./integration";
import type {
  Configuration,
  Details,
  Identity,
  Method,
  OAuthAuthorization,
  OAuthImplementation,
} from "./integration";
import { IntegrationID, MethodID, OAuthAttemptID } from "./id";
import { AuthorizationError, CodeRequiredError } from "./errors";
import { Event } from "./events";

type Entry = {
  ref: Identity;
  methods: Method[];
  implementations: Map<MethodID, OAuthImplementation>;
};

const attemptLifetime = Duration.toMillis(Duration.minutes(10));
const terminalRetention = Duration.toMillis(Duration.minutes(1));
const scrubInterval = Duration.seconds(30);

type PendingAttempt = {
  status: "pending";
  completing: boolean;
  authorization: OAuthAuthorization;
  integrationID: IntegrationID;
  methodID: MethodID;
  label?: string;
  scope: Scope.Closeable;
  time: Integration.OAuthAttemptTime;
};
type TerminalAttempt = Integration.OAuthAttemptStatus & {
  status: "complete" | "failed" | "expired";
  removeAt: number;
};
type AttemptEntry = PendingAttempt | TerminalAttempt;

/**
 * Builds the registry once and owns OAuth attempts until the application scope closes.
 * Credential persists secrets; this layer owns only registrations and temporary attempts.
 * No registrations means an empty catalog. Construction performs no remote authorization.
 * @example
 * const integrations = layer({methods: [{integrationID: IntegrationID.make('acme'), method: {type: 'key'}}]});
 */
export function layer(configuration: Configuration = {}) {
  return Layer.effect(
    Integration.Service,
    Effect.gen(function* () {
      const credentials = yield* Credential.Service;
      const events = yield* Events.Service;
      const scope = yield* Scope.Scope;
      const attempts = SynchronizedRef.makeUnsafe(
        new Map<OAuthAttemptID, AttemptEntry>(),
      );
      const integrations = new Map<IntegrationID, Entry>();
      for (const ref of configuration.integrations ?? []) {
        integrations.set(ref.id, {
          ref,
          methods: [],
          implementations: new Map(),
        });
      }
      for (const implementation of configuration.methods ?? []) {
        const current = integrations.get(implementation.integrationID) ?? {
          ref: {
            id: implementation.integrationID,
            name: implementation.integrationID,
          },
          methods: [],
          implementations: new Map<MethodID, OAuthImplementation>(),
        };
        if (!integrations.has(implementation.integrationID)) {
          integrations.set(implementation.integrationID, current);
        }
        const index = current.methods.findIndex((method) => {
          if (method.type !== implementation.method.type) return false;
          if (method.type !== "oauth" || implementation.method.type !== "oauth")
            return true;
          return method.id === implementation.method.id;
        });
        if (index === -1) current.methods.push(implementation.method);
        else current.methods[index] = implementation.method;
        if (implementation.method.type === "oauth") {
          current.implementations.set(
            implementation.method.id,
            implementation as OAuthImplementation,
          );
        }
      }

      const project = (
        entry: Entry,
        saved: readonly Credential.Info[],
      ): Details => ({
        id: entry.ref.id,
        name: entry.ref.name,
        methods: entry.methods,
        credentialSources: saved
          .map((credential) => ({
            type: "credential" as const,
            id: credential.id,
            label: credential.label,
            active: credential.active,
          }))
          .reverse(),
      });

      const authorize = Effect.mapError(
        (cause: unknown) => new AuthorizationError({ cause }),
      );

      const close = (attemptScope: Scope.Closeable) =>
        Scope.close(attemptScope, Exit.void);

      const message = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return error instanceof Error ? error.message : String(error);
      };

      const settle = Effect.fnUntraced(function* (
        attemptID: OAuthAttemptID,
        exit: Exit.Exit<Credential.OAuth, unknown>,
      ) {
        const now = yield* Clock.currentTimeMillis;
        // Completion becomes visible only after persistence. The same lock chooses
        // whether settlement or cancellation/expiry wins; a losing callback cannot save.
        const result = yield* SynchronizedRef.modifyEffect(
          attempts,
          (current) =>
            Effect.gen(function* () {
              const attempt = current.get(attemptID);
              if (!attempt || attempt.status !== "pending")
                return [undefined, current] as const;
              const persisted = yield* Effect.gen(function* () {
                if (Exit.isFailure(exit)) return;
                const implementation = integrations
                  .get(attempt.integrationID)
                  ?.implementations.get(attempt.methodID);
                yield* credentials.create({
                  integrationID: attempt.integrationID,
                  label: attempt.label ?? implementation?.label?.(exit.value),
                  value: exit.value,
                });
              }).pipe(Effect.exit);
              const settled: Exit.Exit<unknown, unknown> = Exit.isFailure(
                persisted,
              )
                ? persisted
                : exit;
              const terminal: TerminalAttempt = {
                time: attempt.time,
                removeAt: now + terminalRetention,
                ...(Exit.isSuccess(settled)
                  ? { status: "complete" }
                  : { status: "failed", message: message(settled.cause) }),
              };
              return [
                { attempt, persisted, settled },
                new Map(current).set(attemptID, terminal),
              ] as const;
            }),
        );
        if (!result) return;
        yield* Effect.gen(function* () {
          if (Exit.isSuccess(result.settled)) {
            yield* events.publish(Event.Updated, {});
          }
          yield* result.persisted;
        }).pipe(Effect.ensuring(close(result.attempt.scope)));
      });

      // Both modes settle and close in the callback's own finalizer. forkIn keeps
      // the callback alive across requests and skips self-interruption on close.
      const runAttempt = <E>(
        attemptID: OAuthAttemptID,
        attemptScope: Scope.Closeable,
        callback: Effect.Effect<Credential.OAuth, E>,
      ) =>
        callback.pipe(
          Effect.onExit((exit) => settle(attemptID, exit)),
          Effect.exit,
          Effect.forkIn(attemptScope),
        );

      const scrub = Effect.fnUntraced(function* () {
        const now = yield* Clock.currentTimeMillis;
        const expired = yield* SynchronizedRef.modify(attempts, (current) => {
          const next = new Map(current);
          const scopes: Scope.Closeable[] = [];
          for (const [id, attempt] of current) {
            if (attempt.status === "pending" && attempt.time.expires <= now) {
              scopes.push(attempt.scope);
              next.set(id, {
                status: "expired",
                time: attempt.time,
                removeAt: now + terminalRetention,
              });
              continue;
            }
            if (attempt.status !== "pending" && attempt.removeAt <= now)
              next.delete(id);
          }
          return [scopes, next];
        });
        yield* Effect.forEach(expired, close, { discard: true });
      });

      yield* scrub().pipe(
        Effect.repeat(Schedule.spaced(scrubInterval)),
        Effect.forkIn(scope),
      );

      return Integration.Service.of({
        getIntegration: Effect.fn("Integration.getIntegration")(function* (id) {
          const entry = integrations.get(id);
          if (!entry) return undefined;
          return project(entry, yield* credentials.list(id));
        }),
        listIntegrations: Effect.fn("Integration.listIntegrations")(
          function* () {
            const saved = new Map<IntegrationID, Credential.Info[]>();
            for (const credential of yield* credentials.all()) {
              const group = saved.get(credential.integrationID) ?? [];
              group.push(credential);
              saved.set(credential.integrationID, group);
            }
            return Array.from(integrations.values(), (entry) =>
              project(entry, saved.get(entry.ref.id) ?? []),
            ).sort((a, b) => a.name.localeCompare(b.name));
          },
        ),
        connection: {
          getSavedCredential: Effect.fn(
            "Integration.connection.getSavedCredential",
          )(function* (integrationID) {
            return (yield* credentials.list(integrationID)).at(-1);
          }),
          setActive: Effect.fn("Integration.connection.setActive")(
            function* (integrationID, active) {
              yield* credentials.setActive(integrationID, active);
              yield* events.publish(Event.Updated, {});
            },
          ),
          resolveCredential: Effect.fn(
            "Integration.connection.resolveCredential",
          )(function* (integrationID) {
            const entry = integrations.get(integrationID);
            const credential = (yield* credentials.list(
              integrationID,
              true,
            )).at(-1);
            if (!credential) return undefined;
            if (credential.value.type === "key") return credential.value;
            const implementation = entry?.implementations.get(
              credential.value.methodID,
            );
            if (!implementation?.refresh) return credential.value;
            const now = yield* Clock.currentTimeMillis;
            if (
              credential.value.expires >
              now + Duration.toMillis(Duration.minutes(5))
            )
              return credential.value;
            const value = yield* authorize(
              implementation.refresh(credential.value),
            );
            yield* credentials.update(credential.id, { value });
            return value;
          }),
          setApiKey: Effect.fn("Integration.connection.setApiKey")(
            function* (input) {
              const method = integrations
                .get(input.integrationID)
                ?.methods.some((method) => method.type === "key");
              if (!method)
                return yield* Effect.die(
                  `Key method not found: ${input.integrationID}`,
                );
              yield* credentials.create({
                integrationID: input.integrationID,
                label: input.label,
                value: Credential.Key.make({
                  type: "key",
                  key: input.key,
                  metadata: input.metadata,
                }),
              });
              yield* events.publish(Event.Updated, {});
            },
          ),
          disconnect: Effect.fn("Integration.connection.disconnect")(
            function* (integrationID) {
              yield* credentials.clear(integrationID);
              yield* events.publish(Event.Updated, {});
            },
          ),
        },
        oauthAttempt: {
          start: Effect.fn("Integration.oauthAttempt.start")(function* (input) {
            const method = integrations
              .get(input.integrationID)
              ?.implementations.get(input.methodID);
            if (!method) {
              return yield* Effect.die(
                `OAuth method not found: ${input.integrationID}/${input.methodID}`,
              );
            }
            const attemptScope = yield* Scope.fork(scope);
            const authorization = yield* authorize(
              method.authorize(input.inputs),
            ).pipe(
              Scope.provide(attemptScope),
              Effect.onExit((exit) =>
                Exit.isFailure(exit)
                  ? Scope.close(attemptScope, exit)
                  : Effect.void,
              ),
            );
            const id = OAuthAttemptID.create();
            const created = yield* Clock.currentTimeMillis;
            const time = { created, expires: created + attemptLifetime };
            yield* SynchronizedRef.update(attempts, (current) =>
              new Map(current).set(id, {
                status: "pending",
                completing: authorization.mode === "auto",
                authorization,
                integrationID: input.integrationID,
                methodID: input.methodID,
                label: input.label,
                scope: attemptScope,
                time,
              }),
            );
            if (authorization.mode === "auto") {
              yield* runAttempt(id, attemptScope, authorization.callback);
            }
            return {
              attemptID: id,
              url: authorization.url,
              instructions: authorization.instructions,
              mode: authorization.mode,
              time,
            };
          }),

          getStatus: Effect.fn("Integration.oauthAttempt.getStatus")(
            function* (attemptID) {
              const attempt = (yield* SynchronizedRef.get(attempts)).get(
                attemptID,
              );
              if (!attempt)
                return yield* Effect.die(
                  `OAuth attempt not found: ${attemptID}`,
                );
              if (attempt.status === "failed") {
                return {
                  status: attempt.status,
                  message: attempt.message,
                  time: attempt.time,
                };
              }
              return { status: attempt.status, time: attempt.time };
            },
          ),
          complete: Effect.fn("Integration.oauthAttempt.complete")(
            function* (input) {
              // Claim and fork together; request interruption must not leave an
              // unclaimed callback running or a claimed attempt without a fiber.
              const completion = yield* SynchronizedRef.modifyEffect(
                attempts,
                (current) =>
                  Effect.gen(function* () {
                    const attempt = current.get(input.attemptID);
                    if (!attempt)
                      return yield* Effect.die(
                        `OAuth attempt not found: ${input.attemptID}`,
                      );
                    if (attempt.status !== "pending")
                      return [undefined, current] as const;
                    if (
                      attempt.authorization.mode === "code" &&
                      input.code === undefined
                    ) {
                      return yield* new CodeRequiredError({
                        attemptID: input.attemptID,
                      });
                    }
                    if (attempt.completing)
                      return yield* Effect.die(
                        `OAuth attempt already completing: ${input.attemptID}`,
                      );
                    const authorization = attempt.authorization;
                    const callback =
                      authorization.mode === "auto"
                        ? authorization.callback
                        : Effect.suspend(() =>
                            authorization.callback(input.code as string),
                          );
                    const completion = yield* runAttempt(
                      input.attemptID,
                      attempt.scope,
                      authorize(callback),
                    );
                    return [
                      completion,
                      new Map(current).set(input.attemptID, {
                        ...attempt,
                        completing: true,
                      }),
                    ] as const;
                  }),
              ).pipe(Effect.uninterruptible);
              if (completion)
                yield* Fiber.join(completion).pipe(
                  Effect.flatten,
                  Effect.asVoid,
                );
            },
          ),
          cancel: Effect.fn("Integration.oauthAttempt.cancel")(
            function* (attemptID) {
              const attempt = yield* SynchronizedRef.modify(
                attempts,
                (current) => {
                  const match = current.get(attemptID);
                  if (!match || match.status !== "pending")
                    return [undefined, current];
                  const next = new Map(current);
                  next.delete(attemptID);
                  return [match, next];
                },
              );
              if (attempt) yield* Scope.close(attempt.scope, Exit.void);
            },
          ),
        },
      });
    }),
  );
}
