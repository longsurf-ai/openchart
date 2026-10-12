// Purpose: Add widgets from a compact menu; Dashboard owns every placement write.
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, CodeXml, LayoutGrid, RotateCw } from "lucide-react";
import { useContext, type ReactNode } from "react";
import { Badge } from "@openchart/app/components/ui/badge";
import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@openchart/app/components/ui/dropdown";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { customWidgetList } from "@openchart/app/lib/resource/custom-widget";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";
import { WorkspaceFileNavigation } from "@openchart/app/lib/workspace/workspace";
import { customWidgetDefinition } from "./custom/custom-widget";
import { widgetCatalog } from "./widget-registry";

/** Add a widget with one selection. Dashboard owns pending and recovery state;
 * each widget owns its content selection. Saved custom widgets follow the
 * built-ins with a Custom pill and a source item that opens their file in
 * Workspace (ponytail: the first page of full Resources, sources included;
 * paginate when a page is not enough, project metadata if sources grow large).
 * @example <WidgetGallery dashboard={dashboard} transport={transport} disabled={saving} onAdd={add} />
 */
export function WidgetGallery({
  dashboard,
  transport,
  disabled,
  onAdd,
}: {
  dashboard: Dashboard;
  transport: AppTransport;
  disabled: boolean;
  onAdd: (definition: WidgetDefinition) => void;
}) {
  const custom = useQuery(customWidgetList(transport));
  const openFile = useContext(WorkspaceFileNavigation);
  const add = (
    definition: WidgetDefinition,
    title: string,
    pill?: ReactNode,
  ) => (
    <DropdownMenuItem
      key={definition.kind}
      className="flex-1"
      disabled={
        disabled ||
        dashboard.widgets.some((widget) => widget.kind === definition.kind)
      }
      onSelect={() => onAdd(definition)}
    >
      <definition.Icon />
      {title}
      {pill}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button type="button" variant="outline" size="sm">
          <LayoutGrid aria-hidden />
          Widgets
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {Object.values(widgetCatalog).map(({ definition }) =>
          add(definition, definition.title),
        )}
        {custom.error ? (
          // Keeps the menu open while the saved widgets load again.
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void custom.refetch();
            }}
          >
            <RotateCw />
            Retry loading saved widgets
          </DropdownMenuItem>
        ) : null}
        {custom.data?.map((widget) => (
          // Menu items cannot nest controls, so the source is a sibling item;
          // it stays enabled while the widget is placed.
          <div key={widget.kind} className="flex items-center">
            {add(
              customWidgetDefinition(widget.kind),
              widget.title,
              <Badge
                variant="outline"
                className="h-4 rounded bg-muted px-1 py-0 text-[10px] text-muted-foreground"
              >
                Custom
              </Badge>,
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  aria-label={`Open ${widget.source.path} in Workspace`}
                  onSelect={() => openFile?.(widget.source)}
                >
                  <CodeXml />
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent>Open in Workspace</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
