// Purpose: Offer sign-in, or show read-only account details and sign-out.
import { UserAvatar, useUser } from "@clerk/react";

import { Button } from "@openchart/app/components/ui/button";
import { Card } from "@openchart/app/components/ui/settings/card";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

import { useAccountConnection } from "./account-connection";
import { SignInButton } from "./sign-in-button";
import { useAccount } from "./use-account";

/**
 * Signed out of Clerk, offers the sign-in modal; `AccountConnectionProvider` then
 * hands the Cloud key to the local account in the background. Signed in, shows Clerk
 * identity without editing, or that the local account belongs to someone else,
 * with sign-out either way. Failures report through the shared toaster.
 * Requires `AccountConnectionProvider`.
 * @example <AccountProfile transport={transport} />
 */
export function AccountProfile({ transport }: { transport: AppTransport }) {
  const { user } = useUser();
  const account = useAccount(transport);
  const { logout } = useAccountConnection();
  if (!user)
    return (
      <Card title="Profile">
        <p>Sign in to use OpenChart Cloud.</p>
        <SignInButton className="mt-4" />
      </Card>
    );
  const local = account.data;
  const conflicting =
    local?.status === "signed-in" && local.user.id !== user.id;
  return (
    <Card title="Profile">
      {conflicting ? (
        <p className="font-medium text-foreground">
          OpenChart is signed in to another account on this computer
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <UserAvatar />
          <div className="min-w-0">
            <p className="font-medium text-foreground">{user.fullName}</p>
            <p className="break-all text-sm">
              {user.primaryEmailAddress?.emailAddress}
            </p>
          </div>
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        Sign out of OpenChart
      </Button>
    </Card>
  );
}
