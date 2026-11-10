// Purpose: Compose the application-wide left navigation from independent sections.
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@openchart/app/components/ui/sidebar";
import { AccountButton } from "@openchart/app/features/account/account-button";

import { NavChats, type NavChatsProps } from "./nav-chats";
import { NavMain } from "./nav-main";
import { NavDashboards, type NavDashboardsProps } from "./nav-dashboards";
import { NavAlerts } from "./nav-alerts";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { UpdateButton, useUpdateReady } from "./update-button";
import { CommunityLinks } from "./community-links";

/** Keep application navigation outside the routed page. @example <LeftSidebar chats={chats} onCreateChat={newChat} dashboards={dashboards} onCreateDashboard={createDashboard} /> */
export function LeftSidebar({
  chats,
  onCreateChat,
  dashboards,
  onCreateDashboard,
  transport,
}: {
  transport: AppTransport;
  chats: NavChatsProps;
  onCreateChat: () => void;
  dashboards: NavDashboardsProps;
  onCreateDashboard: () => void;
}) {
  return (
    <Sidebar variant="floating" collapsible="offcanvas">
      <SidebarHeader className="px-1">
        <div className="flex h-9 items-center justify-between px-2">
          <span className="font-studio font-medium">OpenChart</span>
          <SidebarTrigger className="text-muted-foreground" />
        </div>
        <NavMain
          onCreate={onCreateChat}
          onCreateDashboard={onCreateDashboard}
        />
      </SidebarHeader>
      <SidebarContent className="jan-sidebar-scroll">
        <NavDashboards {...dashboards} onCreate={onCreateDashboard} />
        <NavAlerts transport={transport} />
        <NavChats {...chats} onCreate={onCreateChat} />
      </SidebarContent>
      <SidebarFooter className="px-1">
        <AccountButton actions={<AccountActions />} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** A downloaded update takes the community links' place on the account row until it is installed. */
function AccountActions() {
  const release = useUpdateReady();
  return release ? <UpdateButton release={release} /> : <CommunityLinks />;
}
