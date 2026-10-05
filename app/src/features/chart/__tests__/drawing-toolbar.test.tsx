// Purpose: Verify the real drag library respects the rail handle and widget bounds.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { v2 } from "@openchart/chart-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { EMPTY } from "rxjs";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { DrawingToolbar } from "@openchart/app/features/chart/components/drawing-toolbar";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";

it("drags only from the handle, clamps to the parent and leaves drawing controls operational", () => {
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
  const explain = screen.getByRole("button", { name: "Chart explain" });
  fireEvent.click(explain);
  expect(store.getState().drawings.activeTool).toBe("agent_session");
  expect(explain).toHaveAttribute("aria-pressed", "true");
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
