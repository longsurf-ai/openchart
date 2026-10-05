// Purpose: Render one registered workspace and scope file creation to its root.
import { useState } from "react";
import { ChevronRight, FilePlus, Folder } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@openchart/app/components/ui/collapsible/collapsible";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@openchart/app/components/ui/sidebar";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { useWorkspaceView } from "./context";
import { FileTree } from "./file-tree";
import { TreeContextMenu, type CreateKind } from "./tree-context-menu";
import { CreateEntryDialog } from "./create-entry-dialog";

/** Mount a workspace snapshot with scoped creation, deletion and optional forget actions. @example <WorkspaceTree workspace={workspace} onOpen={openFile} onDelete={deleteFile} /> */
export function WorkspaceTree({
  workspace,
  active,
  onOpen,
  onDelete,
  onForget,
}: {
  workspace: { id: string; root: string };
  active?: string;
  onOpen: (workspaceId: string, path: string) => void;
  onDelete: (path: string) => void;
  onForget?: () => void;
}) {
  const { transport } = useWorkspaceView();
  const [creating, setCreating] = useState<{
    kind: CreateKind;
    directory: string;
  }>();
  const name =
    workspace.root.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace.root;
  const openFile = (path: string) => onOpen(workspace.id, path);
  const startCreating = (kind: CreateKind, directory: string) =>
    setCreating({ kind, directory });
  return (
    <>
      <TreeContextMenu
        directory=""
        onCreate={startCreating}
        removal={
          onForget ? { kind: "workspace", onSelect: onForget } : undefined
        }
      >
        <SidebarMenuItem>
          <Collapsible>
            <TooltipProvider delayDuration={700}>
              <CollapsibleTrigger
                render={
                  <SidebarMenuButton
                    size="compact"
                    tooltip={{
                      children: workspace.root,
                      hidden: false,
                      className: "max-w-sm break-all",
                    }}
                  />
                }
                className="group/folder"
              >
                <ChevronRight className="transition-transform group-data-[panel-open]/folder:rotate-90" />
                <Folder />
                <span>{name}</span>
              </CollapsibleTrigger>
            </TooltipProvider>
            <SidebarMenuAction
              showOnHover
              aria-label={`New file in ${name}`}
              onClick={() => startCreating("file", "")}
            >
              <FilePlus />
            </SidebarMenuAction>
            <CollapsibleContent className="pl-2">
              <FileTree
                transport={transport}
                workspaceId={workspace.id}
                directory=""
                active={active}
                onOpen={openFile}
                onCreate={startCreating}
                onDelete={onDelete}
              />
            </CollapsibleContent>
          </Collapsible>
        </SidebarMenuItem>
      </TreeContextMenu>
      {creating !== undefined && (
        <CreateEntryDialog
          {...creating}
          workspaceId={workspace.id}
          onClose={() => setCreating(undefined)}
          onCreated={openFile}
        />
      )}
    </>
  );
}
