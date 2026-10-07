// Purpose: Compose subscription management for the signed-in local account in Settings.
import { useOutletContext } from "react-router";
import type { AppRouteContext } from "@openchart/app/app/route-context";
import { Card } from "@openchart/app/components/ui/settings/card";
import { SignInButton } from "@openchart/app/features/account/sign-in-button";
import { useAccount } from "@openchart/app/features/account/use-account";
import { Subscription } from "@openchart/app/features/billing/components/subscription";
import { cloudPlan } from "@openchart/app/features/billing/cloud-plan";
import { SettingsPage } from "./settings-page";
import { useRefreshProviderAccess } from "./provider-access";

/** Billing needs the local account's Cloud key, so a signed-out account is offered sign-in; Billing remounts per user. @example <SubscriptionSettings /> */
export default function SubscriptionSettings() {
  const { transport } = useOutletContext<AppRouteContext>();
  const account = useAccount(transport);
  const refreshProviders = useRefreshProviderAccess(transport);
  const local = account.data;
  return (
    <SettingsPage title="Subscription">
      {local?.status === "signed-in" ? (
        <Subscription
          key={local.user.id}
          transport={transport}
          onStatusChange={refreshProviders.mutate}
          onAccessChange={refreshProviders.mutate}
        />
      ) : local ? (
        <div className="w-full max-w-3xl">
          <Card title={cloudPlan.name}>
            <p>Sign in to subscribe or manage your subscription.</p>
            <SignInButton className="mt-4" />
          </Card>
        </div>
      ) : null}
    </SettingsPage>
  );
}
