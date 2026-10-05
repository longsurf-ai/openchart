// Purpose: Show account identity and sign-out inside the shared Settings layout.
import { AccountProfile } from "@openchart/app/features/account/account-profile";

import { SettingsPage } from "./settings-page";

/** Profile data stays with Clerk, independent of Config. @example <ProfileSettings /> */
export default function ProfileSettings() {
  return (
    <SettingsPage title="Profile">
      <AccountProfile />
    </SettingsPage>
  );
}
