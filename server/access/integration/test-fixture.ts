// Purpose: Shares real Integration, Credential, Events, and isolated SQLite test setup.

import { Credential } from "@openchart/server/access/credential";
import { jweEncryption } from "@openchart/server/access/credential/encryption";
import { randomBytes } from "node:crypto";
import { Database } from "@openchart/server/db";
import { Events } from "@openchart/server/events";
import { Effect, Layer, type Scope } from "effect";
import { TestClock } from "effect/testing";
import { Integration } from "./integration";
import { layer } from "./layer";

export const integrationID = Integration.IntegrationID.make("acme");
export const methodID = Integration.MethodID.make("browser");
export const keyMethod: Integration.Implementation = {
  integrationID,
  method: { type: "key" },
};
export const value = Credential.OAuth.make({
  type: "oauth",
  methodID,
  access: "access-token",
  refresh: "refresh-token",
  expires: 900_000,
});
export const instructions = {
  url: "https://example.com/authorize",
  instructions: "Sign in",
};
type Services =
  | Integration.Service
  | Credential.Service
  | Database.Service
  | Events.Service
  | Scope.Scope;

/**
 * Runs public Service operations against isolated SQLite and a virtual clock.
 * @example
 * await run(Integration.Service.use(service => service.listIntegrations()));
 */
export function run<A, E>(
  program: Effect.Effect<A, E, Services>,
  configuration: Integration.Configuration = {},
) {
  const dependencies = Credential.layer(jweEncryption(randomBytes(32))).pipe(
    Layer.provideMerge(Database.layer(":memory:", () => Effect.void)),
    Layer.provideMerge(Events.layer),
  );
  return Effect.runPromise(
    program.pipe(
      Effect.scoped,
      Effect.provide(
        layer(configuration).pipe(Layer.provideMerge(dependencies)),
      ),
      Effect.provide(TestClock.layer()),
    ),
  );
}

/**
 * Creates an OAuth registration supplied by a test.
 * @example
 * const method = oauth(Effect.succeed({...instructions, mode: 'auto', callback: Effect.never}));
 */
export function oauth(
  authorize: Effect.Effect<
    Integration.OAuthAuthorization,
    unknown,
    Scope.Scope
  >,
): Integration.OAuthImplementation {
  return {
    integrationID,
    method: { id: methodID, type: "oauth", label: "Browser" },
    authorize: () => authorize,
  };
}
