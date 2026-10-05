// Purpose: Render one directory at a time using the shared sidebar structure.
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, File, Folder } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@openchart/app/components/ui/collapsible/collapsible";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@openchart/app/components/ui/sidebar";
import { Button } from "@openchart/app/components/ui/button";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import { workspaceDirectoryQueryOptions } from "@openchart/app/lib/workspace/workspace";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { TreeContextMenu, type CreateKind } from "./tree-context-menu";

interface Props {
  transport: AppTransport;
  workspaceId: string;
  directory: string;
  depth?: number;
  active?: string;
  onOpen: (path: string) => void;
  onCreate: (kind: CreateKind, directory: string) => void;
  onDelete: (path: string) => void;
}
const basename = (path: string) => path.split("/").at(-1);

function Directory({ path, ...props }: Props & { path: string }) {
  const depth = props.depth ?? 1;
  return (
    <TreeContextMenu directory={path} onCreate={props.onCreate}>
      <SidebarMenuItem>
        <Collapsible className="group/collapsible">
          <CollapsibleTrigger
            render={
              <SidebarMenuButton
                size="compact"
                tooltip={{ children: path, hidden: false }}
              />
            }
            className="group/folder"
          >
            <ChevronRight className="transition-transform group-data-[panel-open]/folder:rotate-90" />
            <Folder />
            <span>{basename(path)}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub
              className={
                depth < 6
                  ? "mx-0 translate-x-0 gap-0 py-0 pl-[7px] pr-0"
                  : "mx-0 translate-x-0 gap-0 border-l-0 p-0"
              }
            >
              <FileTree {...props} directory={path} depth={depth + 1} />
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    </TreeContextMenu>
  );
}

/** Render a directory's immediate children. The collapsible panel mounts a child query only while expanded. @example <FileTree transport={transport} workspaceId={id} directory="" {...actions} /> */
export function FileTree(props: Props) {
  const {
    transport,
    workspaceId,
    directory,
    active,
    onOpen,
    onCreate,
    onDelete,
  } = props;
  const query = useQuery(
    workspaceDirectoryQueryOptions(transport, workspaceId, directory),
  );
  const snapshot = query.data;
  useErrorToast(
    snapshot?.status === "missing"
      ? "Workspace folder is missing."
      : snapshot?.status === "unavailable"
        ? snapshot.reason
        : undefined,
    {
      id: `workspace:${workspaceId}:${directory}`,
      title: "Couldn’t open folder",
      retry: () => {
        void query.refetch();
      },
    },
  );
  if (query.isPending)
    return (
      <p role="status" className="p-2 text-sm text-muted-foreground">
        Loading files…
      </p>
    );
  if (query.isError || snapshot?.status !== "ready")
    return (
      <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
        Try again
      </Button>
    );
  return (
    <SidebarMenu>
      {snapshot.directories.map((path) => (
        <Directory key={path} {...props} path={path} />
      ))}
      {snapshot.entries.map(({ path }) => (
        <TreeContextMenu
          key={path}
          directory={directory}
          onCreate={onCreate}
          removal={{ kind: "file", onSelect: () => onDelete(path) }}
        >
          <SidebarMenuItem>
            <SidebarMenuButton
              size="compact"
              className="pl-7"
              isActive={active === path}
              onClick={() => onOpen(path)}
              tooltip={{ children: path, hidden: false }}
            >
              <File />
              <span>{basename(path)}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </TreeContextMenu>
      ))}
    </SidebarMenu>
  );
}
