// Purpose: Show sign-in or account identity and sign-out inside the shared Settings layout.
import { useOutletContext } from "react-router";
import type { AppRouteContext } from "@openchart/app/app/route-context";
import { AccountProfile } from "@openchart/app/features/account/account-profile";

import { SettingsPage } from "./settings-page";

/** Profile data stays with Clerk, independent of Config. @example <ProfileSettings /> */
export default function ProfileSettings() {
  const { transport } = useOutletContext<AppRouteContext>();
  return (
    <SettingsPage title="Profile">
      <AccountProfile transport={transport} />
    </SettingsPage>
  );
}
