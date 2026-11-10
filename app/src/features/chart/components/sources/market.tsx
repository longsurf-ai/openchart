import { offersRetry } from "@openchart/app/lib/feed/transport";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
// Purpose: Share one market subscription across per-display legends in their owning panes.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import type { BarsRequest, BarsSeries } from "@openchart/feed";
import type { BarColumn } from "@openchart/market";
import { mergeByTime, type DataFrame } from "@openchart/timeseries";
import { useObservable, useObservableState } from "observable-hooks";
import {
  catchError,
  distinctUntilChanged,
  EMPTY,
  map,
  of,
  scan,
  startWith,
  switchMap,
} from "rxjs";

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
import {
  sessionClockStatus,
  sessionClockWindow,
  sessionInfo,
  withExtendedPrice,
  type LatestBar,
} from "@openchart/app/features/chart/utils/session-clock";
import { ProfileSettingsForm } from "@openchart/app/features/chart/components/profile-settings-form";
import { SeriesLegend } from "@openchart/app/features/chart/components/series-legend";
import { MarketVisuals } from "@openchart/app/features/chart/components/market-visuals";
import {
  VisibleRangeVolumeProfile,
  type ProfileBars,
} from "@openchart/app/features/chart/components/sources/volume-profile";
import { SymbolPicker } from "@openchart/app/features/chart/components/symbol-picker";
import { useBars, useBarsCapabilities } from "@openchart/app/hooks/use-bars";
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

/** Daily and longer bars cover the regular session only, whatever the selector. */
const periodResolutions = new Set<BarsSeries["resolution"]>(["1d", "1W", "1M"]);
/** Enough 1m history to reach the last extended trade across a long weekend. */
const extendedLookback = 4 * 86_400_000;

/** The 1m Extended request following the latest extended-hours price of a
 * daily-or-longer Extended chart. Undefined for other charts and for sources
 * without 1m Extended bars. The window start stays fixed per mount.
 * @example const request = useExtendedPriceRequest(series);
 */
function useExtendedPriceRequest(series: BarsSeries): BarsRequest | undefined {
  const wanted =
    series.session === "extended" && periodResolutions.has(series.resolution);
  const capabilities = useBarsCapabilities(
    { provider: series.provider, listing: series.listing },
    { enabled: wanted, silent: true },
  );
  const [from] = useState(() => Date.now() - extendedLookback);
  const minute = capabilities.data?.some(
    (value) =>
      value.resolution === "1m" &&
      value.session === "extended" &&
      value.adjustment === series.adjustment,
  );
  return wanted && minute
    ? { ...series, resolution: "1m", from, to: "now", countBack: 1 }
    : undefined;
}

function lastBarOf(frame: DataFrame): LatestBar | undefined {
  const row = frame.get(frame.numRows - 1);
  return row &&
    typeof row.close === "number" &&
    Number.isFinite(row.close) &&
    typeof row.time === "number"
    ? { time: row.time, close: row.close }
    : undefined;
}

/** Report a live request's last bar, and undefined on unmount. Pending reads
 * and failures report undefined without a toast: the extended tag is
 * decoration. Unmounting ends the subscription.
 * @example <LatestBarOf request={request} onBar={setBar} />
 */
function LatestBarOf({
  request,
  onBar,
}: {
  request: BarsRequest;
  onBar: (bar: LatestBar | undefined) => void;
}) {
  const bars = useBars(request);
  const bar = useObservableState(
    useObservable(
      (inputs$) =>
        inputs$.pipe(
          switchMap(([current, status]) =>
            current && status !== "error"
              ? current.updates.pipe(
                  catchError(() => EMPTY),
                  scan(
                    (frame, update) => mergeByTime(frame, update),
                    current.data,
                  ),
                  startWith(current.data),
                  map(lastBarOf),
                  distinctUntilChanged(
                    (left, right) =>
                      left?.time === right?.time &&
                      left?.close === right?.close,
                  ),
                )
              : of(undefined),
          ),
        ),
      [bars.current, bars.status],
    ),
  );
  useEffect(() => onBar(bar), [bar, onBar]);
  useEffect(() => () => onBar(undefined), [onBar]);
  return null;
}

/** Fill price-tag session badges from the calendar. Failures leave them unset.
 * The phase changes at the next boundary; paint reads that close or open time.
 * During pre/post, the session's latest extended bar adds core's secondary
 * "Pre"/"Post" tag.
 * @example usePriceSession(chart, series, ["price"], latestExtended);
 */
function usePriceSession(
  chart: ReturnType<typeof useChart>,
  series: Pick<BarsSeries, "provider" | "listing" | "session">,
  seriesIds: readonly string[],
  latestExtended?: LatestBar,
) {
  const key = seriesIds.join("\0");
  const [day, setDay] = useState(() => Math.floor(Date.now() / 86_400_000));
  const range = useMemo(() => sessionClockWindow(day * 86_400_000), [day]);
  const calendar = useCalendar(
    {
      provider: series.provider,
      listing: series.listing,
      start: range.start,
      end: range.end,
      timezone: "UTC",
    },
    { silent: true, enabled: key.length > 0 },
  );
  const days = calendar.data?.days;
  const coverage = series.session;
  useEffect(() => {
    if (!key) return;
    const ids = key.split("\0");
    const clear = () => {
      const current = chart.store.getState().session;
      if (!current || ids.every((id) => !current[id])) return;
      chart.mutate((state) => {
        for (const id of ids) delete state.session?.[id];
      }, "light");
    };
    if (!days) {
      clear();
      return;
    }
    let timer = 0;
    const apply = () => {
      const now = Date.now();
      const utcDay = Math.floor(now / 86_400_000);
      if (utcDay !== day) {
        setDay(utcDay);
        return;
      }
      const status = sessionClockStatus({ days, now, coverage });
      const info = withExtendedPrice(sessionInfo(status), latestExtended);
      chart.mutate((state) => {
        for (const id of ids) {
          if (info) (state.session ??= {})[id] = { ...info };
          else delete state.session?.[id];
        }
      }, "light");
      const wait =
        status.kind === "empty" || status.remainingMs === undefined
          ? 86_400_000 - (now % 86_400_000)
          : status.remainingMs;
      timer = window.setTimeout(apply, Math.max(250, wait + 25));
    };
    apply();
    return () => {
      window.clearTimeout(timer);
      clear();
    };
  }, [chart, coverage, day, days, latestExtended, key]);
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
  const extendedRequest = useExtendedPriceRequest(shown);
  const [latestExtended, setLatestExtended] = useState<LatestBar>();
  usePriceSession(
    chart,
    shown,
    input.bindings.flatMap((binding) =>
      binding.output === "price" ? [binding.id] : [],
    ),
    latestExtended,
  );
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
      {extendedRequest ? (
        <LatestBarOf request={extendedRequest} onBar={setLatestExtended} />
      ) : null}
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
