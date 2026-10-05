// Purpose: Run the built-in range volume profile for a market binding or a fixed-range drawing.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import type { VerticalProfile } from "@openchart/chart-core/vertical-profile";
import {
  providerName,
  resolutionMs,
  type BarsCapabilities,
  type BarsSeries,
  type Resolution,
} from "@openchart/feed";
import * as Tea from "@openchart/tea";
import { chartBuiltinScript } from "@openchart/app/features/chart/api/queries";
import { ChartVerticalProfiles } from "@openchart/app/features/chart/components/chart-vertical-profiles";
import { resolutionsUpTo } from "@openchart/app/features/chart/utils/resolutions";
import { useBarsCapabilities } from "@openchart/app/hooks/use-bars";
import { useChart } from "@openchart/app/hooks/use-chart";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import { useTea } from "@openchart/app/hooks/use-tea";
import { useVisibleTimeRange } from "@openchart/app/hooks/use-visible-time-range";
import {
  drawingList,
  drawingScopeKey,
  type DrawingScope,
} from "@openchart/app/lib/chart/drawings";
import { mainBarTime } from "@openchart/app/lib/chart/data";
import {
  indicatorProfiles,
  restyleProfiles,
} from "@openchart/app/lib/chart/indicator-data";
import type { ChartPreferencesStore } from "@openchart/app/lib/chart/preferences";

type Placement = { id: string; pane: number; axisId: string };

/** The bars a range profile reads, and, when they aren't the ones its
 * settings chose, a sentence saying why. */
export interface ProfileBars {
  readonly resolution: Resolution;
  readonly note?: string;
}

/** About how many bars a range profile reads by default. */
const rangeBars = 5000;
/**
 * The most bars a chosen lower timeframe reads, so a fine choice on a wide
 * range never fetches and computes hundreds of thousands of bars per pan.
 */
const chosenBars = 100_000;

// The bars a range profile reads: from the resolutions the provider offers for
// the series' session and adjustment, up to the series' own, the finest that
// is no finer than `chosen` (else 1m) and coarser than `failed`, at which the
// `span` milliseconds a run reads hold at most about 100,000 bars for a
// choice, else 5,000; else the series' own. A choice the provider doesn't
// offer there, or one coarser than the series, counts as none.
function rangeResolution(
  series: BarsSeries,
  capabilities: BarsCapabilities,
  span: number,
  chosen: Resolution | undefined,
  failed: Resolution | undefined,
): Resolution {
  const offered = resolutionsUpTo(series, capabilities);
  const usable = chosen && offered.includes(chosen) ? chosen : undefined;
  const floor = Math.max(
    resolutionMs[usable ?? "1m"],
    failed === undefined ? 0 : resolutionMs[failed] + 1,
  );
  const budget = usable ? chosenBars : rangeBars;
  return offered.reduce<Resolution>(
    (finest, resolution) =>
      resolutionMs[resolution] >= floor &&
      resolutionMs[resolution] < resolutionMs[finest] &&
      span / resolutionMs[resolution] <= budget
        ? resolution
        : finest,
    series.resolution,
  );
}

/**
 * The volume profile of `series` over `[start, end)` in epoch milliseconds,
 * drawn in `box`. It runs the hidden built-in range script, so the profile is
 * the one Tea computes for sessions, and re-runs only when the range changes;
 * the last profile stays drawn until the new one arrives. Hiding it places
 * nothing, while the computation keeps running. A range that ends by the
 * open of the chart's newest bar has only closed bars, so its run reads them,
 * then completes and releases its Feed session; one reaching further runs
 * live and keeps updating. The chart's bars, not the clock, say how far the
 * market's data reaches, since a delayed market's bars lag the clock, so the
 * profile waits for them.
 *
 * The run reads finer bars than `series` when its provider offers them, the
 * finest of 1m and up that keeps the read near 5,000 bars, or `resolution`,
 * the bars its settings chose, while the read stays near 100,000 of them,
 * else the finest coarser ones that do; it waits for the provider's
 * capabilities to choose. `rows` is its number of volume bars, 24 by default.
 * When the provider can't serve those bars for this range before the run
 * draws, such as Yahoo's intraday bars past their retention, the range runs
 * again on the next coarser bars, down to `series` itself; a failure after it
 * drew is reported instead. `onBars` hears the bars in use, with a `note` that
 * says why they aren't the chosen ones, and `undefined` once nothing runs.
 * @example <RangeVolumeProfile id="drawing" series={series} pane={0} axisId="right" start={from} end={to} box={box} visible />
 */
