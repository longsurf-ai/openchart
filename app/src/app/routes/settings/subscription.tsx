// Purpose: Compose subscription management for the gated account in Settings.
import { useOutletContext } from "react-router";
import type { AppRouteContext } from "@openchart/app/app/route-context";
import { Subscription } from "@openchart/app/features/billing/components/subscription";
import { SettingsPage } from "./settings-page";
import { useRefreshProviderAccess } from "./provider-access";

/** Billing for the gated account; the gate remounts it for each account session. @example <SubscriptionSettings /> */
export default function SubscriptionSettings() {
  const { transport } = useOutletContext<AppRouteContext>();
  const refreshProviders = useRefreshProviderAccess(transport);
  return (
    <SettingsPage title="Subscription">
      <Subscription
        transport={transport}
        onStatusChange={refreshProviders.mutate}
        onAccessChange={refreshProviders.mutate}
      />
    </SettingsPage>
  );
}
