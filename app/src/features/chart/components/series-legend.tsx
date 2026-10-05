// Purpose: Shared chart legend presentation and interactions for every series source.
import { v2 } from "@openchart/chart-core";
import { Eye, EyeOff, MoreHorizontal, Settings2, Trash2 } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@openchart/app/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { useChart } from "@openchart/app/hooks/use-chart";
import type { ChartRow } from "@openchart/app/lib/chart/data";
import {
  updateSeriesStyles,
  type SeriesPreferences,
  type ChartPreferencesStore,
} from "@openchart/app/lib/chart/preferences";
import { cn } from "@openchart/app/utils/cn";
import { SeriesStyleDialog } from "./series-style-dialog";

/** One chart output at the active crosshair or its latest bar. */
export interface SeriesLegendValue {
  id: string;
  row: ChartRow | undefined;
  previous: ChartRow | undefined;
  type: SeriesPreferences["type"];
  color: string;
  label: string;
}

/** Source-provided content; chart controls and readout selection remain shared. */
export interface SeriesLegendProps {
  seriesIds: readonly string[];
  /** Include nonnumeric visual outputs in source-level show/hide controls. */
  visibilityIds?: readonly string[];
  showMarker?: boolean;
  sourceId: string;
  main?: boolean;
  order: number;
  localStore: ChartPreferencesStore;
  disabled: boolean;
  /** Show the title and values only: no selection, menus, settings or actions. */
  readOnly?: boolean;
  describe: (values: readonly SeriesLegendValue[]) => {
    title: string;
    content: ReactNode;
  };
  onTitleClick?: () => void;
  titleActionLabel?: string;
  onRemove?: () => void;
  extraActions?: ReactNode;
  /** Rendered after the shared actions, before Series placement. */
  trailingActions?: ReactNode;
  settingsInputs?: ReactNode;
  /** Bindings that draw vertical profiles, whose part colors Style lists. */
  profileIds?: readonly string[];
  status?: ReactNode;
}
/** One shared row owns hover, selection, style and visibility; source callbacks own Resource writes.
 * @example <SeriesLegend {...props} describe={values => ({title: "RSI", content: String(values[0]?.row?.value ?? "—")})} />
 */
