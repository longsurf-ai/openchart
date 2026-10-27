// Purpose: Bind one cancellable Bars input to all of its chart presentations.
import { v2 } from "@openchart/chart-core";
import {
  resolutionMs,
  type BarsSeries,
  type Resolution,
} from "@openchart/feed";
import { mergeByTime, type DataFrame } from "@openchart/timeseries";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { debounceTime, filter, map } from "rxjs";
import { useStore } from "zustand";

import {
  applyTimeViewport,
  indexToTime,
  initialBarsRequest,
  mainTimeline,
  readTimeViewport,
  viewportNeedsReload,
} from "@openchart/app/lib/chart/data";
import {
  type ChartPreferencesStore,
  type ChartPreferences,
} from "@openchart/app/lib/chart/preferences";
import type { ChartOutput, ChartRuntime } from "@openchart/app/lib/chart/store";
import { barsRequestCovers } from "@openchart/app/lib/feed/contracts";

import { useBars } from "./use-bars";

/** One selected input can supply several independently styled display series. */
export interface MarketSeriesInput {
  readonly id: string;
  readonly series: BarsSeries;
  readonly bindings: readonly {
    id: string;
    pane: number;
    paneId?: string;
    main: boolean;
    /**
     * What this display draws from the shared bars: the price bar, its volume,
     * or the volume profile of the visible range.
     */
    output: "price" | "volume" | "volumeProfile";
    /** A volume profile's saved settings: the bars it counts and its rows. */
    profile?: { readonly resolution?: Resolution; readonly rows?: number };
  }[];
}

