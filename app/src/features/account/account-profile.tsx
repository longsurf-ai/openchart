// Purpose: Show read-only account details and sign-out for the gated account.
import { UserAvatar, useUser } from "@clerk/react";

import { Button } from "@openchart/app/components/ui/button";
import { Card } from "@openchart/app/components/ui/settings/card";

import { useAccountConnection } from "./account-connection";

/**
 * Shows Clerk identity without editing. Sign-out closes the account gate;
 * failures keep the workspace open and report through the shared toaster.
 * @example <AccountProfile />
 */
export function AccountProfile() {
  const { user } = useUser();
  const { logout } = useAccountConnection();
  return (
    <Card title="Profile">
      <div className="flex items-center gap-3">
        <UserAvatar />
        <div className="min-w-0">
          <p className="font-medium text-foreground">{user?.fullName}</p>
          <p className="break-all text-sm">
            {user?.primaryEmailAddress?.emailAddress}
          </p>
        </div>
      </div>
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
