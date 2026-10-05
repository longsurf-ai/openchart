// Purpose: Project saved price and Indicator alerts over their panes; Alert Rules own their values and lifecycle.
import { v2 } from "@openchart/chart-core";
import { Chart } from "@openchart/chart-core/chart/state";
import type { LineLabelPlacement } from "@openchart/chart-core/drawing/shared";
import type { BarsSeries } from "@openchart/feed";
import { Bell, BellOff, Copy, Trash2 } from "lucide-react";
import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { cn } from "@openchart/app/utils/cn";
import { useStore } from "zustand";
import { Button } from "@openchart/app/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import type { CellDefinition } from "@openchart/app/features/chart/api/queries";
import {
  getMainSeries,
  getMainSource,
} from "@openchart/app/features/chart/utils/resource";
import { useChart } from "@openchart/app/hooks/use-chart";
import { ChartAlertContext } from "./alert-button";
import { ResourceNotice } from "./resource-notice";

type Position = {
  id: string;
  x: number;
  y: number;
  width: number;
  bottom: number;
};

/**
 * Dashed alert overlays follow completed paints, so pan/zoom and scale changes
 * use exactly the renderer's geometry. Price lines use the main series of a
 * matching market; Indicator lines use that output's binding in this cell and
 * are drawn in its pane. Double-click or Enter edits a rule;
 * copy and delete remain rule operations. Unmount releases the paint listener.
 * @example <ChartAlertLines cell={cell} />
 */
export function ChartAlertLines({ cell }: { cell: CellDefinition }) {
  const chart = useChart();
  const drawing = useStore(chart.store, (state) =>
    Boolean(state.drawings.activeTool),
  );
  const alerts = useContext(ChartAlertContext);
  const [positions, setPositions] = useState<readonly Position[]>([]);
  const source = getMainSource(cell);
  const main = getMainSeries(cell).id;
  // Renderer series IDs are the Resource binding IDs.
  const lines = (alerts?.lines ?? []).flatMap((line) => {
    let seriesId: string | undefined;
    if ("inputs" in line) {
      const { inputs } = line;
      const a = inputs.listing;
      const b = source.listing;
      if (
        inputs.provider === source.provider &&
        inputs.adjustment === cell.adjustment &&
        (a.id !== undefined && b.id !== undefined
          ? a.id === b.id
          : a.symbol === b.symbol &&
            a.venue === b.venue &&
            a.mic === b.mic &&
            a.currency === b.currency)
      )
        seriesId = main;
    } else {
      const { indicatorId, output } = line.indicator;
      seriesId = cell.panes
        .flatMap((pane) => pane.series)
        .find(
          (series) =>
            series.source.kind === "indicator" &&
            series.source.indicatorId === indicatorId &&
            series.source.output === output,
        )?.id;
    }
    return seriesId ? [{ ...line, seriesId }] : [];
  });
  // Only rule identities, series and values change projection inputs; labels/actions stay React-owned.
  const geometry = JSON.stringify(
    lines.map(({ id, seriesId, threshold }) => ({ id, seriesId, threshold })),
  );
  useLayoutEffect(() => {
    const targets = JSON.parse(geometry) as {
      id: string;
      seriesId: string;
      threshold: number;
    }[];
    const project = () => {
      const state = chart.store.getState();
      const layout = Chart.computeLayout(state.config);
      const panes = v2.ChartPaneLayout.paneLayouts(
        state.panes,
        layout.areaHeight,
      );
      const next = targets.flatMap(({ id, seriesId, threshold }) => {
        const paneId = v2.ChartStateModel.paneForSeries(state, seriesId)?.id;
        const pane = panes.find((item) => item.pane.id === paneId);
        const y = pane && chart.renderer.seriesYAtValue(seriesId, threshold);
        return !pane ||
          y === undefined ||
          y < pane.top ||
          y > pane.top + pane.height
          ? []
          : [
              {
                id,
                x: layout.areaX,
                y,
                width: layout.areaWidth,
                bottom: pane.top + pane.height,
              },
            ];
      });
      setPositions((previous) =>
        previous.length === next.length &&
        previous.every(
          (item, i) =>
            item.id === next[i]!.id &&
            item.x === next[i]!.x &&
            item.y === next[i]!.y &&
            item.width === next[i]!.width &&
            item.bottom === next[i]!.bottom,
        )
          ? previous
          : next,
      );
    };
    project();
    const subscription = chart.output$.subscribe((event) => {
      if (event.type === "paint") project();
    });
    return () => subscription.unsubscribe();
  }, [chart, geometry]);
  if (!alerts) return null;
  return (
    <AlertOverlay>
      {positions.map((position) => {
        const rule = lines.find((line) => line.id === position.id);
        if (!rule) return null;
        const edit = () => {
          chart.renderer.canvas.focus();
          alerts.edit(rule.id);
        };
        return (
          <div
            key={rule.id}
            role="group"
            aria-label={`Alert ${rule.name}`}
            className="group/alert pointer-events-none absolute z-[4] h-6 -translate-y-1/2"
            style={{ left: position.x, top: position.y, width: position.width }}
          >
            <button
              type="button"
              className="pointer-events-auto absolute inset-0 w-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
              disabled={drawing}
              onMouseDown={(event) =>
                chart.renderer.canvas.dispatchEvent(
                  new MouseEvent("mousedown", event.nativeEvent),
                )
              }
              aria-label={`Edit alert line ${rule.name}`}
              onDoubleClick={edit}
              onClick={(event) => {
                if (event.detail === 0) edit();
              }}
            >
              <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-muted-foreground" />
            </button>
            {!drawing ? (
              <AlertPill
                name={rule.name}
                pending={alerts.pending}
                onEdit={edit}
                onDelete={() => alerts.remove(rule.id)}
                onDuplicate={() => {
                  const y =
                    position.y +
                    (position.y + 24 <= position.bottom ? 24 : -24);
                  const value = chart.renderer.seriesValueAtY(rule.seriesId, y);
                  if (value !== undefined)
                    alerts.duplicate(rule.id, {
                      parameter: rule.thresholdParameter,
                      value: Number(value.toPrecision(8)),
                    });
                }}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-full -translate-x-1/2 -translate-y-1/2 opacity-0 group-focus-within/alert:pointer-events-auto group-focus-within/alert:opacity-100 group-hover/alert:pointer-events-auto group-hover/alert:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
              />
            ) : null}
          </div>
        );
      })}
      {alerts.error ? (
        <div className="pointer-events-auto absolute bottom-8 left-2 right-2 z-[6] rounded-sm bg-background px-2 pb-2">
          <ResourceNotice error={alerts.error} />
        </div>
      ) : null}
    </AlertOverlay>
  );
}

