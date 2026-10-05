// Purpose: Restore a saved Clerk key or hand off one new key without duplicating issuance on retries.
import type { useClerk } from "@clerk/react";

import type { AppTransport } from "@openchart/app/lib/transport/transport";

type Auth = AppTransport["rpc"]["access"]["auth"];
type Clerk = ReturnType<typeof useClerk>;
type SignInInput = Parameters<Auth["completeSignIn"]["mutate"]>[0];

/**
 * Owns one renderer login attempt. Secrets stay in this closure until saved;
 * retries reuse them. Deactivation prevents late SDK results from writing after
 * logout/unmount; Auth orders any already-submitted write before logout.
 * @example const flow = createSignInFlow(auth, clerk); await flow.complete();
 */
export function createSignInFlow(auth: Auth, clerk: Clerk) {
  let active = true;
  let pendingCompletion: Promise<void> | undefined;
  let pendingCredential: SignInInput | undefined;

  async function complete() {
    const user = clerk.user;
    if (!user) throw new Error("Please sign in again.");
    const state = await auth.getState.query();
    if (!active) return;
    if (state.status === "signed-in") {
      if (state.user.id !== user.id)
        throw new Error("Sign out before connecting a different account.");
      pendingCredential = undefined;
      return;
    }

    if (pendingCredential) return saveCredential(pendingCredential);

    const saved = await auth.getSavedKey.query({ userID: user.id });
    if (!active) return;
    if (saved) {
      const key = await findClerkKey(user.id, saved.apiKeyID);
      if (!active) return;
      if (key && key.subject === user.id && !key.revoked && !key.expired) {
        await auth.restoreSignIn.mutate({ userID: user.id, apiKeyID: key.id });
        return;
      }
    }

    const key = await clerk.apiKeys.create({
      name: `OpenChart Desktop ${crypto.randomUUID()}`,
      subject: user.id,
    });
    if (!active) return;
    if (!key.secret)
      throw new Error("Couldn’t finish signing in. Please retry.");
    pendingCredential = {
      apiKeyID: key.id,
      key: key.secret,
      user: {
        id: user.id,
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        email: user.primaryEmailAddress?.emailAddress ?? "",
      },
    };
    await saveCredential(pendingCredential);
  }

  async function findClerkKey(userID: string, apiKeyID: string) {
    // Exhaust every page before treating a key as missing; query errors propagate.
    const pageSize = 100;
    for (let initialPage = 1; active; initialPage += 1) {
      const page = await clerk.apiKeys.getAll({
        subject: userID,
        initialPage,
        pageSize,
      });
      if (!active) return;
      const key = page.data.find((key) => key.id === apiKeyID);
      if (key) return key;
      if (!page.data.length || initialPage * pageSize >= page.total_count)
        return;
    }
  }

  async function saveCredential(credential: SignInInput) {
    await auth.completeSignIn.mutate(credential);
    pendingCredential = undefined;
  }

  return {
    /** Pauses submission on unmount or logout. @example flow.setActive(false); */
    setActive(value: boolean) {
      active = value;
    },
    /** Deduplicates concurrent completion and preserves a failed save for retry. @example await flow.complete(); */
    complete(): Promise<void> {
      pendingCompletion ??= complete().finally(() => {
        pendingCompletion = undefined;
      });
      return pendingCompletion;
    },
  };
}
