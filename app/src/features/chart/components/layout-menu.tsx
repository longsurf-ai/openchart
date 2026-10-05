// Purpose: Choose the grid shape and chart links; create the first chart in an empty dashboard.
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import {
  GRID_PRESETS,
  getGridPreset,
  type GridPreset,
} from "@openchart/app/features/chart/utils/grid-layout";
import {
  chartDetail,
  chartMutation,
  chartMutationKey,
  chooseBarsOptions,
  createCell,
} from "@openchart/app/features/chart/api/queries";
import {
  addCell,
  getMainSource,
  linkCells,
  setGridPreset,
} from "@openchart/app/features/chart/utils/resource";
import { useWidgetControls } from "@openchart/app/hooks/use-widget";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import { cn } from "@openchart/app/utils/cn";

import { ResourceNotice } from "./resource-notice";
import { SymbolPicker } from "./symbol-picker";

const presetLabel = (preset: GridPreset) =>
  preset === "1" ? "Single chart" : preset.replace("x", " × ");
const groups = [
  ...new Set(GRID_PRESETS.map((preset) => getGridPreset(preset).capacity)),
]
  .sort((a, b) => a - b)
  .map((capacity) => ({
    capacity,
    presets: GRID_PRESETS.filter(
      (preset) => getGridPreset(preset).capacity === capacity,
    ),
  }));

/** Draw a preset as its outline and shared dividers. @example <GridGlyph preset="2x2" /> */
function GridGlyph({
  preset,
  className,
}: {
  preset: GridPreset;
  className?: string;
}) {
  const { rows, columns } = getGridPreset(preset);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("size-4 shrink-0 stroke-icon-regular", className)}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      {Array.from({ length: columns - 1 }, (_, index) => {
        const x = 3 + (18 * (index + 1)) / columns;
        return <line key={`c${index}`} x1={x} y1="5" x2={x} y2="19" />;
      })}
      {Array.from({ length: rows - 1 }, (_, index) => {
        const y = 5 + (14 * (index + 1)) / rows;
        return <line key={`r${index}`} x1="3" y1={y} x2="21" y2={y} />;
      })}
    </svg>
  );
}

/** Read and edit grid structure where its controls are rendered. @example <GridPresetMenu /> */
export function GridPresetMenu({ empty = false }: { empty?: boolean }) {
  const { chartId, transport, focusedId, setFocused } = useChartGrid();
  const queryClient = useQueryClient();
  const chart = useQuery(chartDetail(transport, chartId));
  const save = useMutation(chartMutation(transport, queryClient, chartId));
  const disabled =
    useIsMutating({ mutationKey: chartMutationKey(chartId) }) > 0;
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState(false);
  useWidgetControls(open || picking);
  const resource = chart.data;
  if (!resource) return <ResourceNotice error={chart.error} />;
  const { preset } = resource;
  const cellCount = resource.cells.length;
  const hidden = cellCount - getGridPreset(preset).capacity;
  const syncListing = resource.links.some((link) => link.syncListing);
  const syncCrosshair = resource.links.some((link) => link.syncCrosshair);
  const onAdd = () => {
    if (!cellCount) {
      setPicking(true);
      return;
    }
    save.mutate(
      (latest) => {
        const visible = latest.cells.slice(
          0,
          getGridPreset(latest.preset).capacity,
        );
        const active =
          visible.find((cell) => cell.id === focusedId) ?? visible[0];
        if (!active) throw new Error("Choose a symbol to add a chart.");
        const cell = createCell(getMainSource(active), active);
        return addCell(latest, cell);
      },
      { onSuccess: (next) => setFocused(next.cells.at(-1)!.id) },
    );
  };
  return (
    <>
      {empty ? (
        <Button disabled={disabled} onClick={onAdd}>
          Add a chart
        </Button>
      ) : (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-foreground"
                  aria-label={`Grid ${presetLabel(preset)}`}
                  disabled={disabled}
                >
                  <GridGlyph preset={preset} />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Chart grid</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Chart grid
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={preset}
              onValueChange={(value) =>
                save.mutate((latest) =>
                  setGridPreset(latest, value as GridPreset, focusedId),
                )
              }
            >
              {groups.map((group) => (
                <div
                  key={group.capacity}
                  className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2 px-2 py-1"
                >
                  <span className="text-center text-sm font-medium text-muted-foreground">
                    {group.capacity}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {group.presets.map((option) => (
                      <DropdownMenuRadioItem
                        key={option}
                        value={option}
                        disabled={disabled}
                        className={cn(
                          "h-8 w-10 justify-center rounded-sm border border-transparent p-0 [&>span]:hidden",
                          option === preset && "border-ring bg-secondary",
                        )}
                        aria-label={presetLabel(option)}
                      >
                        <GridGlyph
                          preset={option}
                          className="size-5 text-foreground"
                        />
                      </DropdownMenuRadioItem>
                    ))}
                  </div>
                </div>
              ))}
            </DropdownMenuRadioGroup>
            {hidden > 0 ? (
              <p
                className="px-2 py-1 text-xs text-muted-foreground"
                role="status"
              >
                {hidden} {hidden === 1 ? "chart" : "charts"} hidden by this
                layout
              </p>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={disabled || cellCount >= 16}
              onSelect={onAdd}
            >
              <Plus />
              Add chart
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={syncListing}
              disabled={disabled}
              onCheckedChange={(checked) =>
                save.mutate((latest) =>
                  linkCells(latest, {
                    syncListing: checked,
                    syncCrosshair: latest.links.some(
                      (link) => link.syncCrosshair,
                    ),
                  }),
                )
              }
            >
              Sync symbol
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={syncCrosshair}
              disabled={disabled}
              onCheckedChange={(checked) =>
                save.mutate((latest) =>
                  linkCells(latest, {
                    syncListing: latest.links.some((link) => link.syncListing),
                    syncCrosshair: checked,
                  }),
                )
              }
            >
              Sync crosshair
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ResourceNotice error={save.error} />
      {picking ? (
        <SymbolPicker
          onSelect={async (listing, capabilities) => {
            const cell = createCell(listing, chooseBarsOptions(capabilities));
            await save.mutateAsync((latest) => addCell(latest, cell));
            setFocused(cell.id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}
