// Purpose: Verify the real drag library respects the rail handle and widget bounds.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { v2 } from "@openchart/chart-core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { EMPTY } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { DrawingToolbar } from "@openchart/app/features/chart/components/drawing-toolbar";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";

afterEach(() => vi.unstubAllGlobals());

it("drags only from the handle, clamps to the parent and leaves drawing controls operational", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const user = userEvent.setup();
  const initial = v2.createState({ id: "ccl_test" });
  initial.drawings.activeTool = "freehand";
  const store = createChartStore(initial);
  const chart: ChartRuntime = {
    id: initial.id,
    store,
    renderer: {} as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) =>
      store.setState((state) => {
        recipe(state);
      }, true),
  };
  const submit = vi.fn((event) => event.preventDefault());
  render(
    <StrictMode>
      <TooltipProvider>
        <form onSubmit={submit}>
          <div
            role="region"
            aria-label="Chart widget"
            style={{ position: "relative", padding: 0 }}
          >
            <DrawingToolbar chart={chart} />
          </div>
        </form>
      </TooltipProvider>
    </StrictMode>,
  );
  const parent = screen.getByRole("region", { name: "Chart widget" });
  const rail = screen.getByRole("toolbar", { name: "Drawing tools" });
  // jsdom has no Tailwind preflight; supply the box edges used by the library.
  Object.assign(rail.style, { margin: "0px", border: "0px" });
  Object.defineProperties(parent, {
    clientWidth: { value: 400 },
    clientHeight: { value: 500 },
  });
  Object.defineProperties(rail, {
    offsetParent: { value: parent },
    offsetLeft: { value: 12 },
    offsetTop: { value: 56 },
    clientWidth: { value: 44 },
    clientHeight: { value: 360 },
  });
  const drag = (target: HTMLElement, x: number, y: number) => {
    fireEvent.mouseDown(target, { button: 0, clientX: 30, clientY: 75 });
    fireEvent.mouseMove(document, {
      buttons: 1,
      clientX: 30 + x,
      clientY: 75 + y,
    });
    fireEvent.mouseUp(document, { clientX: 30 + x, clientY: 75 + y });
  };
  const handle = screen.getByRole("button", { name: "Move drawing toolbar" });
  drag(handle, 100, 40);
  expect(rail).toHaveStyle({ transform: "translate(100px,40px)" });
  const select = screen.getByRole("button", { name: "Select" });
  drag(select, 80, 50);
  expect(rail).toHaveStyle({ transform: "translate(100px,40px)" });
  fireEvent.click(select);
  expect(store.getState().drawings.activeTool).toBeNull();
  const measure = screen.getByRole("button", {
    name: "Measurement",
  });
  await user.click(measure);
  expect(
    screen.getByRole("menuitem", { name: "Volume Profile" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Measure" }));
  expect(
    screen.queryByRole("button", { name: "Volume" }),
  ).not.toBeInTheDocument();
  expect(store.getState().drawings.activeTool).toBe("measurement");
  expect(measure).toHaveAttribute("aria-pressed", "true");
  act(() =>
    chart.mutate((state) => {
      state.measurement = {
        seriesId: "main",
        phase: "complete",
        start: { time: 1, price: 1 },
        end: { time: 2, price: 2 },
      };
    }),
  );
  expect(
    screen.getByRole("button", { name: "Delete measurement" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Remove all drawings" }),
  ).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Delete measurement" }));
  expect(store.getState().measurement).toBeUndefined();
  expect(store.getState().drawings.activeTool).toBeNull();
  await user.click(measure);
  await user.click(screen.getByRole("menuitem", { name: "Volume Profile" }));
  expect(store.getState().drawings.activeTool).toBe("volume_profile");
  const explain = screen.getByRole("button", { name: "Chart explain" });
  fireEvent.click(explain);
  expect(store.getState().drawings.activeTool).toBe("agent_session");
  expect(explain).toHaveAttribute("aria-pressed", "true");
  expect(store.getState().measurement).toBeUndefined();
  expect(measure).toHaveAttribute("aria-pressed", "false");
  expect(select).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(select);
  expect(store.getState().drawings.activeTool).toBeNull();
  expect(explain).toHaveAttribute("aria-pressed", "false");
  expect(submit).not.toHaveBeenCalled();
  drag(handle, 1000, 1000);
  expect(rail).toHaveStyle({ transform: "translate(344px,84px)" });
  drag(handle, -1000, -1000);
  expect(rail).toHaveStyle({ transform: "translate(-12px,-56px)" });
});