export function RangeVolumeProfile(
  props: Placement & {
    series: BarsSeries;
    start: number;
    end: number;
    box: VerticalProfile.Box;
    visible: boolean;
    /** Saved colors of its parts by title; see {@link restyleProfiles}. */
    partColors?: Readonly<Record<string, string>>;
    /** The bars its settings chose; absent picks them by the range. */
    resolution?: Resolution;
    /** Its number of volume bars; absent keeps the script's 24. */
    rows?: number;
    onBars?: (bars: ProfileBars | undefined) => void;
  },
) {
  const { transport } = useChartGrid();
  const script = useQuery(
    chartBuiltinScript(transport, "volume-profile-range"),
  );
  const capabilities = useBarsCapabilities({
    provider: props.series.provider,
    listing: props.series.listing,
  });
  const chart = useChart();
  const newest = useStore(chart.store, (state) => mainBarTime(state, -1));
  // Capabilities that fail to load leave only the series' own resolution.
  return script.data && !capabilities.isPending && newest !== undefined ? (
    <RangeRun
      {...props}
      source={script.data}
      capabilities={capabilities.data ?? []}
      newest={newest}
    />
  ) : null;
}

function RangeRun({
  id,
  pane,
  axisId,
  series,
  start,
  end,
  box,
  visible,
  partColors,
  resolution: chosen,
  rows,
  onBars,
  source,
  capabilities,
  newest,
}: Parameters<typeof RangeVolumeProfile>[0] & {
  source: Tea.WorkspaceSources;
  capabilities: BarsCapabilities;
  /** The open of the chart's newest bar, in epoch milliseconds. */
  newest: number;
}) {
  const seriesKey = JSON.stringify(series);
  // The finest bars this range's run couldn't get; the range then tries only
  // coarser ones, down to the series' own, so the fallback never loops. A new
  // range or a new choice tries finer bars again.
  const rangeKey = `${seriesKey}:${start}:${end}:${chosen}`;
  const [failed, setFailed] = useState<{
    rangeKey: string;
    resolution: Resolution;
    /** The provider's first reason on this range, such as its retention. */
    message: string;
  }>();
  const failure = failed?.rangeKey === rangeKey ? failed : undefined;
  // A range ending by the newest bar's open runs over its own bars and
  // completes; a later one stays live, reading from its start until now.
  const to = end <= newest ? end : "now";
  const span = (to === "now" ? Math.max(end, Date.now()) : end) - start;
  const resolution = rangeResolution(
    series,
    capabilities,
    span,
    chosen,
    failure?.resolution,
  );
  const execution = useTea({
    source,
    parameters: {
      rangeStart: start,
      rangeEnd: end,
      ...(rows === undefined ? {} : { rows }),
    },
    ...Tea.barsInputs({ ...series, resolution }),
    requests: {},
    from: start,
    to,
    countBack: 1,
    // Bars before the range add nothing to its profile.
    warmupBars: 0,
  });
  // Only a run that never drew falls back; a later failure, such as a dropped
  // connection, keeps its profile and is reported.
  if (
    resolution !== series.resolution &&
    !execution.data &&
    execution.error instanceof Tea.Error &&
    execution.error.code === "upstream"
  )
    setFailed({
      rangeKey,
      resolution,
      message: failure?.message ?? execution.error.message,
    });
  // Why the bars in use aren't the chosen ones: the provider's reason, or a
  // read too large for the range.
  const note =
    !chosen || resolution === chosen
      ? undefined
      : (failure?.message ??
        (resolutionsUpTo(series, capabilities).includes(chosen)
          ? `${chosen} would read about ${Math.round(span / resolutionMs[chosen]).toLocaleString()} bars on this range.`
          : `${providerName(series.provider)} doesn't provide ${chosen} bars for this chart.`));
  useEffect(() => {
    onBars?.({ resolution, note });
    return () => onBars?.(undefined);
  }, [onBars, resolution, note]);
  const parsed = useMemo(() => {
    if (!execution.data) return undefined;
    try {
      return { profiles: indicatorProfiles(execution.data.column("profile")) };
    } catch (error) {
      return {
        profiles: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [execution.data]);
  // A new range is a new run, which starts without rows. Until its first
  // frame, keep drawing this market's last profile, so a pan or an anchor drag
  // never blanks it; another market never shows it.
  const [last, setLast] = useState({ seriesKey, parsed });
  if (parsed && parsed !== last.parsed) setLast({ seriesKey, parsed });
  const shown =
    parsed ?? (last.seriesKey === seriesKey ? last.parsed : undefined);
  const boxKey = JSON.stringify(box);
  const profiles = useMemo(() => {
    const drawn = JSON.parse(boxKey) as VerticalProfile.Box;
    return restyleProfiles(shown?.profiles ?? [], partColors).map(
      (profile) => ({
        ...profile,
        box: drawn,
        // A hidden profile stays placed, so Style still lists its parts.
        visible: profile.visible && visible,
      }),
    );
  }, [shown, boxKey, partColors, visible]);
  useErrorToast(execution.error ?? parsed?.error, {
    id: `volume-profile:${id}`,
    title: "Couldn’t update the volume profile",
    retry: execution.retry,
  });
  return (
    <ChartVerticalProfiles
      id={id}
      pane={pane}
      axisId={axisId}
      profiles={profiles}
    />
  );
}

// The visible range's profile sits against the price axis, like TradingView's.
const visibleRangeBox: VerticalProfile.Box = {
  kind: "edge",
  side: "right",
  width: 0.3,
};

/**
 * A market binding's volume profile of the bars on screen, re-run 300 ms after
 * a pan or zoom settles. `profile` holds the binding's saved settings. Hiding
 * the binding draws nothing; its saved part colors restyle it without a run.
 * `onBars` hears the bars it reads, for the legend and the settings.
 * @example <VisibleRangeVolumeProfile id={binding.id} series={series} pane={0} axisId="right" profile={{ rows: 50 }} localStore={preferences} onBars={setBars} />
 */
export function VisibleRangeVolumeProfile({
  series,
  profile,
  localStore,
  ...placement
}: Placement & {
  series: BarsSeries;
  profile?: { readonly resolution?: Resolution; readonly rows?: number };
  localStore: ChartPreferencesStore;
  onBars?: (bars: ProfileBars | undefined) => void;
}) {
  const chart = useChart();
  const range = useVisibleTimeRange(chart, series);
  const visible = useStore(
    localStore,
    (state) => state.series[placement.id]?.visible !== false,
  );
  const partColors = useStore(
    localStore,
    (state) => state.series[placement.id]?.partColors,
  );
  return range ? (
    <RangeVolumeProfile
      {...placement}
      series={series}
      start={range.start}
      end={range.end}
      box={visibleRangeBox}
      visible={visible}
      partColors={partColors}
      resolution={profile?.resolution}
      rows={profile?.rows}
    />
  ) : null;
}

/**
 * The profile of each fixed-range volume profile drawing in `scope`, over the
 * bars between its anchors' times and drawn between them. It follows saved
 * drawings, so dragging re-runs the profile once the edit is saved, and a
 * hidden drawing draws none.
 * @example <FixedRangeVolumeProfiles scope={scope} settings={settings} />
 */
export function FixedRangeVolumeProfiles({
  scope,
  settings,
  drawingId,
}: {
  scope: DrawingScope;
  settings: Pick<BarsSeries, "resolution" | "session" | "adjustment">;
  /** In a view of one drawing, only its profile. */
  drawingId?: string;
}) {
  const { transport } = useChartGrid();
  const rows = useQuery(drawingList(transport, scope)).data ?? [];
  const key = drawingScopeKey(scope);
  const series: BarsSeries = {
    provider: scope.provider,
    listing: scope.listing,
    ...settings,
  };
  return rows.flatMap(({ id, data, ...owner }) => {
    if (
      data.type !== "volume_profile" ||
      data.hidden ||
      drawingScopeKey(owner) !== key ||
      (drawingId && id !== drawingId)
    )
      return [];
    const [first, second] = data.anchors;
    if (!first || !second) return [];
    const from = Math.min(first.time, second.time);
    const to = Math.max(first.time, second.time);
    return [
      <RangeVolumeProfile
        key={id}
        id={`drawing:${data.id}`}
        pane={0}
        axisId={first.axisId ?? "right"}
        series={series}
        start={from * 1000}
        end={to * 1000}
        box={{ kind: "time", from, to }}
        visible
      />,
    ];
  });
}
