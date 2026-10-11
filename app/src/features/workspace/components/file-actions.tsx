// Purpose: The right side of each file panel's toolbar: Save while dirty, `.tea` actions, and one menu for the rest.
import { useContext } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DockviewPanelApi } from "dockview-react";
import {
  BookOpenIcon,
  CopyIcon,
  CopyPlusIcon,
  Ellipsis,
  ExternalLinkIcon,
  FolderOpenIcon,
} from "lucide-react";
import { URI, Utils } from "vscode-uri";
import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import { TooltipIconButton } from "@openchart/app/components/ui/tooltip-icon-button/tooltip-icon-button";
import { useAppHost } from "@openchart/app/lib/host/host";
import {
  WorkspaceFileActions,
  duplicateWorkspaceFile,
  workspaceFileQueryOptions,
  workspaceQueryKeys,
  workspaceQueryOptions,
} from "@openchart/app/lib/workspace/workspace";
import type { FilePanelParams } from "@openchart/app/features/workspace/components/file-panel/file-panel";
import { useWorkspaceView } from "./context";

/**
 * Actions for one file panel. Dockview re-renders the panel with merged params, so
 * `params` carries its live dirty/saving flags; the editor's save comes from the
 * view's `saves` registry by panel id, and app actions render for `.tea`. Copy,
 * duplicate (text only), Finder and default-app actions share one menu.
 * @example <FileActions api={api} params={params} onOpen={(path) => openWorkspaceFile(containerApi, workspaceId, path)} />
 */
export function FileActions({
  api,
  params,
  onOpen,
}: {
  api: DockviewPanelApi;
  params: FilePanelParams;
  onOpen: (path: string) => void;
}) {
  const { transport, saves, openReference } = useWorkspaceView();
  const extraActions = useContext(WorkspaceFileActions);
  const { openPath, revealPath } = useAppHost();
  const queryClient = useQueryClient();
  const { workspaceId, path, dirty, saving } = params;
  const root = useQuery(workspaceQueryOptions(transport, workspaceId)).data
    ?.root;
  // Shares the panel's read, so these labels cost no extra request.
  const file = useQuery({
    ...workspaceFileQueryOptions(transport, workspaceId, path),
    select: ({ readOnly, mediaType }) => ({ readOnly, mediaType }),
  }).data;
  const duplicate = useMutation({
    meta: { errorTitle: "Couldn’t duplicate file" },
    mutationFn: () => duplicateWorkspaceFile(transport, { workspaceId, path }),
    onSuccess: (copy) => onOpen(copy.path),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.workspace(transport.url, workspaceId),
      }),
    retry: false,
  });
  const native = useMutation({
    meta: { errorTitle: "Couldn’t open in Finder" },
    mutationFn: ({ reveal }: { reveal: boolean }) => {
      if (!root) throw new Error("The workspace folder is unavailable.");
      const absolute = Utils.joinPath(URI.file(root), path).fsPath;
      return reveal ? revealPath(absolute) : openPath(absolute);
    },
    retry: false,
  });
  // The editor's save resolves at once when there is nothing to save.
  const save = () => saves.current.get(api.id)?.() ?? Promise.resolve();
  const tea = path.endsWith(".tea");
  return (
    <div className="flex shrink-0 items-center gap-1">
      {dirty ? (
        <Button
          size="xs"
          disabled={saving}
          // The mutation cache reports failures; the draft stays for a retry.
          onClick={() => void save().catch(() => {})}
        >
          Save
        </Button>
      ) : null}
      {tea ? extraActions?.({ workspaceId, path }, save) : null}
      {tea ? (
        <TooltipIconButton
          className="size-6"
          tooltip="Tea reference"
          onClick={() => openReference()}
        >
          <BookOpenIcon />
        </TooltipIconButton>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="More file actions"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              void navigator.clipboard
                .writeText(path)
                .catch(() => toast.error("Couldn’t copy to clipboard"))
            }
          >
            <CopyIcon /> Copy path
          </DropdownMenuItem>
          {/* Copies are written as text, so only text files can be duplicated. */}
          {file?.mediaType === "text/plain" ? (
            <DropdownMenuItem
              disabled={duplicate.isPending}
              onSelect={() => duplicate.mutate()}
            >
              <CopyPlusIcon />
              {file.readOnly ? "Duplicate to edit" : "Duplicate"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={!root}
            onSelect={() => native.mutate({ reveal: true })}
          >
            <FolderOpenIcon /> Reveal in Finder
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!root}
            onSelect={() => native.mutate({ reveal: false })}
          >
            <ExternalLinkIcon /> Open in default app
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
