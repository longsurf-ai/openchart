// Purpose: Offer a quick alert beside a pane's value axis: main price and the pane's Indicator outputs; the app supplies creation.
import { Series, v2 } from "@openchart/chart-core";
import { Chart } from "@openchart/chart-core/chart/state";
import { Draw } from "@openchart/chart-core/render";
import { barsSeries, type BarsSeries } from "@openchart/feed";
import { Bell, Bot, Plus } from "lucide-react";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { Button } from "@openchart/app/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import { useChart } from "@openchart/app/hooks/use-chart";
import type { ChartResource } from "@openchart/app/features/chart/api/queries";
import { getMainSource } from "@openchart/app/features/chart/utils/resource";

/** A price click captures the complete watched series and its raw price. */
type MarketAlertTarget = { inputs: BarsSeries; threshold: number };
/** An Indicator output click follows that Indicator; `label` leads the rule name. */
export type ChartAlertTarget =
  | MarketAlertTarget
  | {
      indicator: { indicatorId: string; output: string; label: string };
      threshold: number;
    };

/** A single-threshold rule projected by app composition on price or an
 * Indicator output; it owns no Drawing Resource. */
export type ChartAlertLine = {
  id: string;
  name: string;
  threshold: number;
  /** The rule parameter holding `threshold`; a copy writes its value there. */
  thresholdParameter: string;
} & (
  | { inputs: BarsSeries }
  | { indicator: { indicatorId: string; output: string } }
);
/** Drawing creation uses the saved envelope ID, not its renderer-local item ID. */
export type ChartDrawingAlertTarget = {
  drawingId: string;
  name: string;
  type: string;
  inputs: BarsSeries;
};

/** App composition supplies alert creation without coupling Chart to Alerts or Agent. */
export const ChartAlertContext = createContext<
  | {
      create: (target: ChartAlertTarget, agent: boolean) => void;
      createDrawing?: (target: ChartDrawingAlertTarget) => void;
      pending: boolean;
      agentAvailable: boolean;
      lines: readonly ChartAlertLine[];
      drawingAlerts?: readonly {
        id: string;
        name: string;
        drawingId: string;
        enabled: boolean;
        inputs: BarsSeries;
      }[];
      edit: (id: string) => void;
      duplicate: (
        id: string,
        threshold?: { parameter: string; value: number },
      ) => void;
      remove: (id: string) => void;
      error: Error | null;
    }
  | undefined
>(undefined);

type Anchor = { targets: readonly ChartAlertTarget[]; x: number; y: number };

/** Each mounted Indicator's outputs an alert can read, by Indicator ID. */
export type AlertableOutputs = Map<string, ReadonlySet<string>>;

/**
 * Follow the pointer near a pane's value axis, then freeze its targets while
 * the menu is open. The main pane offers its price first; every pane offers each
 * alertable Indicator output it shows. Raw values come from the renderer's painted scale.
 * Listeners belong to this cell and are released on unmount; composition handles errors.
 * @example <ChartAlertButton cell={cell} alertable={alertable} />
 */
