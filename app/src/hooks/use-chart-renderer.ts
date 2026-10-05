// Purpose: Own one renderer, its immutable state, and its DOM subscriptions.
import { v2 } from "@openchart/chart-core";
import { Bus, ChartEvent } from "@openchart/chart-core/bus";
import { useLayoutEffect, useState, type RefObject } from "react";
import { Subject } from "rxjs";
import type { z } from "zod";
import { useStore } from "zustand";

import {
  createChartStore,
  type ChartMutation,
  type ChartOutput,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";
import { applyChartTheme } from "@openchart/app/lib/chart/theme";
import { chartSettings } from "@openchart/app/stores/chart";

/** Create after the DOM mounts, and dispose every owned subscription. @example const chart = useChartRenderer(container, id); */
export function useChartRenderer(
  container: RefObject<HTMLDivElement>,
  id: string,
) {
  const [chart, setChart] = useState<ChartRuntime>();
  const timezone = useStore(chartSettings, (state) => state.timezone);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const store = createChartStore(v2.createState({ id }));
    const output = new Subject<ChartOutput>();
    let alive = true;
    const commit = (recipe: ChartMutation) => {
      if (!alive) return;
      store.setState((draft) => {
        recipe(draft);
        v2.ChartStateUtils.constrainHistoryViewport(draft);
      }, true);
    };
    const renderer = v2.createRenderer({
      container: element,
      getState: store.getState,
      setState: commit,
      onVisibleRangeChange: (range) => output.next({ type: "range", ...range }),
      onRenderComplete: () => output.next({ type: "paint" }),
    });
    renderer.canvas.tabIndex = 0;
    renderer.canvas.setAttribute("aria-label", "Interactive chart");
    const runtime: ChartRuntime = {
      id,
      store,
      renderer,
      output$: output.asObservable(),
      mutate(recipe, level = "light") {
        if (!alive) return;
        commit(recipe);
        renderer.render(level);
      },
    };
    const resize = (width: number, height: number) => {
      if (!alive || width <= 0 || height <= 0) return;
      commit((state) => {
        v2.ChartStateUtils.resize(state, width, height);
      });
      renderer.scheduleResize(width, height);
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry) resize(entry.contentRect.width, entry.contentRect.height);
    });
    const leave = () =>
      output.next({ type: "crosshair", index: undefined, x: 0, y: 0 });
    element.addEventListener("pointerleave", leave);
    observer.observe(element);
    resize(element.clientWidth, element.clientHeight);
    const visibility =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(([entry]) =>
            renderer.setSuspended(!entry?.isIntersecting),
          );
    visibility?.observe(element);
    const unsubscribe = Bus.subscribe<
      z.infer<typeof ChartEvent.Crosshair.schema>
    >(ChartEvent.Crosshair, (event) => {
      if (event.id === id)
        output.next({
          type: "crosshair",
          index: event.logicalIndex,
          ...event.point,
        });
    });
    const applyTheme = () =>
      runtime.mutate((state) => applyChartTheme(state, element), "full");
    const unsubscribeSelection = Bus.subscribe<
      z.infer<typeof ChartEvent.ChartExplainRange.schema>
    >(ChartEvent.ChartExplainRange, (event) => {
      if (event.id === id) output.next({ type: "chart-explain", ...event });
    });
    const theme = new MutationObserver(applyTheme);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    applyTheme();
    setChart(runtime);
    return () => {
      alive = false;
      unsubscribe();
      unsubscribeSelection();
      observer.disconnect();
      theme.disconnect();
      element.removeEventListener("pointerleave", leave);
      visibility?.disconnect();
      output.complete();
      renderer.dispose();
    };
  }, [container, id]);
  useLayoutEffect(() => {
    if (chart)
      chart.mutate((state) => {
        state.display = timezone;
      }, "full");
  }, [chart, timezone]);
  return chart?.id === id ? chart : undefined;
}
