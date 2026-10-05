// Purpose: VS Code-style actions for the active file at the right of the Dockview tab bar.
import { useContext, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DockviewApi, IDockviewPanel } from "dockview-react";
import { BookOpenIcon, CopyIcon, CopyPlusIcon, SaveIcon } from "lucide-react";
import { TooltipIconButton } from "@openchart/app/components/ui/tooltip-icon-button/tooltip-icon-button";
import {
  WorkspaceFileActions,
  duplicateWorkspaceFile,
  workspaceFileQueryOptions,
  workspaceQueryKeys,
} from "@openchart/app/lib/workspace/workspace";
import {
  isTextFile,
  openWorkspaceFile,
  type FilePanelParams,
} from "@openchart/app/features/workspace/components/file-panel/file-panel";
import { useWorkspaceView } from "./context";

/** Actions for the group's active tab; they follow its live Dockview params, since the header does not re-render on a params change. Library tabs have none. Buttons are `size-8`, like the tab bar's Toggle files and view actions. @example <FileActions panel={activePanel} containerApi={containerApi} /> */
export function FileActions({
  panel,
  containerApi,
}: {
  panel: IDockviewPanel;
  containerApi: DockviewApi;
}) {
  const { saves, openReference } = useWorkspaceView();
  const extraActions = useContext(WorkspaceFileActions);
  const { workspaceId, path, dirty, saving } = useSyncExternalStore(
    (onChange) => {
      const listener = panel.api.onDidParametersChange(onChange);
      return () => listener.dispose();
    },
    () => panel.params as FilePanelParams,
  );
  if (path.startsWith("tea-lib:")) return null;
  // The editor's save resolves at once when there is nothing to save.
  const save = () => saves.current.get(panel.id)?.() ?? Promise.resolve();
  return (
    <>
      {dirty ? (
        <TooltipIconButton
          className="size-8"
          tooltip="Save"
          disabled={saving}
          // The mutation cache reports failures; the draft stays for a retry.
          onClick={() => void save().catch(() => {})}
        >
          <SaveIcon />
        </TooltipIconButton>
      ) : null}
      {path.endsWith(".tea")
        ? extraActions?.({ workspaceId, path }, save)
        : null}
      {path.endsWith(".tea") ? (
        <TooltipIconButton
          className="size-8"
          tooltip="Tea reference"
          onClick={() => openReference()}
        >
          <BookOpenIcon />
        </TooltipIconButton>
      ) : null}
      <TooltipIconButton
        className="size-8"
        tooltip="Copy path"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(path);
          } catch {
            toast.error("Couldn’t copy to clipboard");
          }
        }}
      >
        <CopyIcon />
      </TooltipIconButton>
      {isTextFile(path) ? (
        <DuplicateButton
          file={{ workspaceId, path }}
          containerApi={containerApi}
        />
      ) : null}
    </>
  );
}

function DuplicateButton({
  file,
  containerApi,
}: {
  file: { workspaceId: string; path: string };
  containerApi: DockviewApi;
}) {
  const { transport } = useWorkspaceView();
  const queryClient = useQueryClient();
  // Shares the open tab's read, so the label costs no extra request.
  const readOnly = useQuery({
    ...workspaceFileQueryOptions(transport, file.workspaceId, file.path),
    select: (read) => read.readOnly,
  }).data;
  const duplicate = useMutation({
    meta: { errorTitle: "Couldn’t duplicate file" },
    mutationFn: () => duplicateWorkspaceFile(transport, file),
    onSuccess: (copy) =>
      openWorkspaceFile(containerApi, copy.workspaceId, copy.path),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.workspace(transport.url, file.workspaceId),
      }),
    retry: false,
  });
  return (
    <TooltipIconButton
      className="size-8"
      tooltip={readOnly ? "Duplicate to edit" : "Duplicate"}
      disabled={duplicate.isPending}
      onClick={() => duplicate.mutate()}
    >
      <CopyPlusIcon />
    </TooltipIconButton>
  );
}
