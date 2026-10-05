// Purpose: Connect each Clerk session to the local account once and own sign-out for the account gate.
import { useClerk, useSession, useUser } from "@clerk/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import type { AppTransport } from "@openchart/app/lib/transport/transport";

import { createSignInFlow } from "./sign-in";

const accountKey = ["account"] as const;

function useAccountConnectionState(transport: AppTransport) {
  const clerk = useClerk();
  const { user } = useUser();
  const { session } = useSession();
  const queries = useQueryClient();
  const started = useRef<object>();
  // One flow per Clerk session; a replaced session deactivates the old flow.
  const attempt = useMemo(
    () => ({
      sessionID: session?.id,
      flow: createSignInFlow(transport.rpc.access.auth, clerk),
    }),
    [transport, clerk, session?.id],
  );
  const flow = attempt.flow;
  const refresh = () => queries.invalidateQueries({ queryKey: accountKey });
  const completion = useMutation({
    // The gate reports failures with Retry once the workspace is open.
    meta: { silent: true },
    mutationFn: () => flow.complete(),
    onSettled: refresh,
    retry: false,
    gcTime: 0,
  });
  const logout = useMutation({
    meta: { errorTitle: "Couldn’t finish signing out" },
    mutationFn: async () => {
      flow.setActive(false);
      // Ending the Clerk session first closes the gate; a local failure then
      // leaves a signed-out gate instead of one that restores the old key.
      await clerk.signOut();
      await transport.rpc.access.auth.logout.mutate();
    },
    onSettled: refresh,
    retry: false,
  });
  const complete = completion.mutate;
  const signingOut = logout.isPending;
  useEffect(() => {
    const active = Boolean(user && session) && !signingOut;
    flow.setActive(active);
    if (active && started.current !== attempt) {
      started.current = attempt;
      complete();
    }
    return () => flow.setActive(false);
  }, [attempt, complete, flow, session, signingOut, user]);

  return { completion, logout };
}

const AccountConnectionContext = createContext<
  ReturnType<typeof useAccountConnectionState> | undefined
>(undefined);

/**
 * Connects every Clerk session to the local account exactly once: an existing
 * matching account is kept, a saved key is restored, otherwise a new key is
 * handed off. Sign-out and unmount stop pending SDK results. Mount above the
 * account gate so sign-out survives the workspace unmounting.
 * @example <AccountConnectionProvider transport={transport}>{children}</AccountConnectionProvider>
 */
export function AccountConnectionProvider({
  transport,
  children,
}: {
  transport: AppTransport;
  children: ReactNode;
}) {
  const value = useAccountConnectionState(transport);
  return (
    <AccountConnectionContext.Provider value={value}>
      {children}
    </AccountConnectionContext.Provider>
  );
}

/**
 * Shares the session handoff and sign-out with the gate and Profile; requires its provider.
 * @example const { logout } = useAccountConnection();
 */
export function useAccountConnection() {
  const value = useContext(AccountConnectionContext);
  if (!value) throw new Error("Account connection provider is missing.");
  return value;
}
