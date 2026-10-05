// Purpose: Keep expanded annotation content aligned with canvas-owned geometry and Drawing updates.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Drawing, v2 } from "@openchart/chart-core";
import { Bus, ChartEvent } from "@openchart/chart-core/bus";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { EMPTY } from "rxjs";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { AnnotationCard } from "@openchart/app/features/chart/components/annotation-card";
import { ChartContext } from "@openchart/app/lib/chart/context";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";

it("shows live content and sources at the published rectangle, then clears on close/removal", () => {
  const state = v2.createState({ id: "chart" });
  const item = Drawing.create("annotation", [], {
    time: 1000,
    title: "Earnings",
    body: "Revenue rose.",
    sources: [{ title: "Report", url: "https://example.com/report" }],
    sentiment: 0.5,
  });
  v2.ChartStateModel.upsertDrawingObject(state, item);
  state.expandedAnnotation = { id: item.id, body: "preview" };
  const store = createChartStore(state);
  const chart: ChartRuntime = {
    id: state.id,
    store,
    output$: EMPTY,
    renderer: {
      canvas: document.createElement("canvas"),
      render: vi.fn(),
      beginAnnotationDrag: vi.fn(),
    } as unknown as v2.ChartRenderer,
    mutate: (recipe) => store.setState(recipe, true),
  };
  const view = render(
    <TooltipProvider>
      <ChartContext.Provider value={chart}>
        <AnnotationCard />
      </ChartContext.Provider>
    </TooltipProvider>,
  );
  const publish = (chartId: string, x: number) =>
    Bus.publish(ChartEvent.AnnotationHover, {
      id: chartId,
      hit: {
        kind: "chart_annotation",
        id: item.id,
        expanded: true,
        bodyTruncated: true,
        part: "body",
        anchor: { x, y: 80 },
        pill: { x, y: 80, width: 400, height: 300 },
      },
    });
  act(() => publish("other-chart", 100));
  expect(
    screen.queryByRole("region", { name: "Earnings" }),
  ).not.toBeInTheDocument();
  act(() => publish(chart.id, 100));
  expect(screen.getByRole("region", { name: "Earnings" })).toHaveStyle({
    left: "100px",
    top: "80px",
    width: "400px",
    height: "300px",
  });
  expect(screen.getByRole("link", { name: "Report" })).toHaveAttribute(
    "href",
    "https://example.com/report",
  );
  expect(screen.getByText("1 source")).toBeInTheDocument();
  const sourceLink = screen.getByRole("link", { name: "Report" });
  act(() =>
    chart.mutate((next) => {
      next.sourceBadgesByAnnotationId = {
        [item.id]: [
          {
            id: "https://example.com/report",
            label: "Report",
            logoUrl: "data:image/png;base64,AA==",
          },
        ],
      };
    }),
  );
  const icon = within(sourceLink).getByRole("presentation");
  expect(icon).toHaveAttribute("src", "data:image/png;base64,AA==");
  fireEvent.error(icon);
  expect(sourceLink).toHaveTextContent("R");
  expect(v2.ChartStateModel.drawingItems(store.getState())[0]).toEqual(item);
  fireEvent.mouseDown(screen.getByRole("heading", { name: "Earnings" }), {
    clientX: 180,
    clientY: 120,
    button: 0,
  });
  expect(chart.renderer.beginAnnotationDrag).toHaveBeenCalledWith(item.id, {
    x: 180,
    y: 120,
  });
  fireEvent.mouseDown(screen.getByRole("link", { name: "Report" }), {
    button: 0,
  });
  fireEvent.mouseDown(
    screen.getByRole("button", { name: "Read full explanation" }),
    { button: 0 },
  );
  expect(chart.renderer.beginAnnotationDrag).toHaveBeenCalledTimes(1);
  fireEvent.mouseLeave(screen.getByRole("region", { name: "Earnings" }), {
    buttons: 1,
  });
  expect(store.getState().expandedAnnotation).toEqual({
    id: item.id,
    body: "preview",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Read full explanation" }),
  );
  expect(store.getState().expandedAnnotation).toEqual({
    id: item.id,
    body: "full",
  });
  expect(v2.ChartStateModel.drawingItems(store.getState())[0]).toEqual(item);
  act(() => {
    chart.mutate((next) =>
      v2.ChartStateModel.upsertDrawingObject(next, {
        ...item,
        body: "Revised explanation.",
      } as Drawing.AnnotationItem),
    );
    publish(chart.id, 150);
  });
  expect(screen.getByText("Revised explanation.")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Earnings" })).toHaveStyle({
    left: "150px",
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(store.getState().expandedAnnotation).toBeUndefined();
  expect(
    screen.queryByRole("region", { name: "Earnings" }),
  ).not.toBeInTheDocument();
  act(() => {
    chart.mutate((next) => {
      next.expandedAnnotation = { id: item.id, body: "preview" };
    });
    publish(chart.id, 150);
    chart.mutate((next) =>
      v2.ChartStateModel.removeDrawingObject(next, item.id),
    );
  });
  expect(
    screen.queryByRole("region", { name: "Earnings" }),
  ).not.toBeInTheDocument();
  view.unmount();
});