export function ChartAlertButton({
  cell,
  alertable,
}: {
  cell: ChartResource["cells"][number];
  /** Filled by each IndicatorSource from its compiled outputs. */
  alertable: AlertableOutputs;
}) {
  const chart = useChart();
  const alerts = useContext(ChartAlertContext);
  const [hover, setHover] = useState<Anchor>();
  const [anchor, setAnchor] = useState<Anchor>();

  /** The pane at `y`, its first watched series' axis, and every series it watches. */
  const watchedAt = useCallback(
    (y: number) => {
      const state = chart.store.getState();
      const main = v2.ChartStateModel.mainSeries(state);
      const layout = Chart.computeLayout(state.config);
      const pane = v2.ChartPaneLayout.paneLayouts(
        state.panes,
        layout.areaHeight,
      ).find((item) => y >= item.top && y <= item.top + item.height);
      if (!main || !pane) return undefined;
      const inPane = (id: string) =>
        v2.ChartStateModel.paneForSeries(state, id)?.id === pane.pane.id;
      // Renderer series IDs are the Resource binding IDs.
      const series: {
        id: string;
        indicator?: { indicatorId: string; output: string };
      }[] = [
        ...(inPane(main.id) ? [{ id: main.id }] : []),
        ...cell.panes
          .flatMap((item) => item.series)
          .flatMap(({ id, source }) =>
            source.kind === "indicator" && inPane(id)
              ? [{ id, indicator: source }]
              : [],
          ),
      ];
      const first =
        series[0] && v2.ChartStateModel.getSeries(state, series[0].id);
      const axis =
        first &&
        state.config.yAxis.axes.find(
          (item) => item.id === Series.getYAxisId(first),
        );
      return axis ? { layout, pane, axis, series } : undefined;
    },
    [cell, chart],
  );

  const targetsAt = useCallback(
    (y: number): ChartAlertTarget[] => {
      const source = getMainSource(cell);
      return (watchedAt(y)?.series ?? []).flatMap(
        ({ id, indicator }): ChartAlertTarget[] => {
          const value = chart.renderer.seriesValueAtY(id, y);
          if (value === undefined) return [];
          // Match Events' numeric precision without rounding small prices to zero.
          const threshold = Number(value.toPrecision(8));
          if (!indicator)
            return [
              {
                threshold,
                inputs: barsSeries(source, cell),
              },
            ];
          return alertable.get(indicator.indicatorId)?.has(indicator.output)
            ? [
                {
                  threshold,
                  indicator: {
                    indicatorId: indicator.indicatorId,
                    output: indicator.output,
                    label: `${source.listing.symbol} ${indicator.output}`,
                  },
                },
              ]
            : [];
        },
      );
    },
    [alertable, cell, chart, watchedAt],
  );

  useEffect(() => {
    if (!alerts || anchor) return;
    const root = chart.renderer.canvas.closest("[data-chart-cell]");
    if (!root) return;
    const clear = () => setHover(undefined);
    const move = (pointer: PointerEvent) => {
      const bounds = chart.renderer.canvas.getBoundingClientRect();
      if (
        pointer.clientX < bounds.left ||
        pointer.clientX > bounds.right ||
        pointer.clientY < bounds.top ||
        pointer.clientY > bounds.bottom
      )
        return clear();
      const x = pointer.clientX - bounds.left;
      const y = pointer.clientY - bounds.top;
      const watched = watchedAt(y);
      if (
        !watched?.axis.visible ||
        watched.axis.fixed === false ||
        chart.store.getState().drawings.activeTool ||
        pointer.buttons
      )
        return clear();
      const { layout, pane, axis } = watched;
      const edge =
        axis.side === "left" ? layout.areaX : layout.areaX + layout.areaWidth;
      if (Math.abs(x - edge) > 32) return clear();
      const targets = targetsAt(y);
      if (!targets.length) return clear();
      setHover({
        targets,
        x: edge + (axis.side === "left" ? 10 : -10),
        y: Math.max(pane.top + 9, Math.min(pane.top + pane.height - 9, y)),
      });
    };
    // V1 tracks before chart/overlay handlers and independently of canvas repaint.
    window.addEventListener("pointermove", move, {
      capture: true,
      passive: true,
    });
    root.addEventListener("pointerleave", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("pointermove", move, { capture: true });
      root.removeEventListener("pointerleave", clear);
      window.removeEventListener("blur", clear);
    };
  }, [alerts, anchor, chart, targetsAt, watchedAt]);

  const target = anchor ?? hover;
  if (!alerts || !target) return null;
  return (
    <DropdownMenu
      open={anchor !== undefined}
      onOpenChange={(open) => {
        // The scale or symbol can change while the pointer stays still.
        const targets = open ? targetsAt(target.y) : [];
        setAnchor(targets.length ? { ...target, targets } : undefined);
        if (!open) setHover(undefined);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              className="absolute z-[5] -translate-x-1/2 -translate-y-1/2 rounded-sm p-0 transition-none"
              style={{
                left: target.x,
                top: target.y,
                width: Draw.VALUE_TAG_HEIGHT,
                height: Draw.VALUE_TAG_HEIGHT,
              }}
              aria-label={`Add alert at ${target.targets[0]!.threshold}`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Plus className="size-3" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">Add alert</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="left"
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          chart.renderer.canvas.focus();
        }}
      >
        {target.targets.map((item, index) => {
          const heading = `${"indicator" in item ? item.indicator.output : item.inputs.listing.symbol} · ${item.threshold}`;
          return (
            <Fragment key={index}>
              {index ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup aria-label={heading}>
                <DropdownMenuLabel>{heading}</DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={alerts.pending}
                  onSelect={() => alerts.create(item, false)}
                >
                  <Bell className="size-4" /> Add alert at threshold
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={alerts.pending || !alerts.agentAvailable}
                  onSelect={() => alerts.create(item, true)}
                >
                  <Bot className="size-4" /> Trigger agent at threshold
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