/** Show linked alerts centred on and parallel to the painted drawing while hovering it or its controls.
 * Core owns hit testing and placement; this view releases pointer/paint listeners on unmount.
 * @example <ChartDrawingAlerts bindings={drawings.resourceIds} settings={cell} />
 */
export function ChartDrawingAlerts({
  bindings = [],
  settings,
}: {
  bindings?: readonly { resourceId: string; itemId: string }[];
  settings: Pick<BarsSeries, "resolution" | "session" | "adjustment">;
}) {
  const chart = useChart();
  const alerts = useContext(ChartAlertContext);
  const card = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    itemId: string;
    x: number;
    y: number;
    placement: LineLabelPlacement;
  }>();
  const visible = useStore(chart.store, (state) => {
    const item =
      hover &&
      v2.ChartStateModel.drawingItems(state).find(
        (item) => item.id === hover.itemId,
      );
    return !state.drawings.activeTool && !!item && !item.hidden;
  });
  const targets = (alerts?.drawingAlerts ?? []).flatMap((rule) => {
    const binding = bindings.find((item) => item.resourceId === rule.drawingId);
    return binding ? [{ ...rule, itemId: binding.itemId }] : [];
  });
  const identities = JSON.stringify([
    ...new Set(targets.map((rule) => rule.itemId)),
  ]);
  useLayoutEffect(() => {
    const ids = new Set(JSON.parse(identities) as string[]);
    const canvas = chart.renderer.canvas;
    // Renderer construction registers core hit testing before this mounted consumer.
    const root = canvas.parentElement?.parentElement ?? canvas;
    const withinCard = (target: EventTarget | null) =>
      target instanceof Node && card.current?.contains(target);
    const clear = () => setHover(undefined);
    const move = (event: MouseEvent) => {
      if (withinCard(event.target)) return;
      const state = chart.store.getState();
      const itemId = state.drawings.hoveredId;
      if (
        event.buttons ||
        state.drawings.activeTool ||
        !itemId ||
        !ids.has(itemId)
      )
        return clear();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const placement = chart.renderer.drawingLabelPlacement(itemId, { x, y });
      if (!placement) return clear();
      setHover((previous) =>
        previous?.itemId === itemId &&
        previous.x === x &&
        previous.y === y &&
        previous.placement.x === placement.x &&
        previous.placement.y === placement.y &&
        previous.placement.angle === placement.angle
          ? previous
          : { itemId, x, y, placement },
      );
    };
    const down = (event: MouseEvent) => {
      if (!withinCard(event.target)) clear();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    const subscription = chart.output$.subscribe((event) => {
      if (event.type !== "paint") return;
      setHover((previous) => {
        if (!previous) return previous;
        const placement = chart.renderer.drawingLabelPlacement(
          previous.itemId,
          previous,
        );
        if (!placement) return undefined;
        return placement.x === previous.placement.x &&
          placement.y === previous.placement.y &&
          placement.angle === previous.placement.angle
          ? previous
          : { ...previous, placement };
      });
    });
    clear();
    root.addEventListener("mousemove", move);
    root.addEventListener("mouseup", move);
    root.addEventListener("mouseleave", clear);
    root.addEventListener("mousedown", down);
    root.addEventListener("wheel", clear);
    window.addEventListener("blur", clear);
    window.addEventListener("keydown", escape);
    return () => {
      subscription.unsubscribe();
      root.removeEventListener("mousemove", move);
      root.removeEventListener("mouseup", move);
      root.removeEventListener("mouseleave", clear);
      root.removeEventListener("mousedown", down);
      root.removeEventListener("wheel", clear);
      window.removeEventListener("blur", clear);
      window.removeEventListener("keydown", escape);
    };
  }, [chart, identities]);
  if (!alerts || !hover || !visible) return null;
  const rules = targets.filter((rule) => rule.itemId === hover.itemId);
  if (!rules.length) return null;
  const layout = Chart.computeLayout(chart.store.getState().config);
  return (
    <AlertOverlay>
      <div
        ref={card}
        role="group"
        aria-label="Drawing alerts"
        className="pointer-events-auto absolute z-[4] flex flex-col items-center gap-1 p-3"
        style={{
          left: hover.placement.x,
          top: hover.placement.y,
          transform: `translate(-50%, -50%) rotate(${hover.placement.angle}deg)`,
          maxWidth: layout.areaWidth,
        }}
        onMouseLeave={() => setHover(undefined)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setHover(undefined);
        }}
      >
        {rules.map((rule) => (
          <div
            key={rule.id}
            role="group"
            aria-label={`Alert ${rule.name}`}
            className="min-w-0 max-w-full"
          >
            <AlertPill
              showIcon
              enabled={rule.enabled}
              inactiveReason={
                rule.inputs.resolution !== settings.resolution ||
                rule.inputs.session !== settings.session ||
                rule.inputs.adjustment !== settings.adjustment
                  ? `Inactive for this chart's interval, session or adjustment. This alert still runs on ${rule.inputs.resolution} · ${rule.inputs.session} · ${rule.inputs.adjustment}.`
                  : undefined
              }
              name={rule.name}
              pending={alerts.pending}
              className="max-w-full"
              onEdit={() => {
                chart.renderer.canvas.focus();
                setHover(undefined);
                alerts.edit(rule.id);
              }}
              onDuplicate={() => alerts.duplicate(rule.id)}
              onDelete={() => alerts.remove(rule.id)}
            />
          </div>
        ))}
      </div>
    </AlertOverlay>
  );
}

