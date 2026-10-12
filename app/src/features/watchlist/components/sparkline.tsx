// Purpose: Draw a listing's latest session day against its previous close, as V1's Price History column did.
import { barsSeries, resolutionMs, type BarsRequest } from "@openchart/feed";
import type {
  ProviderListing,
  SessionType,
  TradingDay,
  TradingSession,
} from "@openchart/market";
import { mergeByTime } from "@openchart/timeseries";
import { useObservable, useObservableState } from "observable-hooks";
import { memo, useEffect, useId, useMemo, useState } from "react";
import {
  EMPTY,
  auditTime,
  catchError,
  of,
  scan,
  startWith,
  switchMap,
} from "rxjs";

import { useBars, useBarsCapabilities } from "@openchart/app/hooks/use-bars";
import { useCalendar } from "@openchart/app/hooks/use-calendar";

import { useWatchlistPlacement } from "./context";

const WIDTH = 100;
const HEIGHT = 16;
const PAD = 2;
const STEP = resolutionMs["5m"];
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** One drawn bar: its open time and close, and where it sits in pixels. */
type SparklinePoint = { time: number; close: number; x: number; y: number };

/** One row's geometry in pixels of a WIDTH × HEIGHT box. */
export type SparklineShape = {
  line: string;
  area: string;
  separators: string;
  /** The previous close's y: the line is green above it and red below. */
  base: number;
  reference: number;
  /** The day's half-open span in Unix ms. */
  start: number;
  end: number;
  points: readonly SparklinePoint[];
};

/**
 * Project 5-minute closes onto the latest session day that has begun. With
 * calendar `days`, x spans that day's sessions covered by the bars' `session`,
 * so time still to come stays blank and each later session start gets a
 * separator. With none, the day is the bars since the last gap over three
 * hours, at most one day. y includes `previousClose`, the baseline; the first
 * close stands in when it is missing. A gap over two bars breaks the line.
 * Returns null when the day has no finite close. Pure; allocates only strings.
 * @example const shape = sparklineShape(times, closes, days, "extended", 182.5);
 */
export function sparklineShape(
  times: readonly number[],
  closes: readonly (number | null)[],
  days: readonly TradingDay[],
  session: SessionType,
  previousClose: number | undefined,
): SparklineShape | null {
  const last = times.at(-1);
  if (last === undefined) return null;
  // Days ascend, so the last match is the latest day that has begun.
  let day: TradingSession[] | undefined;
  for (const { sessions } of days) {
    const covered = sessions.filter(
      ({ type }) =>
        session === "24h" ||
        type === "regular" ||
        (session === "extended" && type !== "overnight"),
    );
    if (covered[0] && covered[0].start <= last) day = covered;
  }
  let first = times.length - 1;
  while (
    !day &&
    first > 0 &&
    times[first]! - times[first - 1]! < 3 * HOUR &&
    last - times[first - 1]! < DAY
  )
    first--;
  const start = day ? day[0]!.start : times[first]!;
  const end = day ? day.at(-1)!.end : last + STEP;

  const bars: { time: number; close: number }[] = [];
  let low = previousClose ?? Infinity;
  let high = previousClose ?? -Infinity;
  times.forEach((time, index) => {
    const close = closes[index];
    if (time < start || time >= end || !Number.isFinite(close)) return;
    bars.push({ time, close: close! });
    low = Math.min(low, close!);
    high = Math.max(high, close!);
  });
  const [head] = bars;
  if (!head) return null;
  const reference = previousClose ?? head.close;
  const x = (time: number) => ((time - start) / (end - start)) * WIDTH;
  const y = (price: number) =>
    high === low
      ? HEIGHT / 2
      : PAD + ((high - price) / (high - low)) * (HEIGHT - 2 * PAD);
  const base = y(reference).toFixed(1);
  const points = bars.map((bar) => ({
    ...bar,
    x: x(bar.time),
    y: y(bar.close),
  }));
  let line = "";
  let area = "";
  let drop = "";
  let previous = -Infinity;
  for (const { time, x, y } of points) {
    const px = x.toFixed(1);
    const point = `${px} ${y.toFixed(1)}`;
    const gap = time - previous > 2 * STEP;
    line += `${gap ? "M" : "L"}${point}`;
    // Each run fills down to the baseline; fill closes every subpath.
    area += gap ? `${drop}M${px} ${base}L${point}` : `L${point}`;
    drop = `L${px} ${base}`;
    previous = time;
  }
  return {
    line,
    area: area + drop,
    separators: (day ?? [])
      .slice(1)
      .map(({ start }) => `M${x(start).toFixed(1)} 0V${HEIGHT}`)
      .join(""),
    base: Number(base),
    reference,
    start,
    end,
    points,
  };
}

/**
 * Where the shared crosshair at `time` falls in one row: its x, and the bar
 * open at that instant when one was drawn. Undefined outside the row's day,
 * so a row in another session or market shows no crosshair. Every row reads
 * the same absolute time, so rows compare at one instant, not one ratio.
 * @example const hover = sparklineAt(shape, Date.parse("2026-10-09T15:00Z"));
 */
export function sparklineAt(shape: SparklineShape, time: number) {
  if (time < shape.start || time >= shape.end) return undefined;
  let index = shape.points.length - 1;
  while (index >= 0 && shape.points[index]!.time > time) index--;
  const bar = shape.points[index];
  return {
    x: ((time - shape.start) / (shape.end - shape.start)) * WIDTH,
    bar: bar && time - bar.time < STEP ? bar : undefined,
  };
}

