// Purpose: Scope creation and removal actions to the right-clicked tree row.
import type { ReactElement } from "react";
import { FilePlus, FolderPlus, Trash2, FolderMinus } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@openchart/app/components/ui/context-menu";

export type CreateKind = "file" | "folder";

/** Targets one tree row; the primitive owns menu state and positioning. @example <TreeContextMenu directory="src" onCreate={create}><div>src</div></TreeContextMenu> */
export function TreeContextMenu({
  directory,
  onCreate,
  createDisabled = false,
  removal,
  children,
}: {
  directory: string;
  onCreate: (kind: CreateKind, directory: string) => void;
  createDisabled?: boolean;
  removal?: { kind: "file" | "workspace"; onSelect: () => void };
  children: ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent>
        <ContextMenuItem
          disabled={createDisabled}
          onClick={() => onCreate("file", directory)}
        >
          <FilePlus /> Create file
        </ContextMenuItem>
        <ContextMenuItem
          disabled={createDisabled}
          onClick={() => onCreate("folder", directory)}
        >
          <FolderPlus /> Create folder
        </ContextMenuItem>
        {removal && (
          <ContextMenuItem onClick={removal.onSelect}>
            {removal.kind === "file" ? <Trash2 /> : <FolderMinus />}
            {removal.kind === "file" ? "Delete file" : "Forget workspace"}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
