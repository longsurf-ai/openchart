// Purpose: Render application navigation independently from the conversation list.
import {
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  LayoutDashboard,
  MessageCircle,
  Rss,
  Settings,
} from "lucide-react";
import { NavLink, useMatch } from "react-router";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@openchart/app/components/ui/sidebar";

function CreateChatButton({ onCreate }: { onCreate: () => void }) {
  return (
    <SidebarMenuButton className="jan-new-chat" onClick={onCreate}>
      <MessageCircle className="size-4 text-foreground/70" aria-hidden="true" />
      <span>New Chat</span>
      <kbd className="ml-auto text-xs text-muted-foreground">⌘ N</kbd>
    </SidebarMenuButton>
  );
}

function CreateDashboardButton({ onCreate }: { onCreate: () => void }) {
  return (
    <SidebarMenuButton
      className="jan-new-chat"
      onClick={onCreate}
      aria-keyshortcuts="Meta+D Control+D"
    >
      <LayoutDashboard
        className="size-4 text-foreground/70"
        aria-hidden="true"
      />
      <span>New Dashboard</span>
      <kbd className="ml-auto text-xs text-muted-foreground" aria-hidden="true">
        ⌘ D
      </kbd>
    </SidebarMenuButton>
  );
}

function SettingsButton() {
  const settings = useMatch("/app/settings/*");
  return (
    <SidebarMenuButton asChild isActive={settings !== null}>
      <NavLink to="/app/settings/interface">
        <Settings className="size-4 text-foreground/70" aria-hidden="true" />
        <span>Settings</span>
      </NavLink>
    </SidebarMenuButton>
  );
}

function ScheduleButton() {
  const schedule = useMatch("/app/schedule/*");
  return (
    <SidebarMenuButton
      asChild
      className="jan-new-chat"
      isActive={schedule !== null}
    >
      <NavLink to="/app/schedule">
        <CalendarClock
          className="size-4 text-foreground/70"
          aria-hidden="true"
        />
        <span>Schedule</span>
      </NavLink>
    </SidebarMenuButton>
  );
}

function FeedButton() {
  const selected = useMatch("/app/feed");
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      asChild
      className="jan-new-chat"
      isActive={selected !== null}
    >
      <NavLink to="/app/feed" onClick={() => setOpenMobile(false)}>
        <Rss className="size-4 text-foreground/70" aria-hidden="true" />
        <span>Feed</span>
      </NavLink>
    </SidebarMenuButton>
  );
}

function WorkspaceButton() {
  const selected = useMatch("/app/workspaces/*");
  return (
    <SidebarMenuButton
      asChild
      className="jan-new-chat"
      isActive={selected !== null}
    >
      <NavLink to="/app/workspaces">
        <BriefcaseBusiness
          className="size-4 text-foreground/70"
          aria-hidden="true"
        />
        <span>Workspace</span>
      </NavLink>
    </SidebarMenuButton>
  );
}

/** Render creation actions and page navigation. @example <NavMain {...creationActions} /> */
export function NavMain({
  onCreate,
  onCreateDashboard,
}: {
  onCreate: () => void;
  onCreateDashboard: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <CreateChatButton onCreate={onCreate} />
      </SidebarMenuItem>
      <SidebarMenuItem>
        <CreateDashboardButton onCreate={onCreateDashboard} />
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton asChild className="jan-new-chat">
          <NavLink
            to="/app/alerts/new"
            onClick={() => setOpenMobile(false)}
            aria-keyshortcuts="Meta+A Control+A"
          >
            <Bell className="size-4 text-foreground/70" aria-hidden="true" />
            <span>New Alert</span>
            <kbd
              className="ml-auto text-xs text-muted-foreground"
              aria-hidden="true"
            >
              ⌘ A
            </kbd>
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <FeedButton />
      </SidebarMenuItem>
      <SidebarMenuItem>
        <ScheduleButton />
      </SidebarMenuItem>
      <SidebarMenuItem>
        <WorkspaceButton />
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SettingsButton />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
