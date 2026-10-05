// Purpose: Admit the workspace for a Clerk session unless the local account belongs to someone else; Cloud access connects in the background.
import { SignIn, useSession, useUser } from "@clerk/react";
import { Fragment, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Button } from "@openchart/app/components/ui/button";
import { Empty } from "@openchart/app/components/ui/empty/empty";
import { Spinner } from "@openchart/app/components/ui/spinner";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

import { useAccountConnection } from "./account-connection";
import { useAccount } from "./use-account";

/** A small card that stays legible over the dimmed backdrop in either theme. */
function GateCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg">
      {children}
    </div>
  );
}

/** Progress without actions. It fades in late, so a wait that ends quickly shows only the dimmed backdrop; the spinner's label is what screen readers announce. */
function GateStatus({ children }: { children: string }) {
  return (
    <div className="delay-500 duration-200 animate-in fade-in fill-mode-both motion-reduce:animate-none">
      <GateCard>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" className="text-current" label={children} />
          <p aria-hidden="true">{children}</p>
        </div>
      </GateCard>
    </div>
  );
}

/**
 * Renders `children` while a Clerk session exists and the local account is
 * either the same user or signed out; otherwise shows Clerk sign-in, a
 * different-account stop, or account recovery over the dimmed `backdrop`, like
 * a dialog. A signed-out local account receives its Cloud key in the background
 * (`AccountConnectionProvider`); Cloud consumers wait for it, and a failed
 * handoff is a toast with Retry. Only the first account read blocks: later
 * refreshes keep the workspace mounted. The workspace is keyed by Clerk
 * session, so code inside never sees a conflicting account.
 * Requires `AccountConnectionProvider`.
 * @example <AccountGate transport={transport} backdrop={<Outline />}><Workspace /></AccountGate>
 */
export function AccountGate({
  transport,
  backdrop,
  children,
}: {
  transport: AppTransport;
  /** Static content without data or controls, dimmed behind every gate screen. */
  backdrop: ReactNode;
  children: ReactNode;
}) {
  const { isLoaded, user } = useUser();
  const { session } = useSession();
  const account = useAccount(transport);
  const { completion, logout } = useAccountConnection();
  const local = account.data;
  // Identity is the only thing worth waiting for: another user's local account
  // blocks, while a signed-out one is connected in the background.
  const conflicting =
    local?.status === "signed-in" && local.user.id !== user?.id;
  const admitted = isLoaded && !!local && !conflicting && !logout.isPending;
  useErrorToast(admitted && session ? completion.error : undefined, {
    id: "account-connection",
    title: "Couldn’t finish signing in",
    retry: () => completion.mutate(),
  });

  if (admitted && user && session)
    return <Fragment key={session.id}>{children}</Fragment>;

  let screen: ReactNode;
  if (!isLoaded || account.isPending)
    screen = <GateStatus>Opening workspace…</GateStatus>;
  else if (logout.isPending) screen = <GateStatus>Signing out…</GateStatus>;
  else if (!local)
    screen = (
      <GateCard>
        <h2 className="font-medium">Account unavailable</h2>
        <Button variant="outline" onClick={() => void account.refetch()}>
          Retry
        </Button>
      </GateCard>
    );
  else if (!user || !session) screen = <SignIn routing="hash" />;
  else
    screen = (
      <GateCard>
        <h2 className="font-medium">
          OpenChart is signed in to another account on this computer
        </h2>
        <Button variant="outline" onClick={() => logout.mutate()}>
          Sign out
        </Button>
      </GateCard>
    );
  return (
    <>
      {/* Decoration must never block sign-in; a failing backdrop just disappears. */}
      <ErrorBoundary fallback={null}>{backdrop}</ErrorBoundary>
      {/* Dims the backdrop the way the shared Dialog overlay does. */}
      <main
        data-account-gate
        className="fixed inset-0 z-50 flex bg-black/50 backdrop-blur"
      >
        <Empty>{screen}</Empty>
      </main>
    </>
  );
}
