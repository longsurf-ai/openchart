// Purpose: Pick the one registered Workspace a view shows, and manage registrations from the same menu.
import {
  ChevronsUpDown,
  Folder,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  ListCollapse,
} from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import { useAppHost } from "@openchart/app/lib/host/host";
import { useCreateWorkspace } from "@openchart/app/lib/workspace/workspace";
import { useWorkspaceView } from "./context";

type Workspace = { id: string; root: string };

/** A registration's display name: its folder's name, or the whole root for a drive. */
export const workspaceName = (root: string) =>
  root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;

/**
 * Scheme-style Workspace picker. Registering a folder selects it; Forget is offered
 * only for non-default registrations and never deletes files. A `locked` view shows
 * its one Workspace without a menu.
 * @example <WorkspaceSwitcher workspaces={list} selected={id} onSelect={select} onForget={forget} onReveal={reveal} onCollapse={collapse} />
 */
export function WorkspaceSwitcher({
  workspaces,
  selected,
  defaultId,
  locked = false,
  onSelect,
  onForget,
  onReveal,
  onCollapse,
}: {
  workspaces: readonly Workspace[];
  selected?: Workspace;
  defaultId?: string;
  locked?: boolean;
  onSelect: (workspaceId: string) => void;
  onForget: (workspace: Workspace) => void;
  onReveal: (workspace: Workspace) => void;
  onCollapse: () => void;
}) {
  const { transport } = useWorkspaceView();
  const { pickDirectory } = useAppHost();
  const register = useCreateWorkspace(transport, pickDirectory);
  const label = (
    <>
      <Folder aria-hidden className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">
        {selected ? workspaceName(selected.root) : "Workspace"}
      </span>
    </>
  );
  if (locked)
    return (
      <span
        title={selected?.root}
        className="flex h-7 min-w-0 items-center gap-1.5 px-2 text-sm font-medium [&_svg]:size-4"
      >
        {label}
      </span>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title={selected?.root}
          aria-label={`Browse workspace: ${selected ? workspaceName(selected.root) : "none"}`}
          className="h-7 min-w-0 justify-start gap-1.5 px-2 font-medium"
          onKeyDown={(event) => event.stopPropagation()}
        >
          {label}
          <ChevronsUpDown
            aria-hidden
            className="ml-auto shrink-0 text-muted-foreground"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuRadioGroup
          value={selected?.id}
          onValueChange={(id) => onSelect(id)}
        >
          {workspaces.map((workspace) => (
            <DropdownMenuRadioItem
              key={workspace.id}
              value={workspace.id}
              title={workspace.root}
            >
              <span className="truncate">{workspaceName(workspace.root)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!selected}
          onSelect={() => selected && onReveal(selected)}
        >
          <FolderOpen /> Reveal in Finder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCollapse}>
          <ListCollapse /> Collapse folders
        </DropdownMenuItem>
        {selected && defaultId && selected.id !== defaultId ? (
          <DropdownMenuItem onSelect={() => onForget(selected)}>
            <FolderMinus /> Forget workspace
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={register.isPending}
          onSelect={() =>
            register.mutate(undefined, {
              onSuccess: (workspace) => {
                if (workspace) onSelect(workspace.id);
              },
            })
          }
        >
          <FolderPlus /> Add folder…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
