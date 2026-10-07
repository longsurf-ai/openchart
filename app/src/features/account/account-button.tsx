// Purpose: Link the persistent sidebar to Profile settings, or open Clerk sign-in while signed out.
import { UserAvatar, useClerk, useUser } from "@clerk/react";
import { UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@openchart/app/components/ui/sidebar";

/** Links to Profile once Clerk has a user; until then "Sign in" opens Clerk's modal. `actions` follow the name at the row's right edge while the name truncates. @example <AccountButton actions={<UpdateButton />} /> */
export function AccountButton({ actions }: { actions?: ReactNode }) {
  const clerk = useClerk();
  const { user } = useUser();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex items-center gap-0.5">
        {user ? (
          <SidebarMenuButton asChild className="min-w-0 flex-1">
            <Link
              to="/app/settings/profile"
              onClick={() => setOpenMobile(false)}
            >
              <UserAvatar appearance={{ elements: { avatarBox: "size-6" } }} />
              <span className="truncate">{user.fullName || "Profile"}</span>
            </Link>
          </SidebarMenuButton>
        ) : (
          <SidebarMenuButton
            className="min-w-0 flex-1"
            onClick={() => {
              setOpenMobile(false);
              clerk.openSignIn();
            }}
          >
            <UserRound />
            <span className="truncate">Sign in</span>
          </SidebarMenuButton>
        )}
        {actions}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
