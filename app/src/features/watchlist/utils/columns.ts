// Purpose: Own how each metric column is labelled, sized, formatted, and coloured.
import type { Quote } from "../hooks/use-quote";
import type { Column, Metric } from "./tree";

/** Header label and fixed track width per metric. */
export const COLUMNS: Readonly<
  Record<Metric, { label: string; title: string; width: string }>
> = {
  price: { label: "Last", title: "Last price", width: "5.25rem" },
  change: { label: "Chg", title: "Change", width: "5rem" },
  changePercent: { label: "Chg%", title: "Change %", width: "5.25rem" },
  volume: { label: "Vol", title: "Volume", width: "5.5rem" },
  priceHistory: {
    label: "Price History",
    title: "Price history",
    width: "7.75rem",
  },
};

/** Metrics shown as one formatted number; Price History draws a sparkline. */
export type ScalarMetric = Exclude<Metric, "priceHistory">;

/** One CSS grid template shared by the header and every row. */
export function gridTemplate(columns: readonly Column[]): string {
  return ["minmax(6rem, 1fr)", ...columns.map(columnWidth)].join(" ");
}

function columnWidth(column: Column): string {
  return column.metric.kind === "formula"
    ? "7rem"
    : COLUMNS[column.metric.kind].width;
}

/** Minimum shared width for the header and rows; narrow widgets scroll both together. Pure CSS projection with no lifecycle or failures. @example minimumGridWidth(columns) */
export function minimumGridWidth(columns: readonly Column[]): string {
  return `calc(${["6rem", ...columns.map(columnWidth)].join(" + ")})`;
}

/** User titles take precedence; formula labels fall back to the script filename and chosen output. @example columnTitle(column) */
export function columnTitle(column: Column): string {
  if (column.title) return column.title;
  if (column.metric.kind !== "formula")
    return COLUMNS[column.metric.kind].title;
  const name =
    column.metric.source.path
      .split("/")
      .at(-1)
      ?.replace(/\.tea$/, "") ?? "Formula";
  return `${name} · ${column.metric.output}`;
}

/** Compact headers retain built-in abbreviations; formulas show their full user-defined label. @example columnLabel(column) */
export function columnLabel(column: Column): string {
  return (
    column.title ??
    (column.metric.kind === "formula"
      ? columnTitle(column)
      : COLUMNS[column.metric.kind].label)
  );
}

/** Format a finite formula result without treating missing data as zero. @example formatFormula(1.25) */
export function formatFormula(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value)
    ? "—"
    : smallPrice.format(value);
}

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 2,
});

const price = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const smallPrice = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const change = new Intl.NumberFormat(undefined, {
  signDisplay: "exceptZero",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  signDisplay: "exceptZero",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Display text for one metric; missing or non-finite values show a dash. */
export function formatMetric(
  metric: ScalarMetric,
  quote: Quote | undefined,
): string {
  const value = quote?.[metric];
  if (value === undefined || !Number.isFinite(value)) return "—";
  switch (metric) {
    case "price":
      return (Math.abs(value) < 1 ? smallPrice : price).format(value);
    case "change":
      return change.format(value);
    case "changePercent":
      return percent.format(value / 100);
    case "volume":
      return compact.format(value);
  }
}

/** Change columns are coloured by sign; price and volume stay neutral. */
export function metricTone(
  metric: ScalarMetric,
  quote: Quote | undefined,
): string {
  if (metric !== "change" && metric !== "changePercent") return "";
  const value = quote?.[metric];
  if (value === undefined || !Number.isFinite(value) || Math.abs(value) < 0.005)
    return "text-muted-foreground";
  return value > 0 ? "text-up" : "text-down";
}
