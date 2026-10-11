import { offersRetry } from "@openchart/app/lib/feed/transport";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
// Purpose: Share one market subscription across per-display legends in their owning panes.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import type { BarsSeries } from "@openchart/feed";
import type { BarColumn } from "@openchart/market";
import type { DataFrame } from "@openchart/timeseries";

import { Button } from "@openchart/app/components/ui/button";
import {
  chartMutation,
  chartMutationKey,
  type CellDefinition,
} from "@openchart/app/features/chart/api/queries";
import {
  replaceMarketSource,
  setProfileSettings,
  updateCell,
} from "@openchart/app/features/chart/utils/resource";
import { ProfileSettingsForm } from "@openchart/app/features/chart/components/profile-settings-form";
import { SeriesLegend } from "@openchart/app/features/chart/components/series-legend";
import { MarketVisuals } from "@openchart/app/features/chart/components/market-visuals";
import {
  VisibleRangeVolumeProfile,
  type ProfileBars,
} from "@openchart/app/features/chart/components/sources/volume-profile";
import { SymbolPicker } from "@openchart/app/features/chart/components/symbol-picker";
import { useCalendar } from "@openchart/app/hooks/use-calendar";
import { sessionDaysWindow } from "@openchart/app/lib/chart/data";
import { useChart } from "@openchart/app/hooks/use-chart";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import { useWidgetControls } from "@openchart/app/hooks/use-widget";
import {
  useMarketSeriesSource,
  type MarketSeriesInput,
} from "@openchart/app/hooks/use-market-series-source";
import type { ChartPreferencesStore } from "@openchart/app/lib/chart/preferences";
import { cn } from "@openchart/app/utils/cn";
import { reportUpsell } from "@openchart/app/lib/upsell/upsell";

/** Bar columns each legend shows: the main bar in full, a comparison's close, or volume alone. */
const legendColumns = {
  main: ["open", "high", "low", "close", "volume"],
  price: ["close"],
  volume: ["volume"],
} as const satisfies Record<string, readonly BarColumn[]>;
const format = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        maximumFractionDigits: Math.abs(value) < 1 ? 6 : 2,
      })
    : "—";

/** Calendar days under the frame's bars when its series is shaded by session.
 * Failures only omit shading.
 */
function useSessionDays(series: BarsSeries, frame: DataFrame | undefined) {
  const rows = frame?.numRows ?? 0;
  const window = sessionDaysWindow(
    series,
    frame?.get(0)?.time,
    frame?.get(rows - 1)?.time,
  );
  const calendar = useCalendar(
    {
      provider: series.provider,
      listing: series.listing,
      start: window?.start ?? 0,
      end: window?.end ?? 1,
      timezone: "UTC", // Only session instants are read, never day labels.
    },
    { enabled: window !== undefined, silent: true },
  );
  // A cached Extended window must never shade the same listing's Regular bars.
  return window && calendar.data?.days;
}

