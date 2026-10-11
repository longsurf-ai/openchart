// Purpose: Add widgets from a compact menu; Dashboard owns every placement write.
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

/** A widget the gallery can add. */
export type WidgetKind = keyof typeof widgetCatalog;

/** Add a widget with one selection. Dashboard owns pending and recovery state;
 * each widget owns its content selection.
 * @example <WidgetGallery dashboard={dashboard} disabled={saving} onAdd={add} />
 */
export function WidgetGallery({
  dashboard,
  disabled,
  onAdd,
}: {
  dashboard: Dashboard;
  disabled: boolean;
  onAdd: (kind: WidgetKind) => void;
}) {
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
        {(Object.keys(widgetCatalog) as WidgetKind[]).map((kind) => {
          const { definition } = widgetCatalog[kind];
          return (
            <DropdownMenuItem
              key={kind}
              disabled={
                disabled ||
                dashboard.widgets.some((widget) => widget.kind === kind)
              }
              onSelect={() => onAdd(kind)}
            >
              <definition.Icon />
              {definition.title}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
