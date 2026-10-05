// Purpose: Draw a static chart for the account gate to dim behind sign-in.
import { Drawing, v2 } from "@openchart/chart-core";
import { useLayoutEffect } from "react";

import { ChartSeries } from "@openchart/app/features/chart/components/chart-series";
import { useChart } from "@openchart/app/hooks/use-chart";
import { ChartCore } from "@openchart/app/lib/chart/core";
import { chartTokenColor } from "@openchart/app/lib/chart/theme";

// A fixed pseudo-random walk of daily candles, so nothing is fetched before sign-in.
const candles = (() => {
  let seed = 11;
  const random = () => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647;
  let close = 100;
  return Array.from({ length: 180 }, (_, index) => {
    const open = close;
    close = open * (1 + (random() - 0.47) * 0.05);
    return {
      time: 1_767_225_600 + index * 86_400,
      open,
      high: Math.max(open, close) * (1 + random() * 0.015),
      low: Math.min(open, close) * (1 - random() * 0.015),
      close,
    };
  });
})();

const notes = [
  [45, "Earnings beat", "Revenue and guidance topped estimates."],
  [100, "Rate decision", "The central bank held rates steady."],
  [150, "Breakout", "Price cleared its six-month range."],
] as const;

function BackdropChart() {
  const chart = useChart();
  const element = chart.renderer.canvas?.parentElement;
  const up = element ? chartTokenColor(element, "--up") : "#26a69a";
  const down = element ? chartTokenColor(element, "--down") : "#ef5350";
  // Runs after ChartSeries has set the candles, so the viewport can fit them.
  useLayoutEffect(() => {
    chart.mutate((state) => {
      for (const [index, title, body] of notes)
        v2.ChartStateModel.upsertDrawingObject(
          state,
          Drawing.create("annotation", [], {
            time: candles[index]!.time,
            title,
            body,
            sources: [],
            sentiment: 0,
          }),
        );
      // Fit every candle to the window, leaving the usual right-edge margin.
      v2.ChartStateUtils.setVisibleRange(state, 0, candles.length + 8);
    }, "full");
  }, [chart]);
  return (
    <ChartSeries
      id="backdrop"
      type="Candlestick"
      source="provider"
      pane={0}
      axisId="right"
      main
      fieldMap={{ x: "time", value: "close" }}
      options={{
        upColor: up,
        downColor: down,
        wickUpColor: up,
        wickDownColor: down,
        borderUpColor: up,
        borderDownColor: down,
      }}
      axisOptions={{}}
      data={candles}
    />
  );
}

/**
 * One full-window candlestick chart with annotations, drawn from fixed data: no
 * queries, network or controls, and hidden from assistive technology. The
 * account gate dims it so users see the app behind sign-in.
 * @example <AccountGate transport={transport} backdrop={<WorkspaceBackdrop />}>{workspace}</AccountGate>
 */
export function WorkspaceBackdrop() {
  return (
    <div aria-hidden className="flex min-h-svh w-full flex-col bg-background">
      <ChartCore id="account-gate-backdrop" className="min-h-0 flex-1">
        <BackdropChart />
      </ChartCore>
    </div>
  );
}
