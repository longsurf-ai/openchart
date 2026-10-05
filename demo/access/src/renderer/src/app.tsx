// Purpose: Use Clerk's sign-in UI and hand a user API key to the local account service.
import { ClerkLoading, SignIn, useClerk, useUser } from "@clerk/electron/react";
import { useEffect, useRef } from "react";
import { BillingPanel, billingKey } from "./billing";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { server } from "./server";

const accountKey = ["account"] as const;
// Keep diagnostics useful without logging response bodies, tokens, or profile data.
const clerkFailure = z.object({
  status: z.number().optional(),
  code: z.string().optional(),
  clerkTraceId: z.string().optional(),
  errors: z.array(z.object({ code: z.string() })).optional(),
});

/** Commit one SDK login; secrets remain in a transient ref, never a query/mutation result. */
function CompleteSignIn({ onCancel }: { onCancel: () => void }) {
  const clerk = useClerk();
  const queryClient = useQueryClient();
  const active = useRef(false);
  const started = useRef(false);
  const credential =
    useRef<Parameters<typeof server.access.auth.completeSignIn.mutate>[0]>();
  const completion = useMutation({
    mutationFn: async () => {
      const user = clerk.user;
      if (!user)
        throw new Error(
          "Your sign-in session is unavailable. Please sign in again.",
        );
      if (!credential.current) {
        try {
          const created = await clerk.apiKeys.create({
            // Clerk requires a unique name per subject, including after local logout.
            name: `OpenChart Desktop ${crypto.randomUUID()}`,
            subject: user.id,
          });
          if (!active.current) return;
          if (!created.secret) throw new Error("Missing API key");
          credential.current = {
            apiKeyID: created.id,
            key: created.secret,
            user: {
              id: user.id,
              firstName: user.firstName ?? "",
              lastName: user.lastName ?? "",
              email: user.primaryEmailAddress?.emailAddress ?? "",
            },
          };
        } catch (cause) {
          const diagnostic = clerkFailure.safeParse(cause);
          console.error(
            "Clerk API key creation failed",
            JSON.stringify(diagnostic.success ? diagnostic.data : {}),
          );
          throw new Error(
            "Could not finish sign in. Please try again or cancel and sign in again.",
          );
        }
      }
      if (!active.current) return;
      try {
        await server.access.auth.completeSignIn.mutate(credential.current);
        credential.current = undefined;
      } catch {
        // A lost response may follow a successful commit. Read public state before retrying.
        const state = await server.access.auth.getState
          .query()
          .catch(() => undefined);
        if (state?.status !== "signed-in" || state.user.id !== user.id)
          throw new Error(
            "Could not save your account securely. Please retry.",
          );
        credential.current = undefined;
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: accountKey });
    },
    retry: false,
    gcTime: 0,
  });
  const complete = completion.mutate;
  useEffect(() => {
    active.current = true;
    if (!started.current) {
      started.current = true;
      complete();
    }
    return () => {
      active.current = false;
    };
  }, [complete]);
  return (
    <section className="account-card">
      <h1>Finishing sign in</h1>
      {completion.isError ? (
        <>
          <p role="alert">{completion.error.message}</p>
          <button onClick={() => complete()}>Try again</button>
        </>
      ) : (
        <p role="status">Preparing your account…</p>
      )}
      <button className="secondary" onClick={onCancel}>
        Cancel sign in
      </button>
    </section>
  );
}

/** Clerk owns authentication UI; local Auth owns the App's signed-in state. @example <App /> */
export function App() {
  const clerk = useClerk();
  const { isLoaded, user } = useUser();
  const accountRevision = useRef(0);
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: accountKey,
    queryFn: () => server.access.auth.getState.query(),
    retry: false,
  });
  const logout = useMutation({
    mutationFn: async () => {
      accountRevision.current++;
      await queryClient.cancelQueries({ queryKey: billingKey });
      queryClient.removeQueries({ queryKey: billingKey });
      await server.access.auth.logout.mutate();
      if (clerk.user) {
        try {
          await clerk.signOut();
        } catch {
          throw new Error(
            "Your local account was cleared, but Clerk sign out failed. Please retry.",
          );
        }
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKey }),
  });
  useEffect(() => {
    const subscription = server.events.subscribe.subscribe(undefined, {
      onData(frame) {
        if (
          frame.kind === "ready" ||
          frame.event.type === "integration.updated"
        ) {
          accountRevision.current++;
          void queryClient.cancelQueries({ queryKey: billingKey });
          queryClient.removeQueries({ queryKey: billingKey });
          void queryClient.resetQueries({ queryKey: accountKey });
        }
      },
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  if (account.isPending) return <p role="status">Loading your account…</p>;
  if (account.isError)
    return (
      <section className="account-card">
        <p role="alert">{account.error.message}</p>
        <button onClick={() => void account.refetch()}>Try again</button>
      </section>
    );
  const state = account.data;
  if (logout.isPending || logout.isError)
    return (
      <section className="account-card">
        {logout.isError ? (
          <>
            <p role="alert">{logout.error.message}</p>
            <button onClick={() => logout.mutate()}>Retry sign out</button>
          </>
        ) : (
          <p role="status">Signing out…</p>
        )}
      </section>
    );
  if (state.status === "signed-in")
    return (
      <section className="account-card">
        <p className="eyebrow">OPENCHART</p>
        <h1>Welcome, {state.user.firstName}</h1>
        <dl>
          <dt>First name</dt>
          <dd>{state.user.firstName}</dd>
          <dt>Email</dt>
          <dd>{state.user.email}</dd>
        </dl>
        <p role="status">Signed in</p>
        <BillingPanel
          key={`${state.user.id}:${accountRevision.current}`}
          userId={state.user.id}
          accountRevision={accountRevision}
        />
        <button className="secondary" onClick={() => logout.mutate()}>
          Sign out
        </button>
      </section>
    );
  if (isLoaded && user)
    return <CompleteSignIn onCancel={() => logout.mutate()} />;
  return (
    <main className="sign-in">
      <ClerkLoading>
        <p role="status">Loading sign in…</p>
      </ClerkLoading>
      <SignIn routing="hash" />
    </main>
  );
}