export function SeriesLegend({
  seriesIds,
  visibilityIds = seriesIds,
  showMarker = true,
  sourceId,
  main = false,
  order,
  localStore,
  disabled,
  readOnly = false,
  describe,
  onTitleClick,
  titleActionLabel,
  onRemove,
  extraActions,
  trailingActions,
  settingsInputs,
  profileIds = [],
  status,
}: SeriesLegendProps) {
  const chart = useChart();
  const [editing, setEditing] = useState<{ seriesId?: string }>();
  const seriesId = seriesIds[0];
  const saved = useStore(
    localStore,
    useShallow((state) => visibilityIds.map((id) => state.series[id])),
  );
  const rendered = useStore(
    chart.store,
    useShallow((state) =>
      seriesIds.map((id) => v2.ChartStateUtils.getSeries(state, id)),
    ),
  );
  const cursor = useStore(chart.store, (state) =>
    state.crosshair.visible ? state.crosshair.logicalIndex : undefined,
  );
  const locked = useStore(
    chart.store,
    (state) =>
      state.lockedSeriesId !== undefined &&
      seriesIds.includes(state.lockedSeriesId),
  );
  const values = seriesIds.map((id, index): SeriesLegendValue => {
    const series = rendered[index];
    const rows = series?.data ?? [];
    const position =
      cursor === undefined
        ? rows.length - 1
        : Math.round(cursor) - Number(series?.options.xOffset ?? 0);
    const row = rows[position] as ChartRow | undefined;
    const last = rows.at(-1) as ChartRow | undefined;
    const options = series?.options as Record<string, unknown> | undefined;
    return {
      id,
      row,
      previous: rows[position - 1] as ChartRow | undefined,
      type: (series?.type ??
        (main ? "Candlestick" : "Line")) as SeriesPreferences["type"],
      color: String(
        row?.color ??
          options?.color ??
          options?.lineColor ??
          options?.upColor ??
          "inherit",
      ),
      label: String(row?.title || last?.title || id),
    };
  });
  const visible = visibilityIds.some(
    (id, index) =>
      saved[index]?.visible ??
      rendered.find((series) => series?.id === id)?.options.visible !== false,
  );
  const { title, content } = describe(values);
  const focus = (hovered: boolean) =>
    seriesId &&
    chart.mutate((state) => {
      if (hovered || state.hoveredSeriesId === seriesId)
        v2.ChartStateUtils.setFocusedSeries(
          state,
          hovered ? seriesId : undefined,
        );
    });
  const lock = () =>
    seriesId &&
    chart.mutate((state) => {
      state.lockedSeriesId = seriesId;
      v2.ChartStateUtils.setFocusedSeries(state, seriesId);
    });
  const openMenu = (event: MouseEvent<HTMLElement>) => {
    if (!seriesId) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = chart.renderer.canvas.getBoundingClientRect();
    const anchor = event.currentTarget.getBoundingClientRect();
    const clientX = event.type === "contextmenu" ? event.clientX : anchor.left;
    const clientY =
      event.type === "contextmenu" ? event.clientY : anchor.bottom;
    chart.mutate((state) => {
      state.lockedSeriesId = seriesId;
      v2.ChartStateUtils.setFocusedSeries(state, seriesId);
      state.seriesContextMenu = {
        seriesId: seriesId,
        x: clientX - canvas.left,
        y: clientY - canvas.top,
        clientX,
        clientY,
      };
      delete state.yAxisContextMenu;
      delete state.drawings.contextMenu;
    });
  };
  const actions = [
    {
      id: "visibility",
      label: visible ? "Hide series" : "Show series",
      Icon: visible ? Eye : EyeOff,
      disabled: !visibilityIds.length,
      run: () =>
        updateSeriesStyles(localStore, visibilityIds, {
          visible: visible ? false : undefined,
        }),
    },
    {
      id: "settings",
      label: "Series settings",
      Icon: Settings2,
      disabled:
        disabled ||
        (!settingsInputs && !profileIds.length && !rendered.some(Boolean)),
      run: () => setEditing({ seriesId }),
    },
    ...(onRemove
      ? [
          {
            id: "remove",
            label: "Remove series",
            Icon: Trash2,
            disabled: disabled || main,
            run: onRemove,
          },
        ]
      : []),
  ];
  return (
    <>
      <div
        data-series-source={sourceId}
        data-series-legend={seriesId}
        role="group"
        aria-label={`${title} legend`}
        style={{ order }}
        className={cn(
          "group/legend pointer-events-auto relative grid max-w-full items-center gap-1 rounded-md bg-background/80 px-1 text-xs",
          showMarker
            ? "grid-cols-[auto_minmax(0,auto)_minmax(1.5rem,1fr)]"
            : "grid-cols-[minmax(0,auto)_minmax(1.5rem,1fr)]",
          !visible && seriesIds.length > 0 && "opacity-60",
        )}
        onMouseEnter={() => focus(true)}
        onMouseLeave={() => focus(false)}
        onFocusCapture={() => focus(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) focus(false);
        }}
        onContextMenu={readOnly ? undefined : openMenu}
      >
        {readOnly ? null : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="absolute inset-0 size-full rounded-md p-0"
            aria-label={`Select ${title} series`}
            aria-pressed={locked}
            disabled={!seriesId}
            onClick={lock}
          />
        )}
        {showMarker ? (
          <span
            className={cn(
              "pointer-events-none relative shrink-0 rounded-xs",
              main ? "size-2" : "size-1.5",
            )}
            style={{ background: values[0]?.color }}
            aria-hidden="true"
          />
        ) : null}
        {readOnly ? (
          <span
            className={cn(
              "relative min-w-0 shrink truncate font-semibold text-foreground",
              main ? "text-sm" : "text-xs",
            )}
          >
            {title}
          </span>
        ) : (
          <Button
            type="button"
            variant="link"
            size="xs"
            className={cn(
              "relative min-w-0 shrink truncate px-0 font-semibold text-foreground",
              main ? "text-sm" : "text-xs",
            )}
            aria-label={titleActionLabel ?? `Series settings for ${title}`}
            disabled={
              disabled ||
              (!onTitleClick &&
                !settingsInputs &&
                !profileIds.length &&
                !rendered.some(Boolean))
            }
            onClick={onTitleClick ?? (() => setEditing({ seriesId }))}
          >
            {title}
          </Button>
        )}
        <div className="pointer-events-none relative grid min-w-0 items-center">
          <div
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap tabular-nums",
              !readOnly &&
                "group-focus-within/legend:invisible group-hover/legend:invisible [@media(hover:none)]:invisible",
            )}
            aria-label={`${title} prices`}
          >
            {content}
          </div>
          {readOnly ? null : (
            <div
              role="toolbar"
              aria-label={`${title} actions`}
              // Button's transition-all must not delay inherited visibility after the readout returns.
              className="invisible col-start-1 row-start-1 flex w-fit max-w-full items-center gap-0.5 rounded-md bg-background group-focus-within/legend:pointer-events-auto group-focus-within/legend:visible group-hover/legend:pointer-events-auto group-hover/legend:visible [&_button]:transition-colors [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:visible"
            >
              {extraActions}
              {actions.map(
                ({ id, label, Icon, disabled: actionDisabled, run }) => (
                  <Tooltip key={id}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={label}
                        data-legend-action={id}
                        disabled={actionDisabled}
                        onClick={run}
                      >
                        <Icon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                  </Tooltip>
                ),
              )}
              {trailingActions}
              {seriesId ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Series placement"
                      aria-haspopup="menu"
                      disabled={disabled || !rendered.some(Boolean)}
                      onClick={openMenu}
                    >
                      <MoreHorizontal />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Series placement</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          )}
        </div>
        {status ? <div className="relative col-span-full">{status}</div> : null}
      </div>
      {editing ? (
        <SeriesStyleDialog
          seriesId={editing.seriesId}
          inputs={settingsInputs}
          profileIds={profileIds}
          selection={
            values.length > 1
              ? {
                  options: values.map((value) => ({
                    value: value.id,
                    name: value.label,
                  })),
                  onChange: (seriesId) => setEditing({ seriesId }),
                }
              : undefined
          }
          localStore={localStore}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}