/** A single useBars owns the channel; bindings and styles only change its projections. @example const bars = useMarketSeriesSource(chart, input, localStore); */
export function useMarketSeriesSource(
  chart: ChartRuntime,
  input: MarketSeriesInput,
  localStore: ChartPreferencesStore,
) {
  const preferences = useStore(localStore);
  const identity = JSON.stringify(input.series);
  const initialWindow = useMemo(() => {
    const { from, to, countBack } = initialBarsRequest(
      input.series,
      localStore.getState(),
      chart.store.getState().config.chart.dimensions.width,
    );
    return { identity, from, to, countBack };
  }, [identity, input.series, localStore, chart]);
  const [window, setWindow] = useState(initialWindow);
  const activeWindow = window.identity === identity ? window : initialWindow;
  useLayoutEffect(() => {
    if (window.identity === identity) return;
    setWindow(initialWindow);
    const measuredSeries = chart.store.getState().measurement?.seriesId;
    if (
      measuredSeries &&
      input.bindings.some(
        (binding) => binding.main || binding.id === measuredSeries,
      )
    ) {
      chart.mutate((state) => {
        delete state.measurement;
      });
    }
  }, [window.identity, identity, initialWindow, chart, input.bindings]);
  const request = useMemo(
    () => ({
      ...input.series,
      from: activeWindow.from,
      to: activeWindow.to,
      countBack: activeWindow.countBack,
    }),
    [input.series, activeWindow],
  );
  const bars = useBars(request);
  const { current, status } = bars;
  const pendingGesture = useRef<{
    view: NonNullable<typeof current>;
    baseViewport: ChartPreferences["viewport"];
    intent: Pick<ChartPreferences, "viewport" | "barSpacing" | "rightOffset">;
  }>();
  const saveGesture = useCallback(
    (gesture: NonNullable<typeof pendingGesture.current>) => {
      if (
        gesture.view !== current ||
        gesture.baseViewport !== localStore.getState().viewport
      )
        return;
      const { intent } = gesture;
      localStore.setState((previous) =>
        previous.barSpacing === intent.barSpacing &&
        previous.rightOffset === intent.rightOffset &&
        previous.viewport?.from === intent.viewport?.from &&
        previous.viewport?.to === intent.viewport?.to
          ? previous
          : intent,
      );
    },
    [current, localStore],
  );
  const [projectionError, setProjectionError] = useState<string>();
  const [materialized, setMaterialized] = useState<{
    view: typeof current;
    data: DataFrame;
    viewport: ChartPreferences["viewport"] | undefined;
  }>();
  const frame =
    materialized?.view === current ? materialized?.data : current?.data;
  const main = input.bindings.some((binding) => binding.main);
  const step = resolutionMs[input.series.resolution];
  useLayoutEffect(() => {
    if (
      main &&
      status === "ready" &&
      current?.data.numRows === 0 &&
      current.request.to !== "now" &&
      barsRequestCovers(current.request, request) &&
      localStore.getState().viewport !== null
    ) {
      // A saved window before available history has no timeline to pan from.
      // Returning to latest uses the existing request effect below, once only.
      localStore.setState({ viewport: null, rightOffset: 0 });
    }
  }, [main, status, current, request, localStore]);
  // Child ChartSeries layout effects install data before this source restores the viewport.
  useLayoutEffect(() => {
    if (!main || !frame) return;
    const viewport =
      materialized && materialized.view === current
        ? materialized.viewport
        : localStore.getState().viewport;
    if (viewport === undefined) return;
    chart.mutate((state) => {
      if (viewport === null) {
        const saved = localStore.getState();
        v2.XScale.setAxisSpacing(
          state.config.xAxis,
          state.config.xAxis.activeId,
          {
            barSpacing: saved.barSpacing,
            rightOffset: saved.rightOffset,
          },
        );
      } else applyTimeViewport(state, viewport, step);
    });
  }, [chart, frame, materialized, current, localStore, main, step]);

  // A control can move within already loaded bars without replacing the frame.
  // Distant targets wait for their own snapshot instead of projecting onto the
  // retained frame, whose history constraint belongs to the preceding window.
  useLayoutEffect(() => {
    if (
      !main ||
      !current ||
      !barsRequestCovers(current.request, request) ||
      (preferences.viewport !== null &&
        viewportNeedsReload(request, preferences.viewport))
    )
      return;
    chart.mutate((state) => {
      if (preferences.viewport === null) {
        const saved = localStore.getState();
        v2.XScale.setAxisSpacing(
          state.config.xAxis,
          state.config.xAxis.activeId,
          {
            barSpacing: saved.barSpacing,
            rightOffset: saved.rightOffset,
          },
        );
      } else applyTimeViewport(state, preferences.viewport, step);
    });
  }, [chart, current, request, preferences.viewport, localStore, main, step]);

  // Install and project the snapshot above before subscribing. A reused live
  // view synchronously replays accumulated updates to this late subscriber;
  // its first update must preserve the newly projected window, not old offsets.
  useLayoutEffect(() => {
    setProjectionError(undefined);
    if (!current) return;
    let data = current.data;
    setMaterialized({
      view: current,
      data,
      viewport: localStore.getState().viewport,
    });
    const subscription = current.updates.subscribe({
      next: (update) => {
        try {
          const state = chart.store.getState();
          const saved = localStore.getState().viewport;
          const gesture = pendingGesture.current;
          const historical =
            main &&
            (gesture?.view === current && gesture.baseViewport === saved
              ? gesture.intent.viewport !== null
              : saved !== null ||
                v2.XScale.getAxis(state.config.xAxis).spacing.rightOffset < 0);
          // Preserve continuous coordinates through data changes, including a
          // resize or a gesture still awaiting persistence. Rounded painted
          // bounds lose fractional dates when fed back into the next update.
          const viewport = historical
            ? readTimeViewport(state, step)
            : undefined;
          data = mergeByTime(data, update);
          setMaterialized({ view: current, data, viewport });
        } catch (error) {
          setProjectionError(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
      error: () => {}, // useBars exposes transport failures.
    });
    return () => subscription.unsubscribe();
  }, [current, chart, localStore, main, step]);

  useLayoutEffect(() => {
    if (!main) return;
    const subscription = chart.output$
      .pipe(
        filter(
          (event): event is Extract<ChartOutput, { type: "range" }> =>
            event.type === "range" && event.source === "interaction",
        ),
        // Capture absolute intent before a live prepend can reindex the same
        // view during the gesture debounce.
        map(() => {
          if (!current || !barsRequestCovers(current.request, request)) return;
          const state = chart.store.getState();
          const viewport = readTimeViewport(state, step);
          if (!viewport) return;
          const spacing = v2.XScale.getAxis(state.config.xAxis).spacing;
          const intent = {
            viewport: spacing.rightOffset >= 0 ? null : viewport,
            barSpacing: spacing.barSpacing,
            rightOffset: Math.max(0, spacing.rightOffset),
          };
          // A gesture can resume live follow before its saved preference is
          // debounced. Scope that pending intent to the view and preference
          // from which it was made; a later control action supersedes it.
          pendingGesture.current = {
            view: current,
            baseViewport: localStore.getState().viewport,
            intent,
          };
          return pendingGesture.current;
        }),
        filter((intent) => intent !== undefined),
        debounceTime(300),
      )
      .subscribe(saveGesture);
    return () => {
      subscription.unsubscribe();
      pendingGesture.current = undefined;
    };
  }, [
    chart,
    current,
    request,
    preferences.viewport,
    localStore,
    main,
    step,
    saveGesture,
  ]);

  useLayoutEffect(() => {
    const subscription = chart.output$
      .pipe(
        filter(
          (event): event is Extract<ChartOutput, { type: "range" }> =>
            event.type === "range",
        ),
        debounceTime(300),
      )
      .subscribe(() => {
        if (
          status !== "ready" ||
          !current?.data.numRows ||
          !barsRequestCovers(current.request, request)
        )
          return;
        const state = chart.store.getState();
        const timeline = mainTimeline(state);
        if (!timeline.length) return;
        const range = v2.ChartStateUtils.getVisibleRange(state);
        const from = indexToTime(timeline, range.from, step),
          to = indexToTime(timeline, range.to, step);
        if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
          return;
        const visible = Math.max(1, range.to - range.from),
          pad = Math.max(2, Math.floor(visible * 0.1));
        const before =
          current.hasMoreBefore &&
          from < current.data.get(0)!.time + pad * step;
        const after = request.to !== "now" && to >= request.to;
        if (!before && !after) return;
        // Both debounces have observed every interaction. If paging runs first,
        // commit its captured intent before changing request and cancelling the
        // other timer. A later explicit viewport invalidates the scoped record.
        if (pendingGesture.current) saveGesture(pendingGesture.current);
        // History starts at the snapshot's first bar. Depending on the live frame
        // would cancel pending pans on every tick.
        if (before)
          setWindow((previous) => ({
            ...previous,
            from: Math.min(previous.from, Math.floor(from - visible * step)),
            countBack:
              previous.countBack + Math.max(120, Math.ceil(visible * 1.25)),
          }));
        else
          setWindow((previous) => ({
            ...previous,
            to: to >= Date.now() - step ? "now" : Math.ceil(to + step),
          }));
      });
    return () => subscription.unsubscribe();
  }, [chart, current, status, request, step, saveGesture]);

  useLayoutEffect(() => {
    const viewport = preferences.viewport;
    const reload =
      viewport === null
        ? activeWindow.to !== "now"
        : activeWindow.identity === identity &&
          viewportNeedsReload(activeWindow, viewport);
    if (!reload) return;
    const { from, to, countBack } = initialBarsRequest(
      input.series,
      localStore.getState(),
      chart.store.getState().config.chart.dimensions.width,
    );
    setWindow({ identity, from, to, countBack });
  }, [
    preferences.viewport,
    activeWindow,
    identity,
    input.series,
    localStore,
    chart,
  ]);

  useLayoutEffect(() => {
    const anchor = preferences.comparisonAnchor;
    if (preferences.comparison && anchor !== null && anchor < activeWindow.from)
      setWindow((previous) => ({
        ...previous,
        from: Math.floor(anchor - step),
      }));
  }, [
    preferences.comparison,
    preferences.comparisonAnchor,
    activeWindow.from,
    step,
  ]);

  return { ...bars, frame, projectionError };
}
