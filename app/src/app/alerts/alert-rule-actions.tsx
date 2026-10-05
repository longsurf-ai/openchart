// Purpose: Share Rule lifecycle actions between the main sidebar, editor title and status banner.
import { useRef } from "react";
import { Link, useLocation, useMatch, useNavigate } from "react-router";
import {
  ChevronDownIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  TrashIcon,
} from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import {
  SidebarMenuAction,
  useSidebar,
} from "@openchart/app/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import type { AlertHealth } from "@openchart/app/features/alerts/api/monitoring";
import {
  AlertHealthIcon,
  healthSummary,
} from "@openchart/app/features/alerts/components/alert-health";
import { cn } from "@openchart/app/utils/cn";
import {
  useDeleteAlertRule,
  useDuplicateAlertRule,
  useToggleAlertRule,
  type AlertRule,
} from "@openchart/app/features/alerts/api/queries";
import { useUnsavedChanges } from "@openchart/app/lib/unsaved-changes/unsaved-changes";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

/** Guard the selected draft before a change, then refresh only accepted changes to it. */
function useRuleChange(rule: AlertRule) {
  const changes = useUnsavedChanges();
  const selected =
    useMatch("/app/alerts/rules/:ruleId")?.params.ruleId === rule.id;
  const location = useLocation();
  const currentLocation = useRef(location.key);
  currentLocation.current = location.key;
  const navigate = useNavigate();
  const scope = `alert-rule:${rule.id}`;
  const beforeChange = (action: () => void) => {
    if (selected && changes) changes.close(scope, action);
    else action();
  };
  const onChanged = (change: "updated" | "deleted") => {
    if (!selected || currentLocation.current !== location.key) return;
    changes?.clear(scope);
    void navigate(
      change === "deleted" ? "/app/feed" : location.pathname + location.search,
      { replace: true },
    );
  };
  return { beforeChange, onChanged };
}

/** Pause or enable through the same draft guard as the menu. @example const {toggle} = useRuleToggle(transport, rule); */
function useRuleToggle(transport: AppTransport, rule: AlertRule) {
  const { beforeChange, onChanged } = useRuleChange(rule);
  const mutation = useToggleAlertRule(transport);
  return {
    busy: mutation.isPending,
    toggle: () =>
      beforeChange(() =>
        mutation.mutate(
          { rule, enabled: !rule.enabled },
          { onSuccess: () => onChanged("updated") },
        ),
      ),
  };
}

/**
 * The sidebar's rule icon: a control while monitoring is fine (pause when
 * healthy, enable when paused) and a link to the rule's explanation otherwise.
 * Its tooltip and accessible name always state health and action.
 * @example <AlertRuleStatusControl transport={transport} rule={rule} health={health} />
 */
export function AlertRuleStatusControl({
  transport,
  rule,
  health,
  className,
}: {
  transport: AppTransport;
  rule: AlertRule;
  health: AlertHealth;
  className?: string;
}) {
  const { toggle, busy } = useRuleToggle(transport, rule);
  const { setOpenMobile } = useSidebar();
  const summary = healthSummary(health);
  const control = cn(
    "flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-50",
    className,
  );
  const toggles = health.state === "paused" || health.state === "healthy";
  const action = toggles ? (rule.enabled ? "Pause" : "Enable") : "Open";
  const label = `${action} ${rule.name}: ${summary}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {toggles ? (
          <button
            type="button"
            aria-label={label}
            className={control}
            disabled={busy}
            onClick={toggle}
          >
            <AlertHealthIcon health={health} />
          </button>
        ) : (
          <Link
            to={`/app/alerts/rules/${encodeURIComponent(rule.id)}`}
            aria-label={label}
            className={control}
            onClick={() => setOpenMobile(false)}
          >
            <AlertHealthIcon health={health} />
          </Link>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{summary}</TooltipContent>
    </Tooltip>
  );
}

/** Pause from the status banner, with the menu's draft guard. @example <AlertRulePauseButton transport={transport} rule={rule} /> */
export function AlertRulePauseButton({
  transport,
  rule,
}: {
  transport: AppTransport;
  rule: AlertRule;
}) {
  const { toggle, busy } = useRuleToggle(transport, rule);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      // Keep the banner's severity color on hover instead of ghost's neutral accent.
      className="hover:bg-foreground/5 hover:text-inherit dark:hover:bg-foreground/10"
      disabled={busy}
      onClick={toggle}
    >
      <PauseIcon aria-hidden="true" />
      Pause alert
    </Button>
  );
}

/** Preserve drafts on failure and refresh only accepted changes to the selected Rule. @example <AlertRuleActions transport={transport} rule={rule} inRail /> */
export function AlertRuleActions({
  transport,
  rule,
  inRail = false,
}: {
  transport: AppTransport;
  rule: AlertRule;
  inRail?: boolean;
}) {
  const { beforeChange, onChanged } = useRuleChange(rule);
  const { isMobile } = useSidebar();
  const toggle = useToggleAlertRule(transport);
  const copy = useDuplicateAlertRule(transport);
  const remove = useDeleteAlertRule(transport);
  const busy = toggle.isPending || copy.isPending || remove.isPending;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {inRail ? (
          <SidebarMenuAction
            type="button"
            showOnHover
            className="top-1"
            disabled={busy}
            aria-label={`Options for ${rule.name}`}
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </SidebarMenuAction>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label="Rule options"
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={inRail && !isMobile ? "right" : "bottom"}
        align={inRail && !isMobile ? "start" : "end"}
        className="w-44"
      >
        <DropdownMenuItem
          onSelect={() =>
            beforeChange(() =>
              toggle.mutate(
                { rule, enabled: !rule.enabled },
                { onSuccess: () => onChanged("updated") },
              ),
            )
          }
        >
          {rule.enabled ? (
            <PauseIcon aria-hidden="true" />
          ) : (
            <PlayIcon aria-hidden="true" />
          )}
          {rule.enabled ? "Pause" : "Enable"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy.mutate({ rule })}>
          <CopyIcon aria-hidden="true" />
          Copy
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() =>
            beforeChange(() =>
              remove.mutate(rule.id, { onSuccess: () => onChanged("deleted") }),
            )
          }
        >
          <TrashIcon aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
