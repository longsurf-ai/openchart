// Purpose: Compose study discovery and hand submitted prompts to the ordinary Session route.
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Search } from "lucide-react";
import { useCallback, useRef, useState, type PropsWithChildren } from "react";
import { useNavigate } from "react-router";
import type * as Tea from "@openchart/tea";

import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import { useComposerRuntime } from "@openchart/app/features/agent/ag-ui/react/use-assistant-ui-runtime";
import { IndicatorLibraryContent } from "@openchart/app/features/chart/components/indicator-picker";
import { useAgentContext } from "@openchart/app/lib/agent/provider";
import {
  IndicatorLibraryNavigation,
  type IndicatorLibraryTarget,
} from "@openchart/app/lib/indicator-library/indicator-library";
import type { ComposerDraft } from "@openchart/app/lib/prompt-converter/converter";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  defaultWorkspaceQueryOptions,
  WorkspaceFileNavigation,
} from "@openchart/app/lib/workspace/workspace";

/** Supply chart controls with a library opener; retain unsent search drafts and navigate on Session creation. @example <IndicatorLibraryProvider transport={transport}><Outlet /></IndicatorLibraryProvider> */
export function IndicatorLibraryProvider({
  transport,
  children,
}: PropsWithChildren<{ transport: AppTransport }>) {
  const [target, setTarget] = useState<IndicatorLibraryTarget>();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const returnFocus = useRef<HTMLElement>();
  const show = useCallback((next: IndicatorLibraryTarget) => {
    const element = document.activeElement;
    returnFocus.current = element instanceof HTMLElement ? element : undefined;
    setTarget(next);
    setOpen(true);
  }, []);
  const restoreFocus = useCallback(() => {
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
  }, []);
  return (
    <IndicatorLibraryNavigation.Provider value={show}>
      {children}
      {target ? (
        <IndicatorLibraryModal
          transport={transport}
          target={target}
          open={open}
          onOpenChange={setOpen}
          onSelectSession={(id) => {
            setOpen(false);
            setTarget(undefined);
            void navigate(`/app/sessions/${encodeURIComponent(id)}`);
          }}
          onCloseFocus={restoreFocus}
        />
      ) : null}
    </IndicatorLibraryNavigation.Provider>
  );
}

function IndicatorLibraryModal({
  transport,
  target,
  open,
  onOpenChange,
  onSelectSession,
  onCloseFocus,
}: {
  transport: AppTransport;
  target: IndicatorLibraryTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSession: (id: string) => void;
  onCloseFocus: () => void;
}) {
  const { agent } = useAgentContext();
  const aui = useAui();
  const workspace = useQuery(defaultWorkspaceQueryOptions(transport));
  const [source, setSource] = useState<Tea.WorkspaceSources>();
  const content = useRef<HTMLDivElement>(null);
  async function start(draft: ComposerDraft) {
    const model = agent.defaultModel;
    if (!model) throw new Error("Select an available model before sending.");
    const workspaceId = source?.workspaceId ?? workspace.data;
    if (!workspaceId)
      throw new Error("Choose an available Workspace before sending.");
    const viewContext = [
      aui.modelContext.getModelContext().system,
      `Study library target: chart ${target.chartId}, cell ${target.cellId}.`,
      ...(source
        ? [
            `Selected script: workspace ${source.workspaceId}, exact path ${source.path}.`,
          ]
        : []),
    ]
      .filter(Boolean)
      .join("\n");
    const session = await agent.createSession.mutateAsync({});
    // The ordinary Session page owns pending submission and failed-draft recovery.
    onSelectSession(session.id);
    await agent.submitPrompt.mutateAsync({
      sessionID: session.id,
      draft,
      model,
      workspaceId,
      viewContext,
    });
  }
  const landingRuntime = useComposerRuntime({
    onSubmit: start,
    disabled: agent.createSession.isPending,
    sendDisabled: !agent.defaultModel || (!source && !workspace.data),
  });
  const prefill = (prompt: string, selectedSource?: Tea.WorkspaceSources) => {
    setSource(selectedSource);
    landingRuntime.thread.composer.setText(prompt);
    queueMicrotask(focusInput);
  };
  function focusInput() {
    content.current?.querySelector<HTMLElement>("textarea")?.focus();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        size="lg"
        className="flex h-4/5 flex-col gap-0 overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseFocus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusInput();
        }}
      >
        <DialogTitle className="sr-only">Study library</DialogTitle>
        <DialogDescription className="sr-only">
          Explore indicators, open your scripts, or start a chat to create a
          study.
        </DialogDescription>
        <AssistantRuntimeProvider runtime={landingRuntime}>
          <WorkspaceFileNavigation.Provider value={target.openFile}>
            <LibraryLanding
              key={`${target.chartId}:${target.cellId}`}
              transport={transport}
              target={target}
              onClose={() => onOpenChange(false)}
              workspaceRetry={
                workspace.isError && !source
                  ? () => {
                      void workspace.refetch();
                    }
                  : undefined
              }
              onUsePrompt={prefill}
              onModifyScript={(file) =>
                prefill(`Modify the indicator in @${file.path}: `, file)
              }
            />
          </WorkspaceFileNavigation.Provider>
        </AssistantRuntimeProvider>
      </DialogContent>
    </Dialog>
  );
}

function LibraryLanding({
  transport,
  target,
  onClose,
  workspaceRetry,
  onUsePrompt,
  onModifyScript,
}: {
  transport: AppTransport;
  target: IndicatorLibraryTarget;
  onClose: () => void;
  workspaceRetry?: () => void;
  onUsePrompt: (prompt: string, source?: Tea.WorkspaceSources) => void;
  onModifyScript: (source: Tea.WorkspaceSources) => void;
}) {
  const query = useAuiState((state) => state.composer.text);
  return (
    <IndicatorLibraryContent
      transport={transport}
      chartId={target.chartId}
      cellId={target.cellId}
      onClose={onClose}
      query={query}
      onUsePrompt={onUsePrompt}
      onModifyScript={onModifyScript}
      composer={
        <div className="space-y-2">
          <ComposerPrimitive.Root className="flex items-center gap-2 rounded-full border bg-background px-3 py-1 focus-within:ring-2 focus-within:ring-ring/20">
            <Search
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <ComposerPrimitive.Input
              aria-label="Search studies or create your own"
              placeholder="Search studies or create your own"
              submitMode="enter"
              rows={1}
              className="max-h-24 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            <ComposerPrimitive.Send asChild>
              <Button
                size="icon-sm"
                className="shrink-0 rounded-full"
                aria-label="Start a conversation"
              >
                <ArrowUp className="size-4" />
              </Button>
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
          {workspaceRetry ? (
            <Button variant="outline" size="sm" onClick={workspaceRetry}>
              Retry workspace
            </Button>
          ) : null}
        </div>
      }
    />
  );
}
