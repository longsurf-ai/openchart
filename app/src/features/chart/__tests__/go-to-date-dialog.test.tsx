// Purpose: The Go to date dialog writes a historical viewport or returns to latest.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import {
  GoToDateButton,
  GoToDateDialog,
} from "@openchart/app/features/chart/components/go-to-date";
import { createChartPreferences } from "@openchart/app/lib/chart/preferences";
import { chartSettings } from "@openchart/app/stores/chart";

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

it("saves a window around the chosen UTC date and can return to latest", async () => {
  const user = userEvent.setup();
  const localStore = createChartPreferences("go-to-date");
  const close = vi.fn();
  const view = render(
    <TooltipProvider>
      <GoToDateDialog localStore={localStore} resolution="1d" onClose={close} />
    </TooltipProvider>,
  );
  expect(screen.getByRole("dialog", { name: "Go to date" })).toBeVisible();
  const time = screen.getByLabelText("Time");
  await user.clear(time);
  await user.type(time, "12:00");
  await user.click(screen.getByRole("button", { name: "Go" }));
  const viewport = localStore.getState().viewport;
  expect(viewport).not.toBeNull();
  const at = Date.UTC(2026, 9, 15, 12, 0, 0);
  expect(viewport!.from).toBeLessThan(at);
  expect(viewport!.to).toBeGreaterThan(at);
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  const latest = vi.fn();
  render(
    <TooltipProvider>
      <GoToDateDialog
        localStore={localStore}
        resolution="1d"
        onClose={latest}
      />
    </TooltipProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Go to latest" }));
  expect(localStore.getState().viewport).toBeNull();
  expect(latest).toHaveBeenCalledOnce();
});

it("keeps the dialog open when the clock is invalid", async () => {
  const user = userEvent.setup();
  const localStore = createChartPreferences("go-to-date-invalid");
  const close = vi.fn();
  render(
    <TooltipProvider>
      <GoToDateDialog localStore={localStore} resolution="1h" onClose={close} />
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
  const localStore = createChartPreferences("go-to-date-button");
  render(
    <TooltipProvider>
      <GoToDateButton localStore={localStore} resolution="1d" />
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
