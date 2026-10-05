import { IndicatorLibraryProvider } from "@openchart/app/app/indicator-library/indicator-library";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
// Purpose: Compose application navigation, feature surfaces, and one backend connection across routes.
import {
  AuiConfig,
  AuiProvider,
  ModelContextClient,
} from "@assistant-ui/react";
import { useEffect, useMemo, useState } from "react";
import { Outlet, useMatch, useNavigate, useParams } from "react-router";

import { useBackendConnection } from "@openchart/app/app/connection/use-backend-connection";
import { CopilotAgent } from "@openchart/app/app/agent/copilot-agent";
import {
  CopilotControlsProvider,
  type CopilotPrefill,
} from "@openchart/app/app/agent/copilot-controls";
import { useDashboardActions } from "@openchart/app/app/dashboard/use-dashboard-actions";
import {
  SidebarProvider,
  SidebarInset,
  useSidebar,
} from "@openchart/app/components/ui/sidebar";
import type { ListedSession } from "@openchart/app/lib/agent/client";
import { RenameSessionDialog } from "@openchart/app/features/agent/components/sessions/rename-session-dialog/rename-session-dialog";
import { useAgent } from "@openchart/app/lib/agent/use-agent";
import { AgentProvider } from "@openchart/app/lib/agent/provider";
import { DashboardActionDialog } from "@openchart/app/features/dashboard/dashboard-action-dialog";
import { AccountConnectionProvider } from "@openchart/app/features/account/account-connection";
import { AccountGate } from "@openchart/app/features/account/account-gate";
import { useKeyboardShortcut } from "@openchart/app/hooks/use-keyboard-shortcut";
import { UnsavedChangesProvider } from "@openchart/app/lib/unsaved-changes/unsaved-changes";
import { WorkspaceFileNavigation } from "@openchart/app/lib/workspace/workspace";
import { WorkspaceFileMergeProvider } from "@openchart/app/app/workspace/workspace-file-merge";
import { ConfiguredTheme, type Theme } from "@openchart/app/lib/theme/theme";
import type {
  AppTransport,
  BackendConnection,
} from "@openchart/app/lib/transport/transport";

import { useAppHost } from "@openchart/app/lib/host/host";

import { LeftSidebar } from "./left-sidebar";
import { OnboardingHost } from "./trellis/host";
import { useOnboardingProgress } from "./trellis/progress";
import { CloudOfferCard } from "@openchart/app/features/billing/components/cloud-offer-card";
import { useAccount } from "@openchart/app/features/account/use-account";
import { WorkspaceBackdrop } from "./workspace-backdrop";
import type { AppRouteContext } from "./route-context";
import "./layout.css";
import { FeedProvider } from "@openchart/app/lib/feed/provider";
import { FeedTransport } from "@openchart/app/lib/feed/transport";
import { TeaClientContext } from "@openchart/app/lib/tea/context";
import { useSidebarSort } from "@openchart/app/stores/sidebar";

