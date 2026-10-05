// Purpose: Project Tea series, decorations and vertical profiles through the same chart renderer in previews and installed studies.
import { memo, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { Chart, v2 } from "@openchart/chart-core";
import { Color } from "@openchart/chart-core/util";
import {
  indicatorPoint,
  indicatorProfiles,
  restyleProfiles,
} from "@openchart/app/lib/chart/indicator-data";
import {
  createIndicatorPrimitive,
  type IndicatorVisualRow,
  type IndicatorVisualHit,
  type IndicatorDecoration,
} from "@openchart/app/lib/chart/tea-visual-primitive";
import {
  decodeIndicatorVisual,
  visualCssColor,
} from "@openchart/app/lib/chart/tea-visual-value";
import type { Primitive } from "@openchart/chart-core/primitive";
import * as Tea from "@openchart/tea";
import { joinByTime, type DataFrame } from "@openchart/timeseries";
import { useChart } from "@openchart/app/hooks/use-chart";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import { mainTimeline } from "@openchart/app/lib/chart/data";
import {
  defaultSeriesPreferences,
  type ChartPreferencesStore,
} from "@openchart/app/lib/chart/preferences";
import { defaultIndicatorOutputSeriesOptions } from "@openchart/app/lib/chart/indicator-output-style";
import { ChartSeries, type ChartSeriesProps } from "./chart-series";
import { ChartVerticalProfiles } from "./chart-vertical-profiles";

/** Resource-owned placement of one named Tea output, including generated decorations. */
export interface TeaVisualBinding {
  id: string;
  output: string;
  pane: number;
  paneId: string;
  mainPane: boolean;
}
const valueFields = { x: "time", value: "value", color: "color" };
const candleFields = {
  x: "time",
  open: "open",
  high: "high",
  low: "low",
  close: "close",
};
type ProjectedSeries = { binding: TeaVisualBinding; props: ChartSeriesProps };
type Decoration = {
  binding: TeaVisualBinding;
  kind: IndicatorDecoration["kind"];
  rows: IndicatorVisualRow[];
};
type Profiles = {
  binding: TeaVisualBinding;
  profiles: ReturnType<typeof indicatorProfiles>;
};

/** Project one immutable observation, replacing only this attachment's contributions.
 * Rendering and preferences never restart Tea. Invalid output clears the projection.
 * @example <TeaVisuals sourceId={indicator.id} compiled={tea.compiled} frame={tea.data} bindings={bindings} preferences={preferences} />
 */
export const TeaVisuals = memo(function TeaVisuals({
  sourceId,
  compiled,
  frame,
  bindings,
  preferences,
}: {
  sourceId: string;
  compiled: Pick<Tea.CompileResponse, "definition" | "declaration"> | undefined;
  frame: DataFrame | undefined;
  bindings: readonly TeaVisualBinding[];
  preferences: ChartPreferencesStore;
}) {
  const chart = useChart();
  const prefs = useStore(preferences);
  const timezone = useStore(chart.store, (state) =>
    Chart.resolveTimeDisplayTimezone(
      state,
      v2.ChartStateModel.mainSeries(state)?.id,
    ),
  );
  const dates = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: timezone === "local" ? undefined : timezone,
      }),
    [timezone],
  );
  const background = useStore(
    chart.store,
    (state) => state.config.chart.layout.background,
  );
  const mainId = useStore(
    chart.store,
    (state) => v2.ChartStateModel.mainSeries(state)?.id,
  );
  const mainData = useStore(chart.store, (state) => {
    const main = v2.ChartStateModel.mainSeries(state);
    return main && !bindings.some((binding) => binding.id === main.id)
      ? main.data
      : undefined;
  });
  // Profiles carry their own time boxes, so they depend on the frame alone:
  // new chart bars and style changes never decode them again.
  const decoded = useMemo((): { profiles: Profiles[]; error?: string } => {
    try {
      if (!compiled) return { profiles: [] };
      const outputs = Tea.indicatorOutputs(compiled);
      return {
        profiles: bindings.flatMap((binding): Profiles[] =>
          outputs.some(
            ({ name, kind }) =>
              name === binding.output && kind === "vertical-profile",
          )
            ? [
                {
                  binding,
                  profiles: frame
                    ? indicatorProfiles(frame.column(binding.output))
                    : [],
                },
              ]
            : [],
        ),
      };
    } catch (error) {
      return {
        profiles: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [compiled, frame, bindings]);
  const seriesPrefs = prefs.series;
  const drawn = useMemo(
    () =>
      decoded.profiles.map(({ binding, profiles }) => ({
        binding,
        profiles: restyleProfiles(
          profiles,
          seriesPrefs[binding.id]?.partColors,
        ).map((profile) => ({
          ...profile,
          // Hidden profiles stay placed, so Style still lists their parts.
          visible:
            profile.visible && seriesPrefs[binding.id]?.visible !== false,
        })),
      })),
    [decoded, seriesPrefs],
  );
  const projection = useMemo(() => {
    const series: ProjectedSeries[] = [];
    const decorations: Decoration[] = [];
    const fills: Record<
      string,
      { time: number; value: number | null; offset: number }[]
    > = {};
    try {
      if (!compiled) return { series, decorations, fills };
      const outputs = Tea.indicatorOutputs(compiled);
      const outputOf = (binding: TeaVisualBinding) => {
        const output = outputs.find((output) => output.name === binding.output);
        if (!output)
          throw new Error(
            `Output “${binding.output}” no longer exists. Remove and re-add the indicator.`,
          );
        return output;
      };
      // Lines and decorations follow the main timeline: each chart bar shows
      // the last row that opened inside it, which keeps a script on finer
      // bars (`timeframe = "auto"`) at one point per bar. Reading a row
      // copies every output in it, so rows are read only when something
      // here needs them.
      const timeline = mainData ? mainTimeline(chart.store.getState()) : [];
      const rows =
        frame &&
        bindings.some(
          (binding) => outputOf(binding).kind !== "vertical-profile",
        )
          ? [
              ...(timeline.length
                ? joinByTime(timeline, frame, { fill: "last" })
                : frame),
            ]
          : [];
      for (const [index, binding] of bindings.entries()) {
        const output = outputOf(binding);
        const saved = prefs.series[binding.id];
        if (output.kind === "vertical-profile") continue;
        if (
          output.kind !== "numeric" &&
          output.kind !== "series" &&
          output.kind !== "horizontal-line" &&
          output.kind !== "candles"
        ) {
          decorations.push({
            binding,
            kind: output.kind,
            rows: rows.map((row) => ({
              time: row.time / 1000,
              value: decodeIndicatorVisual(
                row[binding.output],
                output.kind as IndicatorDecoration["kind"],
              ),
            })),
          });
          continue;
        }
        let data: Record<string, unknown>[];
        let authored: Record<string, unknown>;
        if (output.kind === "candles") {
          const candles = rows.map((row) => ({
            time: row.time / 1000,
            candle: decodeIndicatorVisual(row[binding.output], "candles"),
          }));
          data = candles.map(({ time, candle }) => ({
            time,
            open: candle?.open ?? null,
            high: candle?.high ?? null,
            low: candle?.low ?? null,
            close: candle?.close ?? null,
            title: candle?.title || binding.output,
            color: candle ? visualCssColor(candle.color) : undefined,
            wickColor: candle ? visualCssColor(candle.wickcolor) : undefined,
            borderColor: candle
              ? visualCssColor(candle.bordercolor)
              : undefined,
          }));
          authored = {
            type: "Candlestick",
            title:
              [...candles].reverse().find(({ candle }) => candle !== null)
                ?.candle?.title || binding.output,
          };
        } else {
          const kind = output.kind;
          const points = rows.map((row) => ({
            time: row.time / 1000,
            ...indicatorPoint(row[binding.output], kind),
          }));
          const appearance = [...points]
            .reverse()
            .find(
              (point) => point.value !== null && Number.isFinite(point.value),
            );
          const defaults = defaultIndicatorOutputSeriesOptions({
            definitionName: compiled.declaration?.title,
            outputName: binding.output,
            outputIndex: index,
            seriesType: appearance?.type ?? "Line",
          });
          authored = {
            title: appearance?.title || binding.output,
            type: appearance?.type ?? "Line",
            color: appearance?.color ?? String(defaults.color),
            lineWidth: appearance?.lineWidth ?? 1.5,
            base: appearance?.base ?? 0,
            lineType: appearance?.lineType ?? "linear",
            lineStyle: appearance?.lineStyle ?? "solid",
            visible: appearance?.visible ?? true,
            xOffset: appearance?.offset ?? 0,
          };
          data = points.map((point, index) => ({
            ...point,
            value:
              point.showLast > 0 && index < points.length - point.showLast
                ? null
                : point.value,
            title: point.title || binding.output,
            color: saved?.color ?? point.color ?? String(defaults.color),
          }));
          fills[binding.output] = data.map((point) => ({
            time: point.time as number,
            value: point.value as number | null,
            offset: point.offset as number,
          }));
        }
        const options = { ...defaultSeriesPreferences, ...authored, ...saved };
        const axisId = options.ownAxis
          ? `${sourceId}:axis`
          : binding.mainPane
            ? "right"
            : `pane:${binding.paneId}`;
        const color = String(options.color ?? "#808080");
        series.push({
          binding,
          props: {
            source: "computed",
            id: binding.id,
            type: String(options.type),
            pane: binding.pane,
            axisId,
            fieldMap: output.kind === "candles" ? candleFields : valueFields,
            options: {
              ...options,
              lineColor: color,
              topLineColor: color,
              bottomLineColor: color,
              topColor: Color.withAlpha(color, 0.24),
              bottomColor: Color.withAlpha(color, 0.03),
            },
            axisOptions: prefs.axes[axisId] ?? {},
            data: data.map((point) => Object.freeze(point)),
          },
        });
      }
      for (const decoration of decorations)
        if (decoration.kind === "fill") {
          for (const { value } of decoration.rows)
            if (
              value?.kind === "fill" &&
              (!fills[value.first] || !fills[value.second])
            )
              throw new Error(
                "A fill must reference two numeric plots from this study.",
              );
        }
      return { series, decorations, fills };
    } catch (error) {
      return {
        series: [] as ProjectedSeries[],
        decorations: [] as Decoration[],
        fills: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [compiled, frame, bindings, mainData, chart, prefs, sourceId]);
  useErrorToast(projection.error ?? decoded.error, {
    id: `indicator-visuals:${chart.id}:${sourceId}`,
    title: "Couldn’t display indicator",
  });
  useLayoutEffect(() => {
    const groups = new Map<string, Primitive.SeriesPrimitive[]>();
    for (const decoration of projection.decorations) {
      if (prefs.series[decoration.binding.id]?.visible === false) continue;
      for (const onPrice of [false, true]) {
        const rows = decoration.rows.filter(
          ({ value }) =>
            Boolean(
              value &&
              (value.kind === "bar-color" ||
                ("force_overlay" in value && value.force_overlay)),
            ) === onPrice,
        );
        if (!rows.some(({ value }) => value !== null)) continue;
        const anchor = projection.series.find(
          ({ binding, props }) =>
            binding.pane === decoration.binding.pane &&
            props.options.visible !== false,
        );
        const target = onPrice
          ? mainId
          : (anchor?.binding.id ??
            (decoration.binding.mainPane ? mainId : undefined));
        if (!target) continue;
        const list = groups.get(target) ?? [];
        list.push(
          createIndicatorPrimitive({
            id: `${sourceId}:${decoration.binding.id}:${onPrice}`,
            kind: decoration.kind,
            rows,
            outputs: projection.fills,
            background,
            labelLimit: chart.store.getState().config.interaction.enabled
              ? 8
              : 2,
          }),
        );
        groups.set(target, list);
      }
    }
    for (const [target, primitives] of groups)
      chart.renderer.setSeriesPrimitives(target, sourceId, primitives);
    return () => {
      for (const target of groups.keys())
        chart.renderer.setSeriesPrimitives(target, sourceId, []);
    };
  }, [chart, sourceId, projection, prefs, mainId, background]);
  const [hoverState, setHover] = useState<{
    x: number;
    y: number;
    hit: IndicatorVisualHit;
    projection: typeof projection;
  }>();
  const hover = hoverState?.projection === projection ? hoverState : undefined;
  const hasDecorations = projection.decorations.length > 0;
  useEffect(() => {
    if (!hasDecorations) return;
    const canvas = chart.renderer.canvas;
    const move = (event: PointerEvent) => {
      if (!chart.store.getState().config.interaction.enabled) return;
      const bounds = canvas.getBoundingClientRect();
      const x = event.clientX - bounds.left,
        y = event.clientY - bounds.top;
      const result = chart.renderer.primitiveAt(x, y);
      if (!result?.id?.startsWith(`${sourceId}:`) || !result.data) {
        setHover(undefined);
        return;
      }
      setHover({
        projection,
        x: Math.min(x + 12, Math.max(8, bounds.width - 220)),
        y: Math.max(8, y - 54),
        hit: result.data as IndicatorVisualHit,
      });
    };
    const leave = () => setHover(undefined);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    return () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, [chart, sourceId, hasDecorations, projection]);
  return (
    <>
      {drawn.map(({ binding, profiles }) => (
        <ChartVerticalProfiles
          key={binding.id}
          id={binding.id}
          pane={binding.pane}
          axisId={
            prefs.series[binding.id]?.ownAxis
              ? `${sourceId}:axis`
              : binding.mainPane
                ? "right"
                : `pane:${binding.paneId}`
          }
          profiles={profiles}
        />
      ))}
      {projection.series.map(({ props }) => (
        <ChartSeries key={props.id} {...props} />
      ))}
      {hover ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-56 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={{ left: hover.x, top: hover.y }}
        >
          <p className="font-medium">{hover.hit.text}</p>
          <p className="mt-1 text-muted-foreground">
            {hover.hit.range
              ? `${dates.format(hover.hit.range.from * 1000)} – ${dates.format(hover.hit.range.to * 1000)}`
              : `Confirmed ${dates.format(hover.hit.time * 1000)}`}
          </p>
          {hover.hit.values ? (
            <p className="mt-1 tabular-nums">
              {hover.hit.values.from.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              →{" "}
              {hover.hit.values.to.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
});
