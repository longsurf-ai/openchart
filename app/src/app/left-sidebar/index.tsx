// Purpose: Compose the application-wide left navigation from independent sections.
import { useNavigate } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@openchart/app/components/ui/sidebar";
import { AccountButton } from "@openchart/app/features/account/account-button";
import { useAccount } from "@openchart/app/features/account/use-account";
import { SubscribeBanner } from "@openchart/app/features/billing/components/subscribe-banner";
import { useRefreshProviderAccess } from "@openchart/app/app/routes/settings/provider-access";

import { NavChats, type NavChatsProps } from "./nav-chats";
import { NavMain } from "./nav-main";
import { NavDashboards, type NavDashboardsProps } from "./nav-dashboards";
import { NavAlerts } from "./nav-alerts";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { UpdateButton } from "./update-button";
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
        <CloudOffer transport={transport} />
        <AccountButton
          actions={
            <>
              <UpdateButton />
              <CommunityLinks />
            </>
          }
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Billing needs the Cloud key, which arrives in the background after sign-in. */
function CloudOffer({ transport }: { transport: AppTransport }) {
  const navigate = useNavigate();
  const account = useAccount(transport);
  const refreshProviders = useRefreshProviderAccess(transport);
  if (account.data?.status !== "signed-in") return null;
  return (
    <SubscribeBanner
      transport={transport}
      onStatusChange={refreshProviders.mutate}
      onInviteFriends={() => {
        void navigate("/app/settings/subscription");
      }}
    />
  );
}
