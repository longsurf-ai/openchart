// Purpose: Compose standalone Alert Rule editing in the app shell; the main sidebar owns navigation.
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  useLocation,
  useMatch,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from "react-router";
import { SectionPage } from "@openchart/app/app/section-page";
import type { AppRouteContext } from "@openchart/app/app/route-context";
import { Button } from "@openchart/app/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@openchart/app/components/ui/empty/empty";
import { Skeleton } from "@openchart/app/components/ui/skeleton";
import {
  alertRuleQueryOptions,
  type AlertRule,
} from "@openchart/app/features/alerts/api/queries";
import { AlertRulePage } from "@openchart/app/features/alerts/components/alert-rule-dialog";
import { useUnsavedChanges } from "@openchart/app/lib/unsaved-changes/unsaved-changes";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { renderAlertListingPicker } from "./alert-listing-picker";
import { alertPromptEditor } from "./alert-prompt-editor";
import { useAlertHealth } from "@openchart/app/features/alerts/api/monitoring";
import { AlertMonitoringBanner } from "@openchart/app/features/alerts/components/alert-health";
import { AlertRuleActions, AlertRulePauseButton } from "./alert-rule-actions";
import { NewAlertMenu } from "./new-alert-menu";

const AlertDrawingChart = lazy(() =>
  import("./alert-drawing-chart").then(({ AlertDrawingChart }) => ({
    default: AlertDrawingChart,
  })),
);

/** Read the selected Rule independently of sidebar pagination; only accepted navigation remounts drafts. @example <AlertsPage /> */
export function AlertsPage() {
  const { transport } = useOutletContext<AppRouteContext>();
  const route = useMatch("/app/alerts/rules/:ruleId");
  const creating = Boolean(useMatch("/app/alerts/new"));
  const [search] = useSearchParams();
  const location = useLocation();
  const [titleTarget, setTitleTarget] = useState<HTMLSpanElement | null>(null);
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  const [bannerTarget, setBannerTarget] = useState<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const changes = useUnsavedChanges();
  const dirty = useRef(false);
  const selectedRuleId = route?.params.ruleId;
  const scope = `alert-rule:${selectedRuleId ?? "new"}`;
  const editorKey = `${selectedRuleId ?? "new"}:${search.get("action") ?? ""}:${location.key}`;
  useEffect(() => {
    dirty.current = false;
    return changes?.register(scope, () => dirty.current);
  }, [changes, scope, editorKey]);
  const close = () => {
    dirty.current = false;
    changes?.clear(scope);
    void navigate("/app/feed");
  };
  if (!creating && !selectedRuleId) return <Navigate to="/app/feed" replace />;
  return (
    <SectionPage
      heading="Alert"
      label="Alert editor"
      sections={[]}
      contentHeading={
        <span ref={setTitleTarget} className="flex min-w-0 items-center" />
      }
      actions={<NewAlertMenu />}
      footer={<div ref={setFooterTarget} />}
      banner={<div ref={setBannerTarget} />}
    >
      <RuleConfiguration
        key={editorKey}
        transport={transport}
        ruleId={selectedRuleId}
        initialActionId={search.get("action") ?? undefined}
        renderTitle={(title) =>
          titleTarget ? createPortal(title, titleTarget) : null
        }
        renderFooter={(footer) =>
          footerTarget ? createPortal(footer, footerTarget) : null
        }
        renderBanner={(banner) =>
          bannerTarget ? createPortal(banner, bannerTarget) : null
        }
        onDirtyChange={(value) => {
          dirty.current = value;
        }}
        onClose={() => {
          if (changes) changes.close(scope, close);
          else close();
        }}
      />
    </SectionPage>
  );
}

function RuleConfiguration({
  transport,
  ruleId,
  initialActionId,
  renderTitle,
  renderFooter,
  renderBanner,
  onDirtyChange,
  onClose,
}: {
  transport: AppTransport;
  ruleId?: string;
  initialActionId?: string;
  renderTitle: (title: ReactNode) => ReactNode;
  renderFooter: (footer: ReactNode) => ReactNode;
  renderBanner: (banner: ReactNode) => ReactNode;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
}) {
  const query = useQuery(alertRuleQueryOptions(transport, ruleId));
  const healthOf = useAlertHealth(transport);
  // Keep an already-mounted draft readable when its saved Rule is deleted elsewhere.
  const [loadedRule, setLoadedRule] = useState<AlertRule>();
  useEffect(() => {
    if (query.data) setLoadedRule(query.data);
  }, [query.data]);
  const currentRule = query.data ?? loadedRule;
  if (ruleId && !currentRule)
    return (
      <>
        {renderTitle("Alert rule")}
        {query.isError ? (
          <Button
            variant="outline"
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry loading rule
          </Button>
        ) : query.data === null ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>This rule is no longer available</EmptyTitle>
              <EmptyDescription>
                Published posts remain in your feed.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" asChild>
                <Link to="/app/feed">Open feed</Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Skeleton aria-label="Loading rule" role="status" className="h-40" />
        )}
      </>
    );
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      {query.data
        ? renderBanner(
            <AlertMonitoringBanner
              health={healthOf(query.data)}
              action={
                <AlertRulePauseButton transport={transport} rule={query.data} />
              }
            />,
          )
        : null}
      <AlertRulePage
        rule={currentRule}
        ruleUnavailable={query.data === null}
        transport={transport}
        initialActionId={initialActionId}
        renderListingPicker={renderAlertListingPicker}
        renderPromptEditor={alertPromptEditor(transport)}
        renderChart={(drawing) => (
          <Suspense fallback={<p role="status">Opening chart…</p>}>
            <AlertDrawingChart drawing={drawing} transport={transport} />
          </Suspense>
        )}
        renderFooter={renderFooter}
        renderTitle={(title) =>
          renderTitle(
            <span className="flex min-w-0 flex-1 items-center gap-1">
              {title}
              {query.data ? (
                <AlertRuleActions transport={transport} rule={query.data} />
              ) : null}
            </span>,
          )
        }
        onDirtyChange={onDirtyChange}
        onClose={onClose}
      />
    </div>
  );
}
