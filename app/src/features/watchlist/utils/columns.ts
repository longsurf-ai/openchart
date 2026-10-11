// Purpose: Own how each metric column is labelled, sized, formatted, and coloured.
import type { Quote } from "../hooks/use-quote";
import type { Metric } from "./tree";

/** Header label and fixed track width per metric. */
export const COLUMNS: Readonly<
  Record<Metric, { label: string; title: string; width: string }>
> = {
  price: { label: "Last", title: "Last price", width: "5.25rem" },
  change: { label: "Chg", title: "Change", width: "5rem" },
  changePercent: { label: "Chg%", title: "Change %", width: "5.25rem" },
  volume: { label: "Vol", title: "Volume", width: "5.5rem" },
};

/** One CSS grid template shared by the header and every row. */
export function gridTemplate(metrics: readonly Metric[]): string {
  return ["minmax(6rem, 1fr)", ...metrics.map((m) => COLUMNS[m].width)].join(
    " ",
  );
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
export function formatMetric(metric: Metric, quote: Quote | undefined): string {
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
export function metricTone(metric: Metric, quote: Quote | undefined): string {
  if (metric !== "change" && metric !== "changePercent") return "";
  const value = quote?.[metric];
  if (value === undefined || !Number.isFinite(value) || Math.abs(value) < 0.005)
    return "text-muted-foreground";
  return value > 0 ? "text-up" : "text-down";
}
