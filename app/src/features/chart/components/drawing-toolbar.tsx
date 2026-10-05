// Purpose: Operate the focused chart's drawing tools from a vertical rail of grouped menus.
import { v2, type Drawing } from "@openchart/chart-core";
import { useQuery } from "@tanstack/react-query";
import {
  GripHorizontal,
  Lock,
  LockOpen,
  MousePointer2,
  ScanLine,
  Trash2,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import Draggable from "react-draggable";
import { useStore } from "zustand";

import { Button, type ButtonProps } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import { Separator } from "@openchart/app/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import {
  TradingToolIcon,
  type TradingToolIconName,
} from "@openchart/app/components/ui/trading-tool-icon";
import { useDrawingTool } from "@openchart/app/hooks/use-drawing-tool";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import { chartDetail } from "@openchart/app/features/chart/api/queries";
import { getGridPreset } from "@openchart/app/features/chart/utils/grid-layout";
import type { ChartRuntime } from "@openchart/app/lib/chart/store";
import { cn } from "@openchart/app/utils/cn";

type Tool = { id: Drawing.Type; label: string; icon: TradingToolIconName };

/** Select the active cell locally; drawing controls operate its registered runtime. @example <FocusedDrawingToolbar /> */
export function FocusedDrawingToolbar() {
  const { chartId, transport, focusedId, setFocused, mounted } = useChartGrid();
  const active = useQuery({
    ...chartDetail(transport, chartId),
    select: (resource) => {
      const visible = resource.cells.slice(
        0,
        getGridPreset(resource.preset).capacity,
      );
      return (visible.find((cell) => cell.id === focusedId) ?? visible[0])?.id;
    },
  });
  const chart = active.data ? mounted.get(active.data)?.chart : undefined;
  return chart && active.data ? (
    <div
      className="pointer-events-none absolute inset-0"
      onPointerDownCapture={() => setFocused(active.data!)}
      onFocusCapture={() => setFocused(active.data!)}
    >
      <DrawingToolbar chart={chart} />
    </div>
  ) : null;
}

const groups: readonly { id: string; label: string; tools: readonly Tool[] }[] =
  [
    {
      id: "drawing",
      label: "Drawing",
      tools: [
        { id: "freehand", label: "Pencil", icon: "pencil" },
        { id: "polyline", label: "Polyline", icon: "polyline" },
        { id: "curved_line", label: "Curved line", icon: "curved-line" },
      ],
    },
    {
      id: "lines",
      label: "Lines",
      tools: [
        { id: "trend_line", label: "Trend line", icon: "trendline" },
        { id: "ray", label: "Ray", icon: "ray" },
        { id: "extended_line", label: "Extended line", icon: "extended-line" },
        {
          id: "horizontal_line",
          label: "Horizontal line",
          icon: "horizontal-line",
        },
        {
          id: "horizontal_ray",
          label: "Horizontal ray",
          icon: "horizontal-ray",
        },
        { id: "vertical_line", label: "Vertical line", icon: "vertical-line" },
        { id: "cross_line", label: "Cross line", icon: "cross-line" },
      ],
    },
    {
      id: "channels",
      label: "Channels",
      tools: [
        {
          id: "parallel_channel",
          label: "Parallel channel",
          icon: "parallel-channel",
        },
      ],
    },
    {
      id: "shapes",
      label: "Shapes",
      tools: [
        { id: "rectangle", label: "Rectangle", icon: "rectangle" },
        { id: "ellipse", label: "Ellipse", icon: "ellipse" },
        { id: "circle", label: "Circle", icon: "circle" },
        { id: "triangle", label: "Triangle", icon: "triangle" },
      ],
    },
    {
      id: "volume",
      label: "Volume",
      tools: [
        {
          id: "volume_profile",
          label: "Fixed range volume profile",
          icon: "volume-profile",
        },
      ],
    },
    {
      id: "fibonacci",
      label: "Fibonacci",
      tools: [
        {
          id: "fib_retracement",
          label: "Fib retracement",
          icon: "fib-retracement",
        },
        { id: "fib_extension", label: "Fib extension", icon: "fib-extension" },
        { id: "fib_channel", label: "Fib channel", icon: "fib-channel" },
      ],
    },
    {
      id: "text",
      label: "Text",
      tools: [{ id: "text", label: "Text", icon: "text" }],
    },
  ];

