// Purpose: Chart the Dashboard symbol's daily closes with Vega-Lite; the page's symbol control chooses the listing.
import { useEffect, useRef, useState } from "react";
import embed from "vega-embed";
import {
  Button,
  barsSeries,
  defineWidget,
  mergeByTime,
  useBars,
  useBarsCapabilities,
  useSymbol,
  type BarsRequest,
  type ProviderListing,
} from "@openchart/widget";

const DAY = 86_400_000;

function PriceChart() {
  // Click this widget, then choose its symbol with the dashboard's symbol control.
  const listing = useSymbol();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        height: "100%",
        padding: 12,
      }}
    >
      {listing ? (
        <>
          <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
            {listing.listing.symbol} · daily close
          </span>
          <DailyCloses listing={listing} />
        </>
      ) : (
        <p style={{ color: "var(--muted-foreground)" }}>
          Click this widget, then choose a symbol at the top left of the
          dashboard.
        </p>
      )}
    </div>
  );
}

function DailyCloses({ listing }: { listing: ProviderListing }) {
  const capabilities = useBarsCapabilities(listing);
  // useBars reopens its stream whenever the request changes, so `from` is fixed once.
  const [from] = useState(() => Date.now() - 365 * DAY);
  const daily = capabilities.data?.find((option) => option.resolution === "1d");
  if (capabilities.error) return <p>Couldn’t load this symbol.</p>;
  if (!capabilities.data) return <p>Loading…</p>;
  if (!daily) return <p>Daily bars aren’t available for this symbol.</p>;
  return (
    <Chart
      request={{
        ...barsSeries(listing, daily),
        from,
        to: "now",
        countBack: 250,
      }}
    />
  );
}

function Chart({ request }: { request: BarsRequest }) {
  const bars = useBars(request);
  const element = useRef<HTMLDivElement>(null);
  const current = bars.current;
  useEffect(() => {
    if (!element.current || !current) return;
    let frame = current.data;
    const values = () =>
      Array.from(frame, (row) => ({ date: row.time, close: row.close }));
    // Canvas needs resolved colors; the app's theme variables follow light and dark.
    const style = getComputedStyle(element.current);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const muted = color("--muted-foreground");
    const border = color("--border");
    const chart = embed(
      element.current,
      {
        width: "container",
        height: "container",
        background: "transparent",
        data: { name: "bars", values: values() },
        mark: { type: "line", tooltip: true, color: color("--chart-1") },
        encoding: {
          x: { field: "date", type: "temporal", title: null },
          y: { field: "close", type: "quantitative", scale: { zero: false } },
        },
        config: {
          view: { stroke: null },
          axis: {
            labelColor: muted,
            titleColor: muted,
            gridColor: border,
            domainColor: border,
            tickColor: border,
          },
        },
      },
      { actions: false },
    );
    // Live bars arrive as updates, not renders: fold each in and redraw.
    const subscription = current.updates.subscribe({
      next: (update) => {
        frame = mergeByTime(frame, update);
        void chart.then(({ view }) => view.data("bars", values()).runAsync());
      },
      error: () => {}, // useBars reports it as bars.status === "error".
    });
    return () => {
      subscription.unsubscribe();
      void chart.then((result) => result.finalize());
    };
  }, [current]);
  if (bars.status === "error")
    return (
      <Button size="sm" variant="outline" onClick={bars.retry}>
        Retry
      </Button>
    );
  return <div ref={element} style={{ flex: 1, minHeight: 0 }} />;
}

export default defineWidget({
  kind: "price-chart",
  title: "Price chart",
  Component: PriceChart,
});