/** One source owns one useBars; portals move only its display rows. @example <MarketSource {...props} /> */
export function MarketSource({
  input,
  cell,
  targets,
  localStore,
  disabled,
  readOnly,
  onRemove,
}: {
  input: MarketSeriesInput;
  cell: CellDefinition;
  targets: ReadonlyMap<string, HTMLDivElement>;
  localStore: ChartPreferencesStore;
  disabled: boolean;
  /** Legends show values only. */
  readOnly?: boolean;
  onRemove: (seriesId: string) => void;
}) {
  const chart = useChart();
  const bars = useMarketSeriesSource(chart, input, localStore);
  const { chartId, transport } = useChartGrid();
  const client = useQueryClient();
  const save = useMutation(chartMutation(transport, client, chartId));
  const busy = useIsMutating({ mutationKey: chartMutationKey(chartId) }) > 0;
  const [picking, setPicking] = useState(false);
  // The bars the visible range's profile reads, for its legend and settings.
  const [profileBars, setProfileBars] = useState<ProfileBars>();
  useWidgetControls(picking);
  const shown = bars.current?.request ?? input.series;
  const days = useSessionDays(shown, bars.frame);
  const failure = bars.status === "error" ? bars.error : undefined;
  // A local projection failure can always be retried; Feed failures say so themselves.
  const retryable =
    !!bars.projectionError || (!!failure && offersRetry(failure));
  useErrorToast(bars.projectionError ?? failure, {
    id: `market:${chart.id}:${input.id}`,
    title: `Couldn’t update ${bars.projectionError ? shown.listing.symbol : input.series.listing.symbol}`,
    retry: retryable ? bars.retry : undefined,
  });
  // The user just saw this failure; the Cloud offer decides whether it applies.
  useEffect(() => {
    if (failure?._tag === "FeedError") reportUpsell(failure);
  }, [failure]);
  return (
    <>
      <MarketVisuals
        input={input}
        symbol={shown.listing.symbol}
        frame={bars.frame}
        days={days}
        localStore={localStore}
      />
      {input.bindings.flatMap((binding) =>
        binding.output === "volumeProfile"
          ? [
              <VisibleRangeVolumeProfile
                key={binding.id}
                id={binding.id}
                pane={binding.pane}
                axisId={
                  binding.pane === 0
                    ? "right"
                    : `pane:${binding.paneId ?? binding.pane}`
                }
                series={input.series}
                profile={binding.profile}
                localStore={localStore}
                onBars={setProfileBars}
              />,
            ]
          : [],
      )}
      {input.bindings.map((binding) => {
        const pane = cell.panes[binding.pane];
        const target = pane && targets.get(pane.id);
        return target
          ? createPortal(
              <SeriesLegend
                seriesIds={[binding.id]}
                profileIds={
                  binding.output === "volumeProfile" ? [binding.id] : undefined
                }
                settingsInputs={
                  binding.output === "volumeProfile" ? (
                    <ProfileSettingsForm
                      key={JSON.stringify(binding.profile ?? {})}
                      series={input.series}
                      saved={binding.profile ?? {}}
                      inUse={profileBars}
                      onSave={(settings) =>
                        save.mutateAsync((latest) =>
                          updateCell(latest, cell.id, (value) =>
                            setProfileSettings(value, binding.id, settings),
                          ),
                        )
                      }
                    />
                  ) : undefined
                }
                main={binding.main}
                readOnly={readOnly}
                sourceId={input.id}
                describe={([value]) => {
                  if (binding.output === "volumeProfile")
                    return {
                      title: `${shown.listing.symbol} Volume profile`,
                      content: (
                        <span className="text-2xs text-muted-foreground">
                          {profileBars
                            ? `Visible range · ${profileBars.resolution}`
                            : "Visible range"}
                        </span>
                      ),
                    };
                  const { row, previous } = value!;
                  const volume = binding.output === "volume";
                  const previousClose =
                    typeof previous?.close === "number" && previous.close !== 0
                      ? previous.close
                      : undefined;
                  const change =
                    typeof row?.close === "number" &&
                    previousClose !== undefined
                      ? row.close - previousClose
                      : undefined;
                  return {
                    title: `${shown.listing.symbol}${volume ? " Volume" : ""}`,
                    content: (
                      <>
                        <span className="text-2xs text-muted-foreground">
                          {shown.provider}
                        </span>
                        {(volume
                          ? legendColumns.volume
                          : binding.main
                            ? legendColumns.main
                            : legendColumns.price
                        ).map((key) => (
                          <span key={key}>
                            {binding.main || volume ? (
                              <span className="mr-0.5 text-2xs text-muted-foreground/70">
                                {key.charAt(0).toUpperCase()}
                              </span>
                            ) : null}
                            {format(row?.[key])}
                          </span>
                        ))}
                        {!volume &&
                        change !== undefined &&
                        previousClose !== undefined ? (
                          <span
                            className={cn(
                              change > 0 && "text-up",
                              change < 0 && "text-down",
                              change === 0 && "text-muted-foreground",
                            )}
                          >
                            {change > 0 ? "+" : ""}
                            {format(change)} (
                            {((change / previousClose) * 100).toFixed(2)}%)
                          </span>
                        ) : null}
                      </>
                    ),
                  };
                }}
                status={
                  binding.id ===
                  (
                    input.bindings.find((value) => value.main) ??
                    input.bindings[0]
                  )?.id ? (
                    <>
                      {bars.status === "loading" ? (
                        <span role="status" className="text-muted-foreground">
                          Loading…
                        </span>
                      ) : null}
                      {bars.status === "ready" && !bars.frame?.numRows ? (
                        <span className="text-muted-foreground">
                          No bars in this range
                        </span>
                      ) : null}
                      {failure ? (
                        <span role="status" className="text-muted-foreground">
                          {shown.listing.symbol !== input.series.listing.symbol
                            ? `${input.series.listing.symbol}: `
                            : null}
                          {failure.message}
                          {bars.frame?.numRows
                            ? " Showing previously loaded bars."
                            : null}
                        </span>
                      ) : null}
                      {retryable ? (
                        <span>
                          <Button variant="link" size="xs" onClick={bars.retry}>
                            Retry
                          </Button>
                        </span>
                      ) : null}
                    </>
                  ) : null
                }
                order={pane.series.findIndex(
                  (series) => series.id === binding.id,
                )}
                localStore={localStore}
                disabled={disabled || busy}
                onTitleClick={() => setPicking(true)}
                titleActionLabel={`Change ${shown.listing.symbol} symbol`}
                onRemove={() => onRemove(binding.id)}
              />,
              target,
              binding.id,
            )
          : null;
      })}
      {picking ? (
        <SymbolPicker
          onClose={() => setPicking(false)}
          onSelect={async (listing, capabilities) => {
            await save.mutateAsync((latest) =>
              replaceMarketSource(
                latest,
                cell.id,
                input.id,
                listing,
                capabilities,
              ),
            );
            setPicking(false);
          }}
        />
      ) : null}
    </>
  );
}
