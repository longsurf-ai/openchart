// Purpose: Open Workspace files from a widget in a Workspace widget docked beside it, not on the full page.
import { useMutation } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { workspaceWidget } from "@openchart/app/features/workspace/components/widget";
import { useWidget } from "@openchart/app/hooks/use-widget";
import {
  requestWorkspaceFile,
  WorkspaceFileNavigation,
} from "@openchart/app/lib/workspace/workspace";

/** Reuse the Dashboard's Workspace widget (it shows every registered folder) or dock one on this placement's right, and request the file there before the dock saves, so the Dashboard's Retry still opens it. A busy Dashboard fails the open with a toast. @example <WorkspaceFileBeside><ChartContent /></WorkspaceFileBeside> */
export function WorkspaceFileBeside({ children }: PropsWithChildren) {
  const { placeBeside } = useWidget();
  const open = useMutation({
    meta: { errorTitle: "Couldn’t open this file" },
    retry: false,
    mutationFn: async (file: { workspaceId: string; path: string }) =>
      requestWorkspaceFile(placeBeside(workspaceWidget), file),
  });
  return (
    <WorkspaceFileNavigation.Provider value={open.mutate}>
      {children}
    </WorkspaceFileNavigation.Provider>
  );
}
