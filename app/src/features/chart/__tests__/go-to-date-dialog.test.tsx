// Purpose: Date jumps retain their original chart and visible elapsed time span.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { v2 } from "@openchart/chart-core";
import { Chart } from "@openchart/chart-core/chart/state";

import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import {
  GoToDateButton,
  GoToDateDialog,
} from "@openchart/app/features/chart/components/go-to-date";
import { createChartPreferences } from "@openchart/app/lib/chart/preferences";
import { applyTimeViewport } from "@openchart/app/lib/chart/data";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";
import { chartSettings } from "@openchart/app/stores/chart";

function createChart(
  width = 300,
  times = Array.from(
    { length: 200 },
    (_, index) => Date.UTC(2026, 9, 15) - (199 - index) * 86_400_000,
  ),
): ChartRuntime {
  const state = v2.createState();
  state.config.chart.dimensions = {
    ...state.config.chart.dimensions,
    width,
    height: 240,
  };
  const id = v2.ChartStateUtils.addSeries(state, {
    type: "Line",
    data: times.map((time, index) => ({
      time: time / 1000,
      value: index,
    })),
  });
  v2.ChartStateModel.getSeriesObject(state, id)!.role = "main";
  return { store: createChartStore(state) } as ChartRuntime;
}

beforeEach(() => {
  localStorage.clear();
  chartSettings.setState({ timezone: "UTC" });
  vi.setSystemTime(Date.UTC(2026, 9, 15, 16, 0, 0));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  {
    name: "weekends between daily bars",
    width: 300,
    resolution: "1d" as const,
    times: Array.from(
      { length: 500 },
      (_, index) => Date.UTC(2025, 0, 1) + index * 86_400_000,
    ).filter((time) => ![0, 6].includes(new Date(time).getUTCDay())),
    span: 57 * 86_400_000,
  },
  {
    name: "overnight and weekend gaps between hourly bars",
    width: 300,
    resolution: "1h" as const,
    times: Array.from(
      { length: 90 },
      (_, index) => Date.UTC(2026, 0, 1) + index * 86_400_000,
    )
      .filter((time) => ![0, 6].includes(new Date(time).getUTCDay()))
      .flatMap((time) =>
        Array.from(
          { length: 7 },
          (_, hour) => time + (14.5 + hour) * 3_600_000,
        ),
      ),
    span: 174 * 3_600_000,
  },
  {
    name: "the partially visible bar at the plot edge",
    width: 303,
    resolution: "1d" as const,
    times: Array.from(
      { length: 200 },
      (_, index) => Date.UTC(2026, 9, 15) - (199 - index) * 86_400_000,
    ),
    span: 41.5 * 86_400_000,
  },
])(
  "keeps the visible time span including $name",
  async ({ resolution, times, span, width }) => {
    const user = userEvent.setup();
    const chart = createChart(width, times);
    const localStore = createChartPreferences("go-to-date-gaps");
    render(
      <TooltipProvider>
        <GoToDateDialog
          localStore={localStore}
          resolution={resolution}
          chart={chart}
          onClose={vi.fn()}
        />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Go" }));
    const viewport = localStore.getState().viewport!;
    expect(viewport.to - viewport.from).toBe(span);
  },
);

it.each([300, 303])(
  "preserves plot spacing on a uniform timeline at %ipx chart width",
  async (width) => {
    const user = userEvent.setup();
    const chart = createChart(width);
    const localStore = createChartPreferences("go-to-date");
    const close = vi.fn();
    render(
      <TooltipProvider>
        <GoToDateDialog
          localStore={localStore}
          resolution="1d"
          chart={chart}
          onClose={close}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Go to date" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Go to latest" }),
    ).not.toBeInTheDocument();
    const time = screen.getByLabelText("Time");
    await user.clear(time);
    await user.type(time, "12:00");
    await user.click(screen.getByRole("button", { name: "Go" }));
    const viewport = localStore.getState().viewport;
    expect(viewport).not.toBeNull();
    const at = Date.UTC(2026, 9, 15, 12, 0, 0);
    expect(viewport!.from).toBeLessThan(at);
    expect(viewport!.to).toBeGreaterThan(at);
    expect(
      Chart.computeLayout(chart.store.getState().config).areaWidth,
    ).toBeLessThan(chart.store.getState().config.chart.dimensions.width);
    chart.store.setState((state) =>
      applyTimeViewport(state, viewport, 86_400_000),
    );
    expect(
      v2.XScale.getAxis(chart.store.getState().config.xAxis).spacing.barSpacing,
    ).toBeCloseTo(6);
    expect(close).toHaveBeenCalledOnce();
  },
);

it("keeps the dialog open when the clock is invalid", async () => {
  const user = userEvent.setup();
  const chart = createChart();
  const localStore = createChartPreferences("go-to-date-invalid");
  const close = vi.fn();
  render(
    <TooltipProvider>
      <GoToDateDialog
        localStore={localStore}
        resolution="1h"
        chart={chart}
        onClose={close}
      />
    </TooltipProvider>,
  );
  const time = screen.getByLabelText("Time");
  fireEvent.change(time, { target: { value: "" } });
  await user.click(screen.getByRole("button", { name: "Go" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid time");
  expect(close).not.toHaveBeenCalled();
  expect(localStore.getState().viewport).toBeNull();
});

it("opens the dialog from the chart toolbar control", async () => {
  const user = userEvent.setup();
  const chart = createChart();
  const localStore = createChartPreferences("go-to-date-button");
  render(
    <TooltipProvider>
      <GoToDateButton localStore={localStore} resolution="1d" chart={chart} />
    </TooltipProvider>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Go to date" }));
  expect(screen.getByRole("dialog", { name: "Go to date" })).toBeVisible();
  await act(async () => {
    await user.keyboard("{Escape}");
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps the original chart handles and resolution when focus changes", async () => {
  const user = userEvent.setup();
  const originalStore = createChartPreferences("go-to-date-original");
  const otherStore = createChartPreferences("go-to-date-other");
  const originalChart = createChart();
  const { rerender } = render(
    <TooltipProvider>
      <GoToDateButton
        localStore={originalStore}
        resolution="1d"
        chart={originalChart}
      />
    </TooltipProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Go to date" }));
  rerender(
    <TooltipProvider>
      <GoToDateButton
        localStore={otherStore}
        resolution="1h"
        chart={createChart(900)}
      />
    </TooltipProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Go" }));
  expect(otherStore.getState().viewport).toBeNull();
  const viewport = originalStore.getState().viewport;
  expect(viewport).not.toBeNull();
  originalChart.store.setState((state) =>
    applyTimeViewport(state, viewport, 86_400_000),
  );
  expect(
    v2.XScale.getAxis(originalChart.store.getState().config.xAxis).spacing
      .barSpacing,
  ).toBeCloseTo(6);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
