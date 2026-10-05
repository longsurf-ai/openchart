// Purpose: Defines the Integration Effect service contract and registration inputs.

export * as Integration from "./integration";

import type { Credential } from "@openchart/server/access/credential";
import { Context, type Effect, type Scope } from "effect";

import { IntegrationID, MethodID, OAuthAttemptID } from "./id";
import { CodeRequiredError, AuthorizationError } from "./errors";

export {
  IntegrationID,
  MethodID,
  OAuthAttemptID,
  CodeRequiredError,
  AuthorizationError,
};

/** Condition controlling whether an authorization form field is shown. */
export interface When {
  readonly key: string;
  readonly op: "eq" | "neq";
  readonly value: string;
}

/** Text requested by an integration's authorization method. */
export interface TextAuthField {
  readonly type: "text";
  readonly key: string;
  readonly message: string;
  readonly placeholder?: string;
  readonly when?: When;
}

/** Choice requested by an integration's authorization method. */
export interface SelectAuthField {
  readonly type: "select";
  readonly key: string;
  readonly message: string;
  readonly options: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly hint?: string;
  }>;
  readonly when?: When;
}

/** A declarative authorization form field; it contains no credential material. */
export type AuthField = TextAuthField | SelectAuthField;

/** Describes an OAuth method available to clients. */
export interface OAuthMethod {
  readonly id: MethodID;
  readonly type: "oauth";
  readonly label: string;
  readonly fields?: readonly AuthField[];
}

/** Describes manual API-key entry. */
export interface ApiKeyMethod {
  readonly type: "key";
  readonly label?: string;
}

/** The supported ways an integration can obtain credentials. */
export type Method = OAuthMethod | ApiKeyMethod;

/** Values entered in an authorization method's form fields. */
export type Inputs = Readonly<Record<string, string>>;

/** Public credential-source metadata never contains the stored secret. */
export interface CredentialSource {
  readonly type: "credential";
  /**
   * Identifies a locally stored credential record, such as `cred_001`.
   * The record's integrationID identifies the external system; its value
   * contains the secret used to authenticate with that system.
   */
  readonly id: Credential.ID;
  readonly label: string;
  /** Whether business callers may resolve this credential locally. */
  readonly active: boolean;
}

/** Stable integration identity and display name. */
export interface Identity {
  /**
   * Identifies the external system, such as `openchart-cloud`.
   * This identity stays the same when its credentials are replaced.
   */
  readonly id: IntegrationID;
  readonly name: string;
}

/** An integration's available methods and secret-free credential-source metadata. */
export interface Details extends Identity {
  readonly methods: readonly Method[];
  readonly credentialSources: readonly CredentialSource[];
}

/** Epoch-millisecond creation and expiry times of one OAuth attempt. */
export interface OAuthAttemptTime {
  readonly created: number;
  readonly expires: number;
}

/** Authorization instructions returned when an OAuth attempt starts. */
export interface OAuthAttempt {
  readonly attemptID: OAuthAttemptID;
  readonly url: string;
  readonly instructions: string;
  readonly mode: "auto" | "code";
  readonly time: OAuthAttemptTime;
}

/** Public state of an OAuth attempt, without tokens or callbacks. */
export type OAuthAttemptStatus =
  | {
      readonly status: "pending" | "complete" | "expired";
      readonly time: OAuthAttemptTime;
    }
  | {
      readonly status: "failed";
      readonly message: string;
      readonly time: OAuthAttemptTime;
    };

/** Provider-owned OAuth completion work, retained only inside the server. */
export type OAuthAuthorization = {
  readonly url: string;
  readonly instructions: string;
} & (
  | {
      readonly mode: "auto";
      readonly callback: Effect.Effect<Credential.OAuth, unknown>;
    }
  | {
      readonly mode: "code";
      readonly callback: (
        code: string,
      ) => Effect.Effect<Credential.OAuth, unknown>;
    }
);

/**
 * Operations supplied by an integration's OAuth implementation.
 * OAuth credentials identify their registered method through methodID;
 * providers own their metadata fields.
 */
export interface OAuthImplementation {
  readonly integrationID: IntegrationID;
  readonly method: OAuthMethod;
  /**
   * Opens a scoped authorization attempt without persisting a credential.
   * @example
   * const authorization = yield* implementation.authorize({organization: 'work'});
   */
  readonly authorize: (
    inputs: Inputs,
  ) => Effect.Effect<OAuthAuthorization, unknown, Scope.Scope>;
  /**
   * Exchanges an existing OAuth credential for renewed tokens.
   * @example
   * const renewed = yield* implementation.refresh!(credential);
   */
  readonly refresh?: (
    credential: Credential.OAuth,
  ) => Effect.Effect<Credential.OAuth, unknown>;
  /**
   * Derives a display label from a completed credential.
   * @example
   * const label = implementation.label?.(credential);
   */
  readonly label?: (credential: Credential.OAuth) => string | undefined;
}

/** Registration of a manual-key connection method. */
export interface ApiKeyImplementation {
  readonly integrationID: IntegrationID;
  readonly method: ApiKeyMethod;
}

/** A connection method supplied by an integration owner. */
export type Implementation = OAuthImplementation | ApiKeyImplementation;

