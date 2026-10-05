// Purpose: Expose saved Alert Rules beside Dashboards and Chats in the main sidebar.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { NavLink, useMatch, useNavigate } from "react-router";
import {
  AlertRuleActions,
  AlertRuleStatusControl,
} from "@openchart/app/app/alerts/alert-rule-actions";
import { Button } from "@openchart/app/components/ui/button";
import { LoadMore } from "@openchart/app/components/ui/load-more/load-more";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@openchart/app/components/ui/sidebar";
import { useAlertHealth } from "@openchart/app/features/alerts/api/monitoring";
import { alertRulePagesQueryOptions } from "@openchart/app/features/alerts/api/queries";
import { postUnreadCountsQueryOptions } from "@openchart/app/features/posts/api/queries";
import { usePostReadState } from "@openchart/app/features/posts/hooks/use-post-read-state";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { useSidebarSort } from "@openchart/app/stores/sidebar";
import { SectionHeader } from "./section-header";

/** Query Rule navigation and exact Post counts; selection never creates or enables Rules. @example <NavAlerts transport={transport} /> */
export function NavAlerts({ transport }: { transport: AppTransport }) {
  const orderBy = useSidebarSort((state) => state.alerts);
  const rules = useInfiniteQuery(
    alertRulePagesQueryOptions(transport, orderBy),
  );
  const healthOf = useAlertHealth(transport);
  const read = usePostReadState();
  const counts = useQuery(
    postUnreadCountsQueryOptions(
      transport,
      rules.data?.map((rule) => rule.id) ?? [],
      read,
    ),
  );
  const selected = useMatch("/app/alerts/rules/:ruleId")?.params.ruleId;
  const { setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  return (
    <SidebarGroup role="group" aria-label="Alerts">
      <SectionHeader
        section="alerts"
        label="Alerts"
        createLabel="New alert"
        onCreate={() => {
          setOpenMobile(false);
          void navigate("/app/alerts/new");
        }}
      />
      {rules.isPending ? (
        <p role="status" className="px-2 py-3 text-xs text-muted-foreground">
          Loading alerts…
        </p>
      ) : null}
      {rules.isError && !rules.isFetchNextPageError ? (
        <Button variant="ghost" size="sm" onClick={() => void rules.refetch()}>
          Retry alerts
        </Button>
      ) : null}
      {rules.isSuccess && !rules.data.length ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">
          Your alerts will appear here.
        </p>
      ) : null}
      <SidebarMenu>
        {rules.data?.map((rule) => {
          const count = counts.data?.find(
            (item) => item.ruleId === rule.id,
          )?.count;
          return (
            <SidebarMenuItem key={rule.id}>
              <SidebarMenuButton
                asChild
                isActive={selected === rule.id}
                className="pl-8 pr-9"
              >
                <NavLink
                  to={`/app/alerts/rules/${encodeURIComponent(rule.id)}`}
                  title={rule.name}
                  onClick={() => setOpenMobile(false)}
                >
                  <span className="min-w-0 flex-1 truncate">{rule.name}</span>
                  {count ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  ) : null}
                </NavLink>
              </SidebarMenuButton>
              {/* A sibling of the link: the icon is its own control, never nested in navigation. */}
              <AlertRuleStatusControl
                transport={transport}
                rule={rule}
                health={healthOf(rule)}
                className="absolute left-1.5 top-1.5"
              />
              <AlertRuleActions transport={transport} rule={rule} inRail />
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
      <LoadMore
        hasMore={rules.hasNextPage && !rules.isRefetchError}
        loading={rules.isFetching}
        error={rules.isFetchNextPageError}
        onLoadMore={() => void rules.fetchNextPage()}
        label="Show more alerts"
      />
    </SidebarGroup>
  );
}
