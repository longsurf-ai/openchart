// Purpose: Navigate the Query-owned Dashboard directory using the existing sidebar.
import { useInfiniteQuery } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { NavLink, useMatch } from "react-router";
import { LoadMore } from "@openchart/app/components/ui/load-more/load-more";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@openchart/app/components/ui/sidebar";
import {
  type Dashboard,
  dashboardsQueryOptions,
} from "@openchart/app/features/dashboard/api/queries";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { useSidebarSort } from "@openchart/app/stores/sidebar";
import { SectionHeader } from "./section-header";

/** Shared transport and feature-owned actions supplied by app composition. */
export type NavDashboardsProps = {
  transport: AppTransport;
  onRename: (dashboard: Dashboard) => void;
  onDelete: (dashboard: Dashboard) => void;
};

/** Observe the Query-owned directory and URL selection; failed reads expose a retry. @example <NavDashboards transport={transport} onRename={rename} onDelete={remove} /> */
export function NavDashboards({
  transport,
  onRename,
  onDelete,
  onCreate,
}: NavDashboardsProps & { onCreate: () => void }) {
  const orderBy = useSidebarSort((state) => state.dashboards);
  const dashboards = useInfiniteQuery(
    dashboardsQueryOptions(transport, orderBy),
  );
  const route = useMatch("/app/dashboards/:dashboardId");
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarGroup role="group" aria-label="Dashboards">
      <SectionHeader
        section="dashboards"
        label="Dashboards"
        createLabel="New dashboard"
        onCreate={onCreate}
      />
      {dashboards.isPending ? (
        <p role="status" className="px-2 py-3 text-xs text-muted-foreground">
          Loading dashboards…
        </p>
      ) : null}
      {dashboards.isError && !dashboards.isFetchNextPageError ? (
        <div className="px-2 py-3 text-xs">
          <button
            className="underline"
            onClick={() => {
              void dashboards.refetch();
            }}
          >
            Retry dashboards
          </button>
        </div>
      ) : null}
      {dashboards.isSuccess && !dashboards.data.length ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">
          Your dashboards will appear here.
        </p>
      ) : null}
      <SidebarMenu>
        {dashboards.data?.map((dashboard) => (
          <SidebarMenuItem key={dashboard.id}>
            <SidebarMenuButton
              asChild
              isActive={dashboard.id === route?.params.dashboardId}
            >
              <NavLink
                to={`/app/dashboards/${dashboard.id}`}
                onClick={() => setOpenMobile(false)}
                title={dashboard.name}
              >
                <span className="truncate">{dashboard.name}</span>
              </NavLink>
            </SidebarMenuButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction
                  showOnHover
                  aria-label={`Options for ${dashboard.name}`}
                >
                  <MoreHorizontal aria-hidden="true" />
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-48"
                side={isMobile ? "bottom" : "right"}
                align={isMobile ? "end" : "start"}
              >
                <DropdownMenuItem onSelect={() => onRename(dashboard)}>
                  <Pencil className="size-4" aria-hidden="true" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onDelete(dashboard)}
                >
                  <Trash2 className="size-4" aria-hidden="true" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      <LoadMore
        hasMore={dashboards.hasNextPage && !dashboards.isRefetchError}
        loading={dashboards.isFetching}
        error={dashboards.isFetchNextPageError}
        onLoadMore={() => {
          void dashboards.fetchNextPage();
        }}
        label="Show more dashboards"
      />
    </SidebarGroup>
  );
}