/** Startup registrations; later entries replace the same identity or method. */
export interface Configuration {
  /** Display identities; methods may also introduce an integration named by its ID. */
  readonly integrations?: readonly Identity[];
  /** One key method per integration and one OAuth implementation per method ID. */
  readonly methods?: readonly Implementation[];
}

/** Failures declared by the Integration service API. */
export type Error =
  CodeRequiredError | AuthorizationError | Credential.StorageFailed;

/**
 * Integration discovery, credential resolution, and authorization lifecycle.
 * Only management methods may become client APIs; resolveCredential returns
 * secrets and remains an internal capability. Credential-source metadata is for
 * management views; providers resolve credentials by IntegrationID.
 */
export interface Interface {
  /**
   * Returns one integration.
   * @example
   * const details = yield* integrations.getIntegration(integrationID);
   */
  readonly getIntegration: (
    integrationID: IntegrationID,
  ) => Effect.Effect<Details | undefined, Credential.StorageFailed>;
  /**
   * Lists integrations.
   * @example
   * const all = yield* integrations.listIntegrations();
   */
  readonly listIntegrations: () => Effect.Effect<
    Details[],
    Credential.StorageFailed
  >;

  readonly connection: {
    /**
     * Reads the current stored credential, including inactive records, without
     * refreshing OAuth or checking remote validity. This secret-bearing capability
     * is for backend account restoration only; never expose it over a transport.
     * @example const saved = yield* integrations.connection.getSavedCredential(integrationID);
     */
    readonly getSavedCredential: (
      integrationID: IntegrationID,
    ) => Effect.Effect<Credential.Info | undefined, Credential.StorageFailed>;
    /**
     * Enables or disables local credential use, preserving the encrypted value.
     * No credential is a no-op. Publishes Updated after storage succeeds; does
     * not validate remote access or close transports. Auth owns account cleanup.
     * @example yield* integrations.connection.setActive(integrationID, false);
     */
    readonly setActive: (
      integrationID: IntegrationID,
      active: boolean,
    ) => Effect.Effect<void, Credential.StorageFailed>;
    /**
     * Resolves an integration's credential, refreshing OAuth tokens when needed.
     * Reads only active database-backed credentials. Missing or inactive returns undefined;
     * storage and refresh failures remain errors. The secret-bearing
     * {@link Credential.Value} stays internal, never a client response.
     * @example
     * const credential = yield* integrations.connection.resolveCredential(integrationID);
     */
    readonly resolveCredential: (
      integrationID: IntegrationID,
    ) => Effect.Effect<
      Credential.Value | undefined,
      AuthorizationError | Credential.StorageFailed
    >;
    /**
     * Stores a key and provider-owned metadata for an integration supporting that method.
     * Saving a key does not establish a socket or prove remote authorization.
     * @example
     * yield* integrations.connection.setApiKey({integrationID, key: suppliedKey});
     */
    readonly setApiKey: (input: {
      readonly integrationID: IntegrationID;
      readonly key: string;
      readonly label?: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }) => Effect.Effect<void, AuthorizationError | Credential.StorageFailed>;
    /**
     * Disconnects locally by clearing this integration's current credentials.
     * Registration and authentication methods remain available for reconnecting.
     * Repeated disconnect is safe and does not revoke remote credentials.
     * @example
     * yield* integrations.connection.disconnect(integrationID);
     */
    readonly disconnect: (
      integrationID: IntegrationID,
    ) => Effect.Effect<void, Credential.StorageFailed>;
  };
  readonly oauthAttempt: {
    /**
     * Starts an OAuth attempt and returns its client-facing instructions.
     * @example
     * const attempt = yield* integrations.oauthAttempt.start({integrationID, methodID, inputs: {}});
     */
    readonly start: (input: {
      readonly integrationID: IntegrationID;
      readonly methodID: MethodID;
      readonly inputs: Inputs;
      readonly label?: string;
    }) => Effect.Effect<OAuthAttempt, AuthorizationError>;
    /**
     * Reads attempt state.
     * @example
     * const state = yield* integrations.oauthAttempt.getStatus(attemptID);
     */
    readonly getStatus: (
      attemptID: OAuthAttemptID,
    ) => Effect.Effect<OAuthAttemptStatus>;
    /**
     * Completes authorization and stores its credential.
     * @example
     * yield* integrations.oauthAttempt.complete({attemptID, code: suppliedCode});
     */
    readonly complete: (input: {
      readonly attemptID: OAuthAttemptID;
      readonly code?: string;
    }) => Effect.Effect<
      void,
      CodeRequiredError | AuthorizationError | Credential.StorageFailed
    >;
    /**
     * Cancels an attempt and releases its resources.
     * @example
     * yield* integrations.oauthAttempt.cancel(attemptID);
     */
    readonly cancel: (attemptID: OAuthAttemptID) => Effect.Effect<void>;
  };
}

/**
 * Declares the Integration capability supplied by the Integration layer.
 * @example
 * const integrations = yield* Integration.Service;
 * const availableIntegrations = yield* integrations.listIntegrations();
 */
export class Service extends Context.Service<Service, Interface>()(
  "@openchart/server/Integration",
) {}
