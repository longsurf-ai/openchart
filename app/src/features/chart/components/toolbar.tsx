// Purpose: Compose widget controls for the focused cell; page symbol selection is independent.
import ChartAreaIcon from "@hugeicons/core-free-icons/ChartAreaIcon";
import ChartAverageIcon from "@hugeicons/core-free-icons/ChartAverageIcon";
import ChartCandlestickIcon from "@hugeicons/core-free-icons/ChartCandlestickIcon";
import ChartHighLowIcon from "@hugeicons/core-free-icons/ChartHighLowIcon";
import ChartLineData01Icon from "@hugeicons/core-free-icons/ChartLineData01Icon";
import ChartLineData02Icon from "@hugeicons/core-free-icons/ChartLineData02Icon";
import { SessionType } from "@openchart/market";
import { providerName, type Resolution } from "@openchart/feed";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Lock, Plus, FunctionSquare } from "lucide-react";
import { useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import { Button } from "@openchart/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import { Icon } from "@openchart/app/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import {
  chooseBarsOptions,
  chartDetail,
  chartIds,
  chartMutation,
  chartMutationKey,
  type CellDefinition,
} from "@openchart/app/features/chart/api/queries";
import { getGridPreset } from "@openchart/app/features/chart/utils/grid-layout";
import {
  addComparison,
  getMainPane,
  getMainSeries,
  getMainSource,
  moveSeries,
  removeSeries,
  updateCell,
} from "@openchart/app/features/chart/utils/resource";
import { useWidgetControls } from "@openchart/app/hooks/use-widget";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import { useBarsCapabilities } from "@openchart/app/hooks/use-bars";
import {
  defaultSeriesPreferences,
  PriceType,
  updateSeriesStyles,
  type ChartPreferencesStore,
} from "@openchart/app/lib/chart/preferences";

import { ResourceNotice } from "./resource-notice";
import { SymbolPicker } from "./symbol-picker";
import { IndicatorLibraryNavigation } from "@openchart/app/lib/indicator-library/indicator-library";
import { WorkspaceFileNavigation } from "@openchart/app/lib/workspace/workspace";
import { GridPresetMenu } from "./layout-menu";
import {
  cloudOffersOption,
  reportLockedOption,
  type ChartOption,
} from "@openchart/app/lib/upsell/upsell";

const resolutions: readonly Resolution[] = [
  "1s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1W",
  "1M",
];
const adjustments = [
  { value: "raw", name: "Raw prices", coverage: "raw prices" },
  { value: "split", name: "Split adjusted", coverage: "split-adjusted prices" },
  {
    value: "split_dividend",
    name: "Total return",
    coverage: "total-return prices",
  },
] as const;
/** How a missing session reads in "<source> doesn't provide …". */
const sessionCoverage: Record<CellDefinition["session"], string> = {
  regular: "regular-hours bars",
  extended: "extended-hours bars",
  "24h": "24-hour bars",
};
const typeIcons = {
  Candlestick: ChartCandlestickIcon,
  Bar: ChartHighLowIcon,
  Line: ChartLineData01Icon,
  Area: ChartAreaIcon,
  Baseline: ChartAverageIcon,
  Liveline: ChartLineData02Icon,
} as const;
const typeGroups: readonly (readonly PriceType[])[] = [
  ["Candlestick", "Bar"],
  ["Line", "Area", "Baseline", "Liveline"],
];
type PriceType = (typeof PriceType.options)[number];

/** The toolbar subscribes to its active Resource cell and mounted preferences. @example <ChartToolbar /> */
export function ChartToolbar() {
  const { chartId, transport, focusedId, setFocused, mounted } = useChartGrid();
  const queryClient = useQueryClient();
  const [controlId, setControlId] = useState<string>();
  const resource = useQuery(chartDetail(transport, chartId));
  const visible = resource.data?.cells.slice(
    0,
    getGridPreset(resource.data.preset).capacity,
  );
  const save = useMutation(chartMutation(transport, queryClient, chartId));
  const disabled =
    useIsMutating({ mutationKey: chartMutationKey(chartId) }) > 0;
  const [picker, setPicker] = useState<string>();
  const openLibrary = useContext(IndicatorLibraryNavigation);
  const openFile = useContext(WorkspaceFileNavigation);
  useWidgetControls(!!picker);
  const active = controlId
    ? visible?.find((cell) => cell.id === controlId)
    : (visible?.find((cell) => cell.id === focusedId) ?? visible?.[0]);
  const pickerExists = resource.data?.cells.some((cell) => cell.id === picker);
  useEffect(() => {
    if (resource.isSuccess && controlId && !active) setControlId(undefined);
    if (resource.isSuccess && picker && !pickerExists) setPicker(undefined);
  }, [controlId, picker, pickerExists, resource.isSuccess, active]);
  const preferences = active && mounted.get(active.id)?.preferences;
  return (
    <div
      className="contents"
      onPointerDownCapture={() => {
        if (active) setFocused(active.id);
      }}
      onFocusCapture={() => {
        if (active) setFocused(active.id);
      }}
    >
      {active && preferences ? (
        <ChartControls
          cell={active}
          localStore={preferences}
          disabled={disabled}
          onChange={(edit) =>
            save.mutate((resource) => updateCell(resource, active.id, edit))
          }
          onSearch={() => setPicker(active.id)}
          onMenuChange={(open) => setControlId(open ? active.id : undefined)}
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Indicators"
            disabled={!active || disabled || !openLibrary || !openFile}
            onClick={() => {
              if (active && openLibrary && openFile)
                openLibrary({ chartId, cellId: active.id, openFile });
            }}
          >
            <FunctionSquare className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Indicators</TooltipContent>
      </Tooltip>
      <GridPresetMenu />
      <ResourceNotice error={resource.error ?? save.error} />
      {picker && pickerExists ? (
        <SymbolPicker
          onSelect={async (listing, capabilities) => {
            await save.mutateAsync((resource) =>
              updateCell(resource, picker, (target) =>
                addComparison(target, listing, capabilities),
              ),
            );
            setPicker(undefined);
          }}
          onClose={() => setPicker(undefined)}
        />
      ) : null}
    </div>
  );
}

/**
 * One interval, session or adjustment choice. A choice the source lacks is
 * disabled, unless Cloud offers it: then it is muted with a lock, explains on
 * hover which source lacks it, and stays clickable so the menu can raise the
 * Cloud offer.
 */
function OptionItem({
  value,
  supported,
  locked,
  missing,
  children,
}: {
  value: string;
  supported: boolean;
  locked: boolean;
  /** What the source lacks, e.g. "Yahoo Finance doesn't provide 1s bars". */
  missing: string;
  children: ReactNode;
}) {
  if (!locked)
    return (
      <DropdownMenuRadioItem value={value} disabled={!supported}>
        {children}
      </DropdownMenuRadioItem>
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuRadioItem
          value={value}
          className="group text-muted-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
        >
          {children}
          <Lock
            aria-hidden
            className="ml-auto size-3.5 text-muted-foreground group-data-[highlighted]:text-accent-foreground"
          />
          <span className="sr-only">, available with OpenChart Cloud</span>
        </DropdownMenuRadioItem>
      </TooltipTrigger>
      <TooltipContent side="right">{missing}</TooltipContent>
    </Tooltip>
  );
}

function ChartControls({
  cell,
  localStore,
  disabled,
  onChange,
  onSearch,
  onMenuChange,
}: {
  cell: CellDefinition;
  localStore: ChartPreferencesStore;
  disabled: boolean;
  onChange: (edit: (cell: CellDefinition) => CellDefinition) => void;
  onSearch: () => void;
  onMenuChange: (open: boolean) => void;
}) {
  const [openMenu, setOpenMenu] = useState<string>();
  useWidgetControls(!!openMenu);
  const open = (name: string) => (value: boolean) => {
    setOpenMenu(value ? name : undefined);
    onMenuChange(value);
  };
  const prefs = useStore(localStore);
  const main = getMainSeries(cell);
  const source = getMainSource(cell);
  const capabilities = useBarsCapabilities({
    provider: source.provider,
    listing: source.listing,
  });
  const choices = capabilities.data ?? [];
  const supports = (
    choice: Partial<
      Pick<CellDefinition, "resolution" | "session" | "adjustment">
    >,
  ) =>
    choices.some(
      (value) =>
        (choice.resolution === undefined ||
          value.resolution === choice.resolution) &&
        (choice.session === undefined || value.session === choice.session) &&
        (choice.adjustment === undefined ||
          value.adjustment === choice.adjustment),
    );
  // An option the source lacks stays clickable when Cloud offers it: choosing it
  // raises the Cloud offer and leaves the chart unchanged.
  const chart = {
    provider: source.provider,
    listingClass: source.listing.class,
  };
  const locked = (option: ChartOption, supported: boolean) =>
    !supported && cloudOffersOption(option, chart);
  const missing = (what: string) =>
    `${providerName(source.provider)} doesn't provide ${what}`;
  const style = { ...defaultSeriesPreferences, ...prefs.series[main.id] };
  const setStyle = (change: Partial<typeof style>) =>
    updateSeriesStyles(localStore, [main.id], change);
  // The Resource owns whether volume and its profile are drawn; preferences only style them.
  const marketBinding = (output: "volume" | "volumeProfile") =>
    cell.panes
      .flatMap((pane, index) =>
        pane.series.map((series) => ({ series, pane: index })),
      )
      .find(
        (entry) =>
          entry.series.source.kind === "market" &&
          entry.series.source.marketSourceId === source.id &&
          entry.series.source.output === output,
      );
  const volume = marketBinding("volume");
  const volumeProfile = marketBinding("volumeProfile");
  const mainPane = cell.panes.findIndex((pane) =>
    pane.series.some((series) => series.id === main.id),
  );
  const volumePlacement = !volume
    ? "off"
    : volume.pane === mainPane
      ? "overlay"
      : "pane";
  const showMarketOutput = (
    output: "volume" | "volumeProfile",
    visible: boolean,
    separate = false,
  ) => {
    const binding = marketBinding(output);
    if (visible === !!binding) return;
    onChange((current) => {
      if (binding) return removeSeries(current, binding.series.id);
      const id = chartIds.series.create();
      const marketSourceId = getMainSource(current).id;
      const added: CellDefinition = {
        ...current,
        panes: current.panes.map((pane) =>
          pane.id === getMainPane(current).id
            ? {
                ...pane,
                series: [
                  ...pane.series,
                  // One literal per output: each is its own kind of binding.
                  output === "volume"
                    ? {
                        id,
                        role: "normal",
                        source: { kind: "market", marketSourceId, output },
                      }
                    : {
                        id,
                        role: "normal",
                        source: { kind: "market", marketSourceId, output },
                      },
                ],
              }
            : pane,
        ),
      };
      return separate ? moveSeries(added, id, "new") : added;
    });
  };
  const moveVolume = (separate: boolean) => {
    if (!volume) return;
    onChange((current) =>
      moveSeries(
        current,
        volume.series.id,
        separate ? "new" : getMainPane(current).id,
      ),
    );
  };
  const dataDisabled = disabled || !choices.length;
  return (
    <div
      className="flex min-w-0 items-center gap-1"
      role="toolbar"
      aria-label="Chart controls"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            disabled={disabled}
            aria-label="Compare symbol"
            onClick={onSearch}
          >
            <Plus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Compare symbol</TooltipContent>
      </Tooltip>
      <DropdownMenu
        open={openMenu === "interval"}
        onOpenChange={open("interval")}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground"
                disabled={dataDisabled}
                aria-label={`Interval ${cell.resolution}`}
              >
                {cell.resolution}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Interval: {cell.resolution}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Interval
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={cell.resolution}
            onValueChange={(value) => {
              const resolution = value as Resolution;
              if (!supports({ resolution }))
                return reportLockedOption("resolution", chart);
              onChange((current) => ({
                ...current,
                ...chooseBarsOptions(choices, { ...current, resolution }),
              }));
            }}
          >
            {resolutions.map((resolution) => {
              const supported = supports({ resolution });
              return (
                <OptionItem
                  key={resolution}
                  value={resolution}
                  supported={supported}
                  locked={locked("resolution", supported)}
                  missing={missing(`${resolution} bars`)}
                >
                  {resolution}
                </OptionItem>
              );
            })}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Session</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={cell.session}
                onValueChange={(value) => {
                  const session = value as CellDefinition["session"];
                  if (
                    !supports({
                      resolution: cell.resolution,
                      session,
                      adjustment: cell.adjustment,
                    })
                  )
                    return reportLockedOption("session", chart);
                  onChange((current) => ({ ...current, session }));
                }}
              >
                {SessionType.literals.map((session) => {
                  const supported = supports({
                    resolution: cell.resolution,
                    session,
                    adjustment: cell.adjustment,
                  });
                  return (
                    <OptionItem
                      key={session}
                      value={session}
                      supported={supported}
                      locked={locked("session", supported)}
                      missing={missing(sessionCoverage[session])}
                    >
                      {session === "24h"
                        ? "24 hr"
                        : session === "regular"
                          ? "Regular"
                          : "Extended"}
                    </OptionItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Adjustment</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={cell.adjustment}
                onValueChange={(value) => {
                  const adjustment = value as CellDefinition["adjustment"];
                  if (
                    !supports({
                      resolution: cell.resolution,
                      session: cell.session,
                      adjustment,
                    })
                  )
                    return reportLockedOption("adjustment", chart);
                  onChange((current) => ({ ...current, adjustment }));
                }}
              >
                {adjustments.map((adjustment) => {
                  const supported = supports({
                    resolution: cell.resolution,
                    session: cell.session,
                    adjustment: adjustment.value,
                  });
                  return (
                    <OptionItem
                      key={adjustment.value}
                      value={adjustment.value}
                      supported={supported}
                      locked={locked("adjustment", supported)}
                      missing={missing(adjustment.coverage)}
                    >
                      {adjustment.name}
                    </OptionItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu open={openMenu === "type"} onOpenChange={open("type")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-foreground"
                aria-label={`Chart type ${style.type}`}
              >
                <Icon
                  icon={
                    typeIcons[style.type as PriceType] ?? ChartCandlestickIcon
                  }
                  className="size-4"
                />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Chart type: {style.type}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={style.type}
            onValueChange={(value) =>
              setStyle({ type: PriceType.parse(value) })
            }
          >
            {typeGroups.map((group, index) => (
              <div key={group[0]}>
                {index ? <DropdownMenuSeparator /> : null}
                {group.map((type) => (
                  <DropdownMenuRadioItem
                    key={type}
                    value={type}
                    disabled={prefs.comparison}
                  >
                    <Icon icon={typeIcons[type]} className="size-4" />
                    {type}
                  </DropdownMenuRadioItem>
                ))}
              </div>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {/* Inset lines Volume up with the checkbox below it. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>Volume</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={volumePlacement}
                onValueChange={(value) => {
                  // Re-choosing must not save: a move to "new" always opens another pane.
                  if (value === volumePlacement) return;
                  if (value === "off") showMarketOutput("volume", false);
                  else if (volume) moveVolume(value === "pane");
                  else showMarketOutput("volume", true, value === "pane");
                }}
              >
                <DropdownMenuRadioItem value="off" disabled={disabled}>
                  Off
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="pane" disabled={disabled}>
                  Separate pane
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="overlay" disabled={disabled}>
                  Overlay on price
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuCheckboxItem
            checked={!!volumeProfile}
            disabled={disabled}
            onCheckedChange={(visible) =>
              showMarketOutput("volumeProfile", visible)
            }
          >
            Volume Profile
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
