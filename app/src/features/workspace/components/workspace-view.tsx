import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
// Purpose: Compose the sidebar file explorer and Dockview's single-group tabs.
// Preserve menu structure and shared theme tokens.
// The explorer follows its available container width, including beside Copilot.
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useAssistantContext } from "@assistant-ui/react";
import { useUnsavedChanges } from "@openchart/app/lib/unsaved-changes/unsaved-changes";
import { useDarkTheme } from "@openchart/app/lib/theme/theme";
import type { TeaLanguageSession } from "@openchart/app/features/workspace/api/tea-language-client";
import {
  DockviewReact,
  DockviewDefaultTab,
  themeDark,
  themeLight,
  type DockviewApi,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
} from "dockview-react";
import { Files } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@openchart/app/components/ui/sidebar";
import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@openchart/app/components/ui/dialog";
import {
  defaultWorkspaceQueryOptions,
  workspacesQueryOptions,
} from "@openchart/app/lib/workspace/workspace";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { WorkspaceContext, useWorkspaceView } from "./context";
import { CreateWorkspaceButton } from "./create-workspace-button";
import { FileActions } from "./file-actions";
import { ReferenceManual } from "./reference-manual";
import { WorkspaceTree } from "./workspace-tree";
import { WorkspaceFileSearch } from "./workspace-file-search";
import { DeleteFileDialog, ForgetWorkspaceDialog } from "./remove-entry-dialog";
import {
  FilePanel,
  openWorkspaceFile,
  type FilePanelParams,
} from "@openchart/app/features/workspace/components/file-panel/file-panel";
import "dockview-react/dist/styles/dockview.css";
import "./workspace-view.css";

