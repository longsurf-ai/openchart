// Purpose: Register a folder selected by the host; the workspace list refreshes from Query.
import { FolderPlus } from "lucide-react";
import { SidebarGroupAction } from "@openchart/app/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { useAppHost } from "@openchart/app/lib/host/host";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { useCreateWorkspace } from "@openchart/app/lib/workspace/workspace";

/** Open the app host's native folder picker and report registration failures. @example <CreateWorkspaceButton transport={transport} /> */
export function CreateWorkspaceButton({
  transport,
}: {
  transport: AppTransport;
}) {
  const { pickDirectory } = useAppHost();
  const create = useCreateWorkspace(transport, pickDirectory);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarGroupAction
          className="relative right-auto top-auto disabled:pointer-events-none disabled:opacity-50"
          aria-label="Create workspace"
          disabled={create.isPending}
          onClick={() => create.mutate()}
        >
          <FolderPlus />
        </SidebarGroupAction>
      </TooltipTrigger>
      <TooltipContent>Create workspace</TooltipContent>
    </Tooltip>
  );
}