function AppLayoutContent({
  transport,
  connectionError,
  reconnect,
}: {
  transport: AppTransport;
  connectionError?: string;
  reconnect: () => void;
}) {
  const feed = useMemo(() => new FeedTransport(transport), [transport]);
  const dashboardActions = useDashboardActions(transport);
  const newThreadRoute = useMatch("/app");
  const savedThreadRoute = useMatch("/app/sessions/:sessionId");
  const hasCopilot = !newThreadRoute && !savedThreadRoute;
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotSessionID, setCopilotSessionID] = useState<string>();
  const [copilotPrefill, setCopilotPrefill] = useState<CopilotPrefill>();
  const copilotVisible = hasCopilot && copilotOpen;
  const sessionOrderBy = useSidebarSort((state) => state.chats);
  const agent = useAgent({ transport, sessionOrderBy });
  const [renamingSession, setRenamingSession] = useState<ListedSession>();
  const { sessionId: activeSessionID } = useParams();
  const navigate = useNavigate();
  const host = useAppHost();
  // The Cloud offer waits for billing access and never competes with onboarding.
  const account = useAccount(transport);
  const onboarding = useOnboardingProgress(
    (state) => state.workflow !== undefined,
  );
  useEffect(
    () =>
      host.onBillingReturn(() => {
        void navigate("/app/settings/subscription");
      }),
    [host, navigate],
  );
  const { isMobile, setOpenMobile } = useSidebar();
  const pageHidden = copilotVisible && isMobile;

  function selectSession(id: string) {
    void navigate(`/app/sessions/${encodeURIComponent(id)}`);
    setOpenMobile(false);
  }

  function newChat() {
    void navigate("/app");
    setOpenMobile(false);
  }

  useKeyboardShortcut({
    disabled: Boolean(dashboardActions.action || renamingSession),
    bindings: {
      n: {
        action: newChat,
        allowRepeat: true,
      },
      d: { action: dashboardActions.create, allowRepeat: false },
      a: {
        action: () => {
          setOpenMobile(false);
          void navigate("/app/alerts/new");
        },
        allowRepeat: false,
        allowInEditable: false,
      },
    },
  });
  const routeContext: AppRouteContext = {
    transport,
  };
  useErrorToast(connectionError, {
    id: "backend-connection",
    title: "Connection interrupted",
    retry: reconnect,
  });

  return (
    <FeedProvider transport={feed}>
      <AgentProvider agent={agent}>
        <UnsavedChangesProvider>
          <WorkspaceFileNavigation.Provider
            value={(file) => {
              void navigate(`/app/workspaces?${new URLSearchParams(file)}`);
            }}
          >
            <LeftSidebar
              transport={transport}
              chats={{
                active: activeSessionID,
                onSelect: selectSession,
                onRename: setRenamingSession,
              }}
              onCreateChat={newChat}
              dashboards={{
                transport,
                onRename: dashboardActions.openRename,
                onDelete: dashboardActions.openDelete,
              }}
              onCreateDashboard={dashboardActions.create}
            />
            <SidebarInset hidden={pageHidden} className="[&[hidden]]:hidden">
              <CopilotControlsProvider
                value={
                  hasCopilot
                    ? {
                        open: copilotOpen,
                        toggle: () => setCopilotOpen((value) => !value),
                        selectSession: (sessionID) => {
                          setCopilotPrefill(undefined);
                          setCopilotSessionID(sessionID);
                          setCopilotOpen(true);
                        },
                        prefill: (text) => {
                          setCopilotPrefill({ text });
                          setCopilotOpen(true);
                        },
                      }
                    : null
                }
              >
                <WorkspaceFileMergeProvider>
                  <IndicatorLibraryProvider transport={transport}>
                    <Outlet context={routeContext} />
                  </IndicatorLibraryProvider>
                </WorkspaceFileMergeProvider>
              </CopilotControlsProvider>
            </SidebarInset>
            <CopilotAgent
              transport={transport}
              sessionID={copilotSessionID}
              prefill={copilotPrefill}
              onPrefillApplied={() => setCopilotPrefill(undefined)}
              onSelectSession={setCopilotSessionID}
              open={copilotVisible}
              onClose={() => setCopilotOpen(false)}
            />
            {renamingSession ? (
              <RenameSessionDialog
                key={renamingSession.id}
                session={renamingSession}
                onClose={() => setRenamingSession(undefined)}
              />
            ) : null}
            <DashboardActionDialog
              action={dashboardActions.action}
              transport={transport}
              onClose={dashboardActions.close}
              onDeleted={dashboardActions.onDeleted}
            />
            <OnboardingHost transport={transport} />
            <CloudOfferCard
              transport={transport}
              paused={onboarding || account.data?.status !== "signed-in"}
            />
          </WorkspaceFileNavigation.Provider>
        </UnsavedChangesProvider>
      </AgentProvider>
    </FeedProvider>
  );
}

/** Keeps navigation and backend observation mounted across child routes. @example <Route element={<AppLayout connection={connection} />} /> */
export function AppLayout({
  connection,
  initialTheme = "system",
}: {
  connection: BackendConnection;
  initialTheme?: Theme;
}) {
  const { services, connectionError, attempt, reconnect } =
    useBackendConnection(connection);
  const context = AuiConfig({ modelContext: ModelContextClient() });
  return (
    <AuiProvider config={context}>
      <SidebarProvider className="jan-workspace relative">
        {services ? (
          <TeaClientContext.Provider value={services.tea}>
            <ConfiguredTheme
              transport={services.transport}
              initialTheme={initialTheme}
            />
            <AccountConnectionProvider transport={services.transport}>
              <AccountGate
                transport={services.transport}
                backdrop={<WorkspaceBackdrop />}
              >
                <AppLayoutContent
                  key={attempt}
                  transport={services.transport}
                  connectionError={connectionError}
                  reconnect={reconnect}
                />
              </AccountGate>
            </AccountConnectionProvider>
          </TeaClientContext.Provider>
        ) : (
          <p className="m-auto text-sm text-muted-foreground" role="status">
            Opening workspace…
          </p>
        )}
      </SidebarProvider>
    </AuiProvider>
  );
}