const components = { file: FilePanel };
const tabReorderOnly = { resolve: () => null };
function EmptyFiles() {
  return (
    <div className="relative flex size-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <div className="absolute left-1 top-1">
        <HeaderNavigation />
      </div>
      <div className="absolute right-1 top-1">
        <HeaderActions />
      </div>
      <Files className="size-8" />
      <p>Choose a file from the sidebar.</p>
    </div>
  );
}
/** Active-file actions, then the file-tree toggle and the view's own actions; the empty state passes no panel. */
function HeaderActions({
  activePanel,
  containerApi,
}: Partial<IDockviewHeaderActionsProps>) {
  const { actions, collapsible } = useWorkspaceView();
  const { isMobile } = useSidebar();
  return (
    <div className="flex h-full items-center gap-1 px-1">
      {activePanel && containerApi ? (
        <FileActions panel={activePanel} containerApi={containerApi} />
      ) : null}
      {/* Shown whenever the panel can close: in widgets and the compact overlay. */}
      {collapsible || isMobile ? (
        <SidebarTrigger
          aria-label="Toggle files"
          title="Toggle files (⌘B / Ctrl+B)"
        />
      ) : null}
      {actions}
    </div>
  );
}
function HeaderNavigation() {
  const { navigation } = useWorkspaceView();
  const { open, isMobile } = useSidebar();
  return !open || isMobile ? (
    <div className="flex h-full items-center px-1">{navigation}</div>
  ) : null;
}
function FileTab(props: IDockviewPanelHeaderProps<FilePanelParams>) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <DockviewDefaultTab
        {...props}
        closeActionOverride={() => {
          if (props.params.saving) return;
          if (props.params.dirty) setConfirm(true);
          else props.api.close();
        }}
      />
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              {props.params.path} has changes that haven’t been saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={() => props.api.close()}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
/** True while an open tab owns an unsaved draft or in-flight save. @example if (hasUnsavedFiles(api)) confirmNavigation(); */
function hasUnsavedFiles(api: DockviewApi | undefined) {
  return (
    api?.panels.some((panel) => panel.params?.dirty || panel.params?.saving) ??
    false
  );
}
/** File explorer with shared draft protection; widgets may restrict it to their bound workspace. The docked file panel stays open and only resizes unless `collapsible`; a page `title` heads it at the shared 60px header height. @example <WorkspaceView transport={transport} title="Workspace" /> */
export function WorkspaceView({
  workspaceId,
  file,
  onFileOpen,
  scopeId,
  collapsible = false,
  title,
  transport,
  actions,
  navigation,
}: {
  workspaceId?: string;
  /** Opened and scrolled into view once Dockview is ready, then reported through `onFileOpen`. */
  file?: Pick<FilePanelParams, "workspaceId" | "path">;
  onFileOpen?: () => void;
  scopeId?: string;
  collapsible?: boolean;
  title?: string;
  transport: AppTransport;
  actions?: ReactNode;
  navigation?: ReactNode;
}) {
  const instanceId = useId();
  const [languageError, onLanguageError] = useState<string>();
  useErrorToast(languageError, {
    id: `language:${instanceId}`,
    title: "Tea language service failed",
  });
  const teaSessions = useRef(new Map<string, TeaLanguageSession>());
  // One reference per view, shared by the tab bar's button and ⌘ Click.
  const [reference, setReference] = useState<{ name?: string }>();
  const saves = useRef(new Map<string, () => Promise<void>>());
  useEffect(() => {
    const sessions = teaSessions.current;
    return () => {
      sessions.forEach((session) => session.dispose());
      sessions.clear();
    };
  }, []);
  const dark = useDarkTheme();
  const context = useMemo(
    () => ({
      transport,
      instanceId,
      workspaceId,
      collapsible,
      dark,
      actions,
      navigation,
      teaSessions,
      openReference: (name?: string) => setReference({ name }),
      saves,
      languageError,
      onLanguageError,
    }),
    [
      transport,
      instanceId,
      workspaceId,
      collapsible,
      dark,
      actions,
      navigation,
      languageError,
    ],
  );
  return (
    <WorkspaceContext.Provider value={context}>
      <SidebarProvider embedded open={collapsible ? undefined : true}>
        <WorkspaceContents
          transport={transport}
          dark={dark}
          workspaceId={workspaceId}
          file={file}
          onFileOpen={onFileOpen}
          scopeId={scopeId ?? instanceId}
          title={title}
        />
      </SidebarProvider>
      {reference ? (
        <ReferenceManual
          name={reference.name}
          onClose={() => setReference(undefined)}
        />
      ) : null}
    </WorkspaceContext.Provider>
  );
}
function WorkspaceContents({
  workspaceId,
  file,
  onFileOpen,
  scopeId,
  title,
  transport,
  dark,
}: {
  workspaceId?: string;
  file?: Pick<FilePanelParams, "workspaceId" | "path">;
  onFileOpen?: () => void;
  scopeId: string;
  title?: string;
  transport: AppTransport;
  dark: boolean;
}) {
  const query = useQuery(workspacesQueryOptions(transport));
  const defaultWorkspace = useQuery(defaultWorkspaceQueryOptions(transport));
  const [removing, setRemoving] = useState<
    | { kind: "file"; workspaceId: string; path: string }
    | { kind: "workspace"; workspaceId: string; root: string }
  >();
  const { isMobile, setOpenMobile } = useSidebar();
  const { navigation, collapsible } = useWorkspaceView();
  const [api, setApi] = useState<DockviewApi>();
  const fileWorkspaceId = file?.workspaceId;
  const filePath = file?.path;
  const files = useRef<HTMLDivElement>(null);
  const [active, setActive] =
    useState<Pick<FilePanelParams, "workspaceId" | "path">>();
  useAssistantContext({
    getContext: () =>
      JSON.stringify({
        view: "workspace",
        file: active
          ? { workspaceId: active.workspaceId, path: active.path }
          : null,
      }),
  });
  const changes = useUnsavedChanges();
  if (!changes)
    throw new Error("WorkspaceView requires UnsavedChangesProvider");
  useEffect(
    () => changes.register(scopeId, () => hasUnsavedFiles(api)),
    [changes, scopeId, api],
  );
  useEffect(() => {
    if (!api) return;
    const activeListener = api.onDidActivePanelChange(() =>
      setActive(api.activePanel?.params as FilePanelParams | undefined),
    );
    return () => activeListener.dispose();
  }, [api]);
  useEffect(() => {
    if (!api || !fileWorkspaceId || !filePath) return;
    openWorkspaceFile(api, fileWorkspaceId, filePath);
    // A dashboard widget may sit below the fold; jsdom has no scrollIntoView.
    files.current?.scrollIntoView?.({ block: "nearest" });
    onFileOpen?.();
  }, [api, fileWorkspaceId, filePath, onFileOpen]);
  const openFile = (workspaceId: string, path: string) => {
    if (!api) return;
    openWorkspaceFile(api, workspaceId, path);
    if (isMobile) setOpenMobile(false);
  };
  const finishRemoval = () => {
    if (!removing) return;
    for (const panel of [...(api?.panels ?? [])]) {
      const params = panel.params as FilePanelParams;
      if (
        params.workspaceId === removing.workspaceId &&
        (removing.kind === "workspace" || params.path === removing.path)
      ) {
        panel.api.close();
      }
    }
    setRemoving(undefined);
  };
  const workspaces =
    query.data?.filter(
      (workspace) => !workspaceId || workspace.id === workspaceId,
    ) ?? [];
  return (
    <>
      <Sidebar collapsible="offcanvas">
        <SidebarContent>
          <SidebarGroup>
            <WorkspaceFileSearch
              transport={transport}
              workspaces={workspaces}
              onOpen={openFile}
              disabled={!query.data}
              title={title}
              navigation={navigation}
              actions={
                !workspaceId ? (
                  <CreateWorkspaceButton transport={transport} />
                ) : null
              }
            >
              <SidebarGroupContent>
                {query.isPending ? (
                  <p
                    role="status"
                    className="p-2 text-sm text-muted-foreground"
                  >
                    Loading workspaces…
                  </p>
                ) : null}
                {query.isError ? (
                  <div className="p-2 text-sm">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void query.refetch()}
                    >
                      Try again
                    </Button>
                  </div>
                ) : null}
                <SidebarMenu>
                  {workspaces.map((workspace) => (
                    <WorkspaceTree
                      key={workspace.id}
                      workspace={workspace}
                      active={
                        active?.workspaceId === workspace.id
                          ? active.path
                          : undefined
                      }
                      onOpen={openFile}
                      onDelete={(path) =>
                        setRemoving({
                          kind: "file",
                          workspaceId: workspace.id,
                          path,
                        })
                      }
                      onForget={
                        defaultWorkspace.isSuccess &&
                        defaultWorkspace.data !== workspace.id
                          ? () =>
                              setRemoving({
                                kind: "workspace",
                                workspaceId: workspace.id,
                                root: workspace.root,
                              })
                          : undefined
                      }
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </WorkspaceFileSearch>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail
          {...(collapsible
            ? {}
            : { title: "Resize files", "aria-label": "Resize files" })}
        />
      </Sidebar>
      <div
        ref={files}
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      >
        <div className="min-h-0 flex-1">
          <DockviewReact
            className="workspace-files h-full"
            components={components}
            defaultTabComponent={FileTab}
            prefixHeaderActionsComponent={HeaderNavigation}
            rightHeaderActionsComponent={HeaderActions}
            watermarkComponent={EmptyFiles}
            theme={dark ? themeDark : themeLight}
            disableFloatingGroups
            dndStrategy="pointer"
            dropPositionResolver={tabReorderOnly}
            onReady={(event) => {
              setApi(event.api);
            }}
          />
        </div>
      </div>
      {removing?.kind === "file" ? (
        <DeleteFileDialog
          {...removing}
          onDeleted={finishRemoval}
          onClose={() => setRemoving(undefined)}
        />
      ) : removing?.kind === "workspace" ? (
        <ForgetWorkspaceDialog
          {...removing}
          onForgot={finishRemoval}
          onClose={() => setRemoving(undefined)}
        />
      ) : null}
    </>
  );
}
