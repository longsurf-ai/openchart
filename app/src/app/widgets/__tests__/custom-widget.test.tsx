// Purpose: Verify saved widget code runs against the module table, remounts per revision, keeps failures in its card and takes its symbol from the Dashboard header, which it shares with the chart.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";

import { DashboardHeader } from "@openchart/app/app/dashboard/dashboard-header";
import {
  customWidgetDefinition,
  evaluateWidget,
  widgetModules,
} from "@openchart/app/app/widgets/custom/custom-widget";
import * as sdk from "@openchart/app/app/widgets/custom/sdk";
import { ChartSelectionProvider } from "@openchart/app/features/chart/components/selection-provider";
import { useChartSelection } from "@openchart/app/hooks/use-chart-selection";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { WidgetContext } from "@openchart/app/lib/widget/widget";
import guide from "../../../../../docs/agent/widget.md?raw";
import { widgetImports } from "../../../../tooling/widget-types";

vi.mock("@openchart/app/app/page-header", () => ({
  PageHeader: ({ children }: PropsWithChildren) => <header>{children}</header>,
}));
vi.mock("vega-embed", () => ({ default: vi.fn() }));
// The chart's own control reads Chart Resources; these tests only need to see it is the target.
vi.mock(
  "@openchart/app/features/chart/components/symbol-control",
  async (original) => ({
    ...(await original<
      typeof import("@openchart/app/features/chart/components/symbol-control")
    >()),
    SymbolControl: ({ chartId }: { chartId: string }) => (
      <button>Chart {chartId}</button>
    ),
  }),
);
// The real picker searches Feed; this one offers one listing.
vi.mock("@openchart/app/features/chart/components/symbol-picker", () => ({
  SymbolPicker: ({
    onSelect,
  }: {
    onSelect: (listing: { provider: string; listing: object }) => void;
  }) => (
    <button
      onClick={() =>
        onSelect({
          provider: "yfinance",
          listing: { symbol: "AAPL", currency: "USD" },
        })
      }
    >
      Pick AAPL
    </button>
  ),
}));

// What the server's transpiler emits for a small widget (CommonJS, esModuleInterop).
const counter = (label: string) => `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const widget_1 = require("@openchart/widget");
function Counter() {
  const [count, setCount] = (0, react_1.useState)(0);
  return (0, jsx_runtime_1.jsxs)("button", { onClick: () => setCount(count + 1), children: ["${label} ", count] });
}
exports.default = (0, widget_1.defineWidget)({ kind: "counter", title: "Counter", Component: Counter });
`;

test("serves exactly the specifiers the server checks against, all documented", () => {
  expect(Object.keys(widgetModules).sort()).toEqual(
    Object.keys(widgetImports).sort(),
  );
  const undocumented = [
    ...Object.keys(widgetModules),
    ...Object.keys(sdk),
  ].filter((name) => !new RegExp(`\`${name}[\`(]`).test(guide));
  expect(undocumented).toEqual([]);
});

test("rejects modules outside the module table and exports that are not widgets", async () => {
  await expect(evaluateWidget('require("node:fs");', "bad")).rejects.toThrow(
    "Widgets cannot import node:fs.",
  );
  await expect(
    evaluateWidget("exports.default = 42;", "empty"),
  ).rejects.toThrow("default-export defineWidget");
});

// Stands in for a chart cell taking focus, which hands the header back to the chart.
function FocusChart() {
  const { focus } = useChartSelection();
  return (
    <button onClick={() => focus("cht_test", "ccl_test")}>Focus chart</button>
  );
}

