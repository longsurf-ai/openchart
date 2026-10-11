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

function price(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(value) < 1 ? 6 : 2,
  });
}

/** Changes always show two decimals so the column never truncates. */
function change(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Display text for one metric; missing or non-finite values show a dash. */
export function formatMetric(metric: Metric, quote: Quote | undefined): string {
  const value = quote?.[metric];
  if (value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  switch (metric) {
    case "price":
      return price(value);
    case "change":
      return `${sign}${change(value)}`;
    case "changePercent":
      return `${sign}${value.toFixed(2)}%`;
    case "volume":
      return compact.format(value);
  }
}

/** Change columns are coloured by sign; price and volume stay neutral. */
export function metricTone(metric: Metric, quote: Quote | undefined): string {
  if (metric !== "change" && metric !== "changePercent") return "";
  const value = quote?.[metric];
  if (value === undefined || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-up" : "text-down";
}
