// Purpose: Show per-axis scale controls and one shared chart settings footer.
// Layout adapted from packages/solid/src/v2/components/y-axis-controls.tsx.
import { Series, v2 } from "@openchart/chart-core";
import { Chart } from "@openchart/chart-core/chart/state";
import * as Tz from "@openchart/chart-core/tz/types";
import { Clock3, Settings2 } from "lucide-react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { useChart } from "@openchart/app/hooks/use-chart";
import type { ChartPreferencesStore } from "@openchart/app/lib/chart/preferences";
import { chartSettings } from "@openchart/app/stores/chart";
import { cn } from "@openchart/app/utils/cn";

const controlHeight = 28;
const buttonClass =
  "size-7 rounded-sm p-0 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none";

/** Use core geometry and hover state; all edits go to the existing preference owner. @example <AxisControls localStore={preferences} /> */
export function AxisControls({
  localStore,
}: {
  localStore: ChartPreferencesStore;
}) {
  const chart = useChart();
  const { config, panes, hoveredAxisId, primaryAxisId } = useStore(
    chart.store,
    useShallow((state) => {
      const main = v2.ChartStateUtils.mainSeries(state);
      return {
        config: state.config,
        panes: state.panes,
        hoveredAxisId: state.hoveredAxisId,
        primaryAxisId: main ? Series.getYAxisId(main) : undefined,
      };
    }),
  );
  const layout = Chart.computeLayout(config);
  const axes = config.yAxis.axes.filter(
    (axis) => axis.visible && axis.fixed !== false,
  );
  const paneLayouts = v2.ChartPaneLayout.paneLayouts(panes, layout.areaHeight);
  const primaryAxis = axes.find((axis) => axis.id === primaryAxisId) ?? axes[0];
  const footerBottom = Math.max(0, (layout.timeAxisHeight - controlHeight) / 2);
  const setAxis = (
    id: string,
    update: Partial<ReturnType<typeof localStore.getState>["axes"][string]>,
  ) =>
    localStore.setState((state) => ({
      axes: { ...state.axes, [id]: { ...state.axes[id], ...update } },
    }));
  return (
    <>
      {paneLayouts.flatMap(({ pane, top, height }) => {
        const paneAxes = axes.filter(
          (axis) =>
            (axis.paneId ?? v2.ChartStateModel.MAIN_PANE_ID) === pane.id,
        );
        return paneAxes.map((axis) => {
          const sideAxes = paneAxes.filter(
            (candidate) => candidate.side === axis.side,
          );
          const offset =
            (axis.side === "left"
              ? layout.leftAxisWidth
              : layout.rightAxisWidth) -
            config.yAxis.width * (sideAxes.indexOf(axis) + 1);
          return (
            <div
              key={axis.id}
              className="group/axis absolute z-[5] flex h-0 items-center justify-center"
              style={{
                top: top + height,
                width: config.yAxis.width,
                [axis.side]: offset,
              }}
              role="group"
              aria-label="Axis controls"
            >
              <div
                role="group"
                aria-label="Axis scale controls"
                className={cn(
                  "pointer-events-none absolute bottom-full left-0 flex h-7 w-full items-center justify-center gap-0.5 rounded-t-sm bg-background opacity-0 transition-opacity duration-150 group-focus-within/axis:pointer-events-auto group-focus-within/axis:opacity-100 group-hover/axis:pointer-events-auto group-hover/axis:opacity-100 motion-reduce:transition-none [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
                  hoveredAxisId === axis.id &&
                    "pointer-events-auto opacity-100",
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        buttonClass,
                        "rounded-b-none",
                        axis.autoScale && "text-foreground",
                      )}
                      aria-label="Auto scale"
                      aria-pressed={axis.autoScale}
                      onClick={() =>
                        setAxis(axis.id, { autoScale: !axis.autoScale })
                      }
                    >
                      A
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Auto scale</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        buttonClass,
                        "rounded-b-none",
                        axis.mode === "logarithmic" && "text-foreground",
                      )}
                      aria-label="Logarithmic scale"
                      aria-pressed={axis.mode === "logarithmic"}
                      disabled={axis.lockZero}
                      onClick={() =>
                        setAxis(axis.id, {
                          mode:
                            axis.mode === "logarithmic"
                              ? "normal"
                              : "logarithmic",
                        })
                      }
                    >
                      L
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Logarithmic scale</TooltipContent>
                </Tooltip>
              </div>
            </div>
          );
        });
      })}
      <div
        role="group"
        aria-label="Chart axis settings"
        className="absolute right-0 z-[5] flex h-7 items-center justify-center"
        style={{ bottom: footerBottom, width: config.yAxis.width }}
      >
        <div className="flex h-7 items-center gap-0.5 rounded-sm bg-background px-0.5">
          <TimezoneControl />
          {primaryAxis ? <AxisSettingsButton axisId={primaryAxis.id} /> : null}
        </div>
      </div>
    </>
  );
}

function AxisSettingsButton({ axisId }: { axisId: string }) {
  const chart = useChart();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={buttonClass}
          aria-label="Price axis settings"
          onClick={(event) => {
            const canvas = chart.renderer.canvas.getBoundingClientRect();
            const anchor = event.currentTarget.getBoundingClientRect();
            chart.mutate((state) => {
              delete state.seriesContextMenu;
              delete state.drawings.contextMenu;
              state.yAxisContextMenu = {
                axisId,
                floating: false,
                x: anchor.left - canvas.left,
                y: anchor.bottom - canvas.top,
              };
            });
          }}
        >
          <Settings2 className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Price axis settings</TooltipContent>
    </Tooltip>
  );
}

function TimezoneControl() {
  const chart = useChart();
  const timezone = useStore(chartSettings, (state) => state.timezone);
  const label = `Time zone: ${Tz.parse(timezone).label}`;
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open)
          chart.mutate((state) => {
            delete state.yAxisContextMenu;
            delete state.seriesContextMenu;
            delete state.drawings.contextMenu;
          });
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(
                buttonClass,
                "data-[state=open]:bg-accent data-[state=open]:text-foreground",
              )}
              aria-label={label}
            >
              <Clock3 className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="end"
        className="max-h-80 overflow-y-auto"
      >
        <DropdownMenuLabel>Time zone</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={timezone}
          onValueChange={(value) => chartSettings.setState({ timezone: value })}
        >
          {Tz.common().map((zone) => (
            <DropdownMenuRadioItem key={zone.name} value={zone.name}>
              {zone.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
