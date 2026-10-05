// Purpose: Link the persistent sidebar to Profile settings for the gated account.
import { UserAvatar, useUser } from "@clerk/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@openchart/app/components/ui/sidebar";

/** Links to Profile; the account gate guarantees a signed-in user. `actions` follow the name at the row's right edge while the name truncates. @example <AccountButton actions={<UpdateButton />} /> */
export function AccountButton({ actions }: { actions?: ReactNode }) {
  const { user } = useUser();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex items-center gap-0.5">
        <SidebarMenuButton asChild className="min-w-0 flex-1">
          <Link to="/app/settings/profile" onClick={() => setOpenMobile(false)}>
            <UserAvatar appearance={{ elements: { avatarBox: "size-6" } }} />
            <span className="truncate">{user?.fullName || "Profile"}</span>
          </Link>
        </SidebarMenuButton>
        {actions}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