function RailButton({
  label,
  active,
  className,
  children,
  ...props
}: ButtonProps & { label: string; active?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "rounded-md text-muted-foreground hover:text-foreground",
            active && "bg-accent text-foreground",
            className,
          )}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** All tools use the core's existing gestures; each group button shows its last chosen tool. @example <DrawingToolbar chart={activeChart} /> */
export function DrawingToolbar({ chart }: { chart: ChartRuntime }) {
  const railRef = useRef<HTMLDivElement>(null);
  const { activeTool, toolLocked, selectTool, toggleLock } =
    useDrawingTool(chart);
  const drawingCount = useStore(
    chart.store,
    (state) => v2.ChartStateModel.drawingItems(state).length,
  );
  const [lastPicked, setLastPicked] = useState<Record<string, Drawing.Type>>(
    {},
  );
  return (
    <Draggable
      nodeRef={railRef}
      handle="[data-drawing-drag-handle]"
      bounds="parent"
    >
      <div
        ref={railRef}
        className="chart-drawing-rail pointer-events-auto absolute left-3 top-14 z-20 flex max-h-[calc(100%_-_5rem)] w-11 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-background p-1 shadow-sm"
        role="toolbar"
        aria-label="Drawing tools"
        aria-orientation="vertical"
      >
        <RailButton
          label="Move drawing toolbar"
          data-drawing-drag-handle
          className="cursor-grab touch-none active:cursor-grabbing"
        >
          <GripHorizontal className="size-4" />
        </RailButton>
        <RailButton
          label="Select"
          active={!activeTool}
          onClick={() => selectTool(null)}
        >
          <MousePointer2 className="size-4" />
        </RailButton>
        <Separator className="my-0.5 w-6" />
        <RailButton
          label="Chart explain"
          active={activeTool === "agent_session"}
          onClick={() => selectTool("agent_session")}
        >
          <ScanLine className="size-4 rotate-90" />
        </RailButton>
        {groups.map((group) => {
          const shown =
            group.tools.find((tool) => tool.id === lastPicked[group.id]) ??
            group.tools[0]!;
          const active = group.tools.some((tool) => tool.id === activeTool);
          return (
            <DropdownMenu key={group.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={group.label}
                      className={cn(
                        "rounded-md text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
                        active && "bg-accent text-foreground",
                      )}
                    >
                      <TradingToolIcon
                        name={shown.icon}
                        className="size-4 stroke-icon-regular"
                      />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">{group.label}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                side="right"
                align="start"
                sideOffset={8}
                className="chart-drawing-menu w-52"
              >
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {group.label}
                </DropdownMenuLabel>
                {group.tools.map((tool) => (
                  <DropdownMenuItem
                    key={tool.id}
                    className={cn(activeTool === tool.id && "bg-secondary")}
                    onSelect={() => {
                      setLastPicked((previous) => ({
                        ...previous,
                        [group.id]: tool.id,
                      }));
                      selectTool(tool.id);
                    }}
                  >
                    <TradingToolIcon
                      name={tool.icon}
                      className="size-4 stroke-icon-regular text-muted-foreground"
                    />
                    {tool.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
        <Separator className="my-0.5 w-6" />
        <RailButton
          label={toolLocked ? "Keep tool selected: on" : "Keep tool selected"}
          active={toolLocked}
          onClick={toggleLock}
        >
          {toolLocked ? (
            <Lock className="size-4" />
          ) : (
            <LockOpen className="size-4" />
          )}
        </RailButton>
        <RailButton
          label="Remove all drawings"
          disabled={!drawingCount}
          className="hover:text-destructive"
          onClick={() =>
            chart.mutate((state) => {
              for (const id of v2.ChartStateModel.drawingItems(state).map(
                (item) => item.id,
              ))
                v2.ChartStateModel.removeDrawingObject(state, id);
            })
          }
        >
          <Trash2 className="size-4" />
        </RailButton>
      </div>
    </Draggable>
  );
}