/**
 * A row's Price History cell: the latest session day of 5-minute closes
 * against `previousClose`, green above and red below, as V1 drew it. Uses the
 * source's extended 5-minute bars when offered, else its default 5-minute
 * session. Feed shares the live channel and the calendar is cached; the cell
 * redraws at most once a second, only for its own bars or a new previous
 * close. A missing calendar falls back to bar gaps. Without 5-minute bars, or
 * when they fail, the cell shows a rule and raises no toast. Unmounting
 * releases the channel.
 *
 * Hovering publishes the instant under the pointer to the placement's
 * crosshair; every row draws it at that same time and passes `onHover` its
 * close then, or undefined outside its day or bars, so rows compare at once.
 * @example <Sparkline provider={item.provider} listing={item.listing} previousClose={quote?.previousClose} onHover={setHovered} />
 */
export const Sparkline = memo(function Sparkline({
  provider,
  listing,
  previousClose,
  onHover,
}: ProviderListing & {
  previousClose?: number;
  onHover: (close: number | undefined) => void;
}) {
  // Feed requests are strict: send only the listing identity.
  const source = { provider, listing };
  const [now] = useState(Date.now);
  const capabilities = useBarsCapabilities(source, { silent: true });
  const calendar = useCalendar(
    { ...source, start: now - 7 * DAY, end: now + 7 * DAY, timezone: "UTC" },
    { silent: true },
  );
  const options = capabilities.data?.filter(
    (option) => option.resolution === "5m",
  );
  const option =
    options?.find((candidate) => candidate.session === "extended") ??
    options?.[0];
  if (!option) return <Rule />;
  return (
    <Line
      request={{
        ...barsSeries(source, option),
        from: now - DAY,
        to: "now",
        countBack: DAY / STEP,
      }}
      days={calendar.isPending ? undefined : (calendar.data?.days ?? [])}
      previousClose={previousClose}
      onHover={onHover}
    />
  );
});

/** Bars load beside the calendar; `days` is undefined until it settles. */
function Line({
  request,
  days,
  previousClose,
  onHover,
}: {
  request: BarsRequest;
  days: readonly TradingDay[] | undefined;
  previousClose: number | undefined;
  onHover: (close: number | undefined) => void;
}) {
  const { crosshair } = useWatchlistPlacement();
  const time = useObservableState(crosshair, null);
  const { current } = useBars(request);
  const frame = useObservableState(
    useObservable(
      (inputs$) =>
        inputs$.pipe(
          switchMap(([view]) =>
            view
              ? view.updates.pipe(
                  // useBars reports the failure; the last frame stays drawn.
                  catchError(() => EMPTY),
                  scan((data, update) => mergeByTime(data, update), view.data),
                  auditTime(1000),
                  startWith(view.data),
                )
              : of(undefined),
          ),
        ),
      [current],
    ),
  );
  const id = useId();
  const shape = useMemo(
    () =>
      frame && days
        ? sparklineShape(
            frame.column("time"),
            frame.column("close"),
            days,
            request.session,
            previousClose,
          )
        : null,
    [frame, days, request.session, previousClose],
  );
  const hover = shape && time !== null ? sparklineAt(shape, time) : undefined;
  const close = hover?.bar?.close;
  useEffect(() => onHover(close), [onHover, close]);
  if (!shape) return <Rule />;
  const split = shape.base / HEIGHT;
  const last = shape.points.at(-1)!;
  const tone = (price: number) =>
    price >= shape.reference ? "fill-up" : "fill-down";
  return (
    <svg
      role="img"
      aria-label={`Price history for ${request.listing.symbol}`}
      width={WIDTH}
      height={HEIGHT}
      className="cursor-crosshair justify-self-center overflow-visible"
      onPointerMove={(event) => {
        const { left } = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - left) / WIDTH;
        crosshair.next(shape.start + ratio * (shape.end - shape.start));
      }}
      onPointerLeave={() => crosshair.next(null)}
    >
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x2={0} y2={HEIGHT}>
        <stop offset={split} style={{ stopColor: "var(--up)" }} />
        <stop offset={split} style={{ stopColor: "var(--down)" }} />
      </linearGradient>
      <g className="stroke-muted-foreground/30" strokeWidth={0.5}>
        <path d={shape.separators} strokeDasharray="1.5 1.5" />
        <path d={`M0 ${shape.base}H${WIDTH}`} strokeDasharray="2 1.5" />
      </g>
      <path d={shape.area} fill={`url(#${id})`} fillOpacity={0.12} />
      <path
        d={shape.line}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={0.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {hover ? (
        <>
          <path
            d={`M${hover.x} 0V${HEIGHT}`}
            className="stroke-muted-foreground/50"
            strokeWidth={0.5}
          />
          {hover.bar ? (
            <circle
              cx={hover.x}
              cy={hover.bar.y}
              r={1.5}
              className={tone(hover.bar.close)}
            />
          ) : null}
        </>
      ) : (
        <circle cx={last.x} cy={last.y} r={1} className={tone(last.close)} />
      )}
    </svg>
  );
}

function Rule() {
  return <span aria-hidden className="mx-3 h-px bg-border" />;
}
