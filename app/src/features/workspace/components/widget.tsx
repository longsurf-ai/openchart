// Purpose: Embed the complete Workspace file view in a dashboard placement.
import { lazy, Suspense, useCallback } from "react";
import { FolderOpen } from "lucide-react";
import { useWidget } from "@openchart/app/hooks/use-widget";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";
import { useWorkspaceFileRequests } from "@openchart/app/lib/workspace/workspace";
const WorkspaceView = lazy(() =>
  import("./workspace-view").then((module) => ({
    default: module.WorkspaceView,
  })),
);
function WorkspaceWidget() {
  const { placementId, transport } = useWidget();
  const file = useWorkspaceFileRequests((requests) => requests[placementId]);
  const opened = useCallback(
    () => useWorkspaceFileRequests.setState({ [placementId]: undefined }),
    [placementId],
  );
  return (
    <Suspense fallback={<p className="p-4">Opening workspace…</p>}>
      <WorkspaceView
        file={file}
        onFileOpen={opened}
        scopeId={placementId}
        collapsible
        transport={transport}
      />
    </Suspense>
  );
}
/** Workspace shows all registered directories; placement identity scopes editor drafts and file requests. */
export const workspaceWidget: WidgetDefinition = {
  kind: "workspace",
  title: "Workspace",
  Icon: FolderOpen,
  defaultSize: { w: 12, h: 14 },
  minSize: { w: 3, h: 6 },
  Content: WorkspaceWidget,
};