function AlertOverlay({ children }: PropsWithChildren) {
  const chart = useChart();
  const overlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = overlay.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      chart.renderer.canvas.dispatchEvent(new WheelEvent("wheel", event));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [chart]);
  return (
    <div ref={overlay} className="pointer-events-none absolute inset-0">
      {children}
    </div>
  );
}

function AlertPill({
  name,
  pending,
  onEdit,
  onDuplicate,
  onDelete,
  showIcon = false,
  enabled = true,
  inactiveReason,
  className,
}: {
  name: string;
  pending: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  showIcon?: boolean;
  enabled?: boolean;
  inactiveReason?: string;
  className?: string;
}) {
  const Icon = enabled ? Bell : BellOff;
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden rounded-sm border border-border bg-background text-xs",
        className,
      )}
    >
      {showIcon ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 rounded-none"
              aria-label={`Open alert ${name}`}
              onClick={onEdit}
            >
              <Icon
                role="img"
                aria-label={
                  !enabled
                    ? "Alert disabled"
                    : inactiveReason
                      ? "Alert uses different chart settings"
                      : "Alert enabled"
                }
                className={cn(
                  "size-3",
                  (!enabled || inactiveReason) && "text-muted-foreground",
                )}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {!enabled ? `${name} (disabled)` : (inactiveReason ?? name)}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <div className="flex min-w-0 items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 rounded-none"
              aria-label={`Duplicate ${name}`}
              disabled={pending}
              onClick={onDuplicate}
            >
              <Copy className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Duplicate alert</TooltipContent>
        </Tooltip>
        <button
          type="button"
          className="max-w-64 truncate px-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Edit ${name}`}
          onDoubleClick={onEdit}
          onClick={(event) => {
            if (showIcon || event.detail === 0) onEdit();
          }}
        >
          {name}
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 rounded-none hover:text-destructive"
              aria-label={`Delete ${name}`}
              disabled={pending}
              onClick={onDelete}
            >
              <Trash2 className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete alert</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