function setup(
  code: string | null = counter("Clicks"),
  dashboard?: Dashboard,
  charts: { id: string }[] = [],
) {
  let compiled = code === null ? null : { revision: 1, code };
  // The header's Widgets menu lists saved widgets on mount and its rows read
  // `source.path`, while the card reads only `compiled`.
  const transport = {
    url: "test",
    rpc: {
      resources: {
        custom_widget: {
          list: { query: vi.fn(async () => ({ items: [], cursor: null })) },
          compiled: { query: vi.fn(async () => compiled) },
        },
        chart: {
          list: { query: vi.fn(async () => ({ items: charts, cursor: null })) },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { Content } = customWidgetDefinition("counter");
  render(
    <QueryClientProvider client={client}>
      <ChartSelectionProvider>
        <FocusChart />
        {dashboard ? (
          <DashboardHeader
            dashboard={dashboard}
            transport={transport}
            disabled={false}
            onAdd={vi.fn()}
          />
        ) : null}
        <WidgetContext.Provider
          value={{
            placementId: "wdg_custom",
            dashboardId: "dsh_test",
            transport,
            holdControls: () => () => {},
            placeBeside: vi.fn(),
          }}
        >
          <Content />
        </WidgetContext.Provider>
      </ChartSelectionProvider>
    </QueryClientProvider>,
  );
  return {
    // A save publishes resource.changed; Resource invalidation refetches these keys.
    publish: async (next: { revision: number; code: string }) => {
      compiled = next;
      await act(() =>
        client.invalidateQueries({
          queryKey: [["resources", "custom_widget"]],
        }),
      );
    },
  };
}

test("renders the saved widget and remounts it when a new revision is saved", async () => {
  const user = userEvent.setup();
  const { publish } = setup();
  await user.click(await screen.findByRole("button", { name: "Clicks 0" }));
  expect(screen.getByRole("button", { name: "Clicks 1" })).toBeInTheDocument();
  await publish({ revision: 2, code: counter("Taps") });
  expect(
    await screen.findByRole("button", { name: "Taps 0" }),
  ).toBeInTheDocument();
  await publish({
    revision: 3,
    code: 'exports.default = { kind: "counter", Component() { throw new Error("broken render"); } };',
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("broken render");
  await publish({ revision: 4, code: counter("Fixed") });
  expect(
    await screen.findByRole("button", { name: "Fixed 0" }),
  ).toBeInTheDocument();
});

test("explains a placement whose widget is no longer saved", async () => {
  setup(null);
  expect(
    await screen.findByText(/No saved widget is named “counter”/),
  ).toHaveAttribute("role", "status");
});

// Reads the Dashboard symbol; it renders no picker of its own.
const symbolReader = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const widget_1 = require("@openchart/widget");
function Quote() {
  const listing = (0, widget_1.useSymbol)();
  return (0, jsx_runtime_1.jsx)("p", { children: listing ? "Showing " + listing.listing.symbol : "No symbol yet" });
}
exports.default = (0, widget_1.defineWidget)({ kind: "counter", title: "Counter", Component: Quote });
`;

test("the Dashboard header's symbol control chooses a custom widget's symbol", async () => {
  const user = userEvent.setup();
  setup(symbolReader, {
    id: "dsh_test" as Dashboard["id"],
    name: "Research",
    favorite: false,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    widgets: [
      {
        id: "wdg_custom" as Dashboard["widgets"][number]["id"],
        kind: "custom:counter",
        layout: { x: 0, y: 0, w: 6, h: 12 },
      },
    ],
  });
  expect(await screen.findByText("No symbol yet")).toBeInTheDocument();
  // With no chart, the header targets the widget that reads a symbol.
  await user.click(
    await screen.findByRole("button", { name: "Choose a widget symbol" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick AAPL" }));
  expect(await screen.findByText("Showing AAPL")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Symbol AAPL. Change symbol" }),
  ).toBeInTheDocument();
});

test("the header targets the chart until a symbol widget is clicked, and a focused chart cell takes it back", async () => {
  const user = userEvent.setup();
  setup(
    symbolReader,
    {
      id: "dsh_test" as Dashboard["id"],
      name: "Research",
      favorite: false,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
      widgets: [
        {
          id: "wdg_chart" as Dashboard["widgets"][number]["id"],
          kind: "chart",
          layout: { x: 0, y: 0, w: 6, h: 12 },
        },
        {
          id: "wdg_custom" as Dashboard["widgets"][number]["id"],
          kind: "custom:counter",
          layout: { x: 6, y: 0, w: 6, h: 12 },
        },
      ],
    },
    [{ id: "cht_test" }],
  );
  expect(
    await screen.findByRole("button", { name: "Chart cht_test" }),
  ).toBeInTheDocument();
  await user.click(await screen.findByText("No symbol yet"));
  expect(
    await screen.findByRole("button", { name: "Choose a widget symbol" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Focus chart" }));
  expect(
    await screen.findByRole("button", { name: "Chart cht_test" }),
  ).toBeInTheDocument();
});
