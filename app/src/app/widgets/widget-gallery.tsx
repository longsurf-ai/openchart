// Purpose: Add widgets directly from a compact menu; Dashboard owns every write.
import { ChevronDown, LayoutGrid } from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@openchart/app/components/ui/dropdown";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";
import { widgetCatalog } from "./widget-registry";

/** Add the selected widget without a configuration step. Dashboard owns pending and recovery state.
 * @example <WidgetGallery dashboard={dashboard} disabled={saving} onAddWorkspace={addWorkspace} onAddChart={addChart} />
 */
export function WidgetGallery({
  dashboard,
  disabled,
  onAddWorkspace,
  onAddChart,
}: {
  dashboard: Dashboard;
  disabled: boolean;
  onAddWorkspace: () => void;
  onAddChart: () => void;
}) {
  const hasWorkspace = dashboard.widgets.some(
    (widget) => widget.kind === "workspace",
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {/* Same outline menu trigger as New alert and Create schedule. */}
        <Button type="button" variant="outline" size="sm">
          <LayoutGrid aria-hidden />
          Widgets
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {Object.entries(widgetCatalog).map(([kind, { definition }]) => (
          <DropdownMenuItem
            key={kind}
            disabled={disabled || (kind === "workspace" && hasWorkspace)}
            onSelect={() => (kind === "chart" ? onAddChart : onAddWorkspace)()}
          >
            <definition.Icon />
            {definition.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
