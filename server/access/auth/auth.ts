// Purpose: Defines the local account lifecycle, independent of Clerk's frontend session.

export * as Auth from "./auth";

import { Context, type Effect, Schema } from "effect";
import type { AuthOperationFailed, SessionUnavailable } from "./errors";
import { User, type State } from "./state";

export { User, State } from "./state";
export { AuthOperationFailed, SessionUnavailable } from "./errors";

/** Login handoff from the SDK. Profile data is display-only; cloud verifies the key. */
export const SignInInput = Schema.Struct({
  apiKeyID: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
  user: User,
});
/** Parsed SDK login result; never return this secret-bearing value to the UI. */
export type SignInInput = typeof SignInInput.Type;

/** Clerk key identity returned only for the requested local account; no secret. */
export const SavedKey = Schema.Struct({ apiKeyID: Schema.NonEmptyString });
/** Public identifier used to query the key's status through the Clerk frontend SDK. */
export type SavedKey = typeof SavedKey.Type;

/** The caller has signed into Clerk and checked this key's current remote status. */
export const RestoreSignInInput = Schema.Struct({
  userID: Schema.NonEmptyString,
  apiKeyID: Schema.NonEmptyString,
});
/** Local restore request; a claimed identity is not proof of cloud authorization. */
export type RestoreSignInInput = typeof RestoreSignInInput.Type;

/**
 * Local account lifecycle. Integration alone reads/writes Credential; Billing and
 * data providers obtain credentials directly from Integration. The App's account
 * survives renderer closure and is independent of the SDK's browser session.
 * All account writers use Auth; successful writes run injected connection cleanup.
 */
export interface Interface {
  /**
   * Reads the saved account profile through Integration without network I/O.
   * Missing or inactive credentials mean signed-out; storage/corruption errors remain errors.
   * Public state is not proof of cloud identity or subscription entitlement.
   * @example const state = yield* auth.getState();
   */
  readonly getState: () => Effect.Effect<State, SessionUnavailable>;
  /**
   * Reads the saved Clerk key ID for this user, whether locally active or inactive.
   * Missing credentials, another user's credentials, or an unrecorded Clerk ID
   * return null. Storage and malformed metadata remain errors. Does no network
   * I/O; the frontend queries Clerk for revoked/expired state before restoring.
   * @example const saved = yield* auth.getSavedKey(user.id);
   */
  readonly getSavedKey: (
    userID: string,
  ) => Effect.Effect<SavedKey | null, SessionUnavailable>;
  /**
   * Re-enables the saved key only when both user ID and Clerk key ID match.
   * A mismatch fails without writes; an already active match is idempotent.
   * Uses the same serialized, uninterruptible write/Cloud reset boundary as login
   * and logout. The caller stops submitting restores after cancellation/logout.
   * Cloud requests still verify the secret remotely; this is local enablement.
   * @example yield* auth.restoreSignIn({userID: user.id, apiKeyID: saved.apiKeyID});
   */
  readonly restoreSignIn: (
    input: RestoreSignInInput,
  ) => Effect.Effect<void, AuthOperationFailed>;
  /**
   * Saves the SDK-issued user key and public profile through Integration, which
   * publishes the credential change notification used to refresh account queries.
   * An active account rejects replacement until logout. An inactive record is
   * atomically replaced only after the new key is encrypted successfully. Saving and logout are
   * serialized through Cloud reset; interruption cannot split persistence,
   * state notification, and transport cleanup. Direct backend callers get the
   * same guarantee as the HTTP routes.
   * The caller stops submitting SDK results after cancellation or logout.
   * @example yield* auth.completeSignIn({apiKeyID, key, user});
   */
  readonly completeSignIn: (
    input: SignInInput,
  ) => Effect.Effect<void, AuthOperationFailed>;
  /**
   * Disables the local account credential through Integration, which publishes
   * the same credential change notification as other Integration writes.
   * Waits for any submitted write and its Cloud reset, then disables credentials and
   * resets Cloud transport before returning. Repeated logout is safe. Storage
   * failure must not report success. The frontend separately signs out its Clerk SDK session.
   * Retains encrypted credentials for later restoration and does not revoke the remote key.
   * @example yield* auth.logout();
   */
  readonly logout: () => Effect.Effect<void, AuthOperationFailed>;
}

/** Local account capability. @example const auth = yield* Auth.Service; */
export class Service extends Context.Service<Service, Interface>()(
  "@openchart/server/Auth",
) {}
