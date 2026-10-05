// Purpose: Dashboard Workspace tabs add their file to, or reload it on, the chart the Dashboard header targets.
import { defineId } from "@openchart/identifier";
import { Field, Float64, Schema } from "apache-arrow";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext, useRef } from "react";
import type { GridLayoutProps } from "react-grid-layout";

import { widgetRegistry } from "@openchart/app/app/widgets/widget-registry";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import {
  chartDetail,
  createCell,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { ChartSelectionProvider } from "@openchart/app/features/chart/components/selection-provider";
import { DashboardView } from "@openchart/app/features/dashboard/components/dashboard-view";
import { useChartSelection } from "@openchart/app/hooks/use-chart-selection";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/lib/resource/dashboard";
import { TeaClientContext } from "@openchart/app/lib/tea/context";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";
import { WorkspaceFileActions } from "@openchart/app/lib/workspace/workspace";
import {
  findErrorToast,
  renderWithToaster as render,
} from "@openchart/app/testing/test-utils";

vi.mock("react-grid-layout", async (original) => ({
  ...(await original<typeof import("react-grid-layout")>()),
  default: (props: GridLayoutProps) => <div>{props.children}</div>,
  useContainerWidth: () => ({
    width: 1200,
    mounted: true,
    containerRef: useRef<HTMLDivElement>(null),
  }),
}));

const file = { workspaceId: "wsp_research", path: "indicators/rsi.tea" };
const events: string[] = [];
// The Workspace's save of a dirty tab; its own tests cover the real editor.
const prepare = vi.fn(async (): Promise<void> => void events.push("save"));
// Stands in for a `.tea` tab's header: it renders what the app contributes.
function TeaTab() {
  const actions = useContext(WorkspaceFileActions);
  return <div>{actions?.(file, prepare)}</div>;
}
const cell = () =>
  createCell(
    {
      provider: "test",
      listing: { symbol: "AAA", currency: "USD" },
    } as Parameters<typeof createCell>[0],
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );
const charts = ["cht_one", "cht_two"].map(
  (id) =>
    ({
      id,
      revision: 3,
      cells: [cell(), cell()],
      links: [],
      preset: "1x2",
    }) as unknown as ChartResource,
);
// Stands in for a chart cell gaining focus.
function FocusSecondCell() {
  const { focus } = useChartSelection();
  return (
    <button onClick={() => focus("cht_two", charts[1]!.cells[1]!.id)}>
      Focus
    </button>
  );
}
const registry: Record<string, WidgetDefinition> = {
  chart: {
    kind: "chart",
    title: "Chart",
    Icon: () => null,
    defaultSize: { w: 12, h: 12 },
    minSize: { w: 4, h: 6 },
    Content: () => null,
  },
  workspace: {
    kind: "workspace",
    title: "Workspace",
    Icon: () => null,
    defaultSize: { w: 12, h: 14 },
    minSize: { w: 3, h: 6 },
    Provider: widgetRegistry.workspace!.Provider,
    Content: TeaTab,
  },
};
const placementId = defineId("wdg", "WidgetPlacement.ID");
const placement = (kind: string, resourceId: string, y: number) => ({
  id: placementId.make(`wdg_${resourceId}`),
  kind,
  resourceId,
  layout: { x: 0, y, w: 12, h: 12 },
});

beforeEach(() => {
  events.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 1200, height: 760 } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

function setup(
  widgets: Dashboard["widgets"],
  running: Record<string, unknown[]> = {},
) {
  vi.clearAllMocks();
  const dashboard: Dashboard = {
    id: defineId("dsh", "Dashboard.ID").make("dsh_test"),
    name: "Research",
    favorite: false,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    widgets,
  };
  const addIndicator = vi.fn(async ({ chartId }: { chartId: string }) => {
    events.push("add");
    return { chart: charts.find((chart) => chart.id === chartId)! };
  });
  const reload = vi.fn(async ({ id }: { id: string }) => ({
    id,
    revision: 8,
  }));
  const list = vi.fn(async ({ filter }: { filter: { chartId: string } }) => ({
    items: running[filter.chartId] ?? [],
    nextCursor: null,
  }));
  const transport = {
    url: "http://chart-actions.test",
    rpc: {
      resources: {
        macro: { addIndicator: { mutate: addIndicator } },
        dashboard: { get: { query: vi.fn().mockResolvedValue(dashboard) } },
        indicator: {
          list: { query: list },
          reload: { mutate: reload },
        },
      },
    },
  } as unknown as AppTransport;
  const tea = {
    url: transport.url,
    snapshot: vi.fn(async () => ({
      entry: file.path,
      sources: { [file.path]: "rsi" },
    })),
    compile: vi.fn(async () => ({
      id: "node",
      declaration: {
        kind: "indicator",
        title: "RSI",
        overlay: false,
        timeframe: "",
      },
      definition: {
        parameters: [],
        inputs: new Schema([]),
        outputs: new Schema([
          new Field(
            "value",
            new Float64(),
            true,
            new Map([["tea:write", "set"]]),
          ),
        ]),
        requests: {},
      },
    })),
    dispose: vi.fn(async () => {}),
  } as unknown as NonNullable<
    Parameters<typeof TeaClientContext.Provider>[0]["value"]
  >;
  const client = createQueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(
    dashboardQueryOptions(transport, dashboard.id).queryKey,
    dashboard,
  );
  for (const chart of charts)
    client.setQueryData(chartDetail(transport, chart.id).queryKey, chart);
  const view = render(
    <QueryClientProvider client={client}>
      <TeaClientContext.Provider value={tea}>
        <TooltipProvider>
          <ChartSelectionProvider>
            <FocusSecondCell />
            <DashboardView
              id={dashboard.id}
              transport={transport}
              registry={registry}
              renderHeader={() => null}
            />
          </ChartSelectionProvider>
        </TooltipProvider>
      </TeaClientContext.Provider>
    </QueryClientProvider>,
  );
  return {
    addIndicator,
    reload,
    list,
    client,
    user: userEvent.setup(),
    cleanup: () => {
      view.unmount();
      client.clear();
    },
  };
}

test("Add to chart saves the tab, then adds the file to the active chart's focused cell", async () => {
  const { addIndicator, user, cleanup } = setup([
    placement("chart", "cht_one", 0),
    placement("chart", "cht_two", 12),
    placement("workspace", "wsp_research", 24),
  ]);
  try {
    await user.click(screen.getByRole("button", { name: "Focus" }));
    const add = await screen.findByRole("button", { name: "Add to chart" });
    await waitFor(() => expect(add).toBeEnabled());
    // One size with the tab bar's 32px controls.
    expect(add).toHaveClass("size-8");
    await user.click(add);
    await waitFor(() =>
      expect(addIndicator).toHaveBeenCalledExactlyOnceWith({
        chartId: "cht_two",
        expectedRevision: 3,
        cellId: charts[1]!.cells[1]!.id,
        source: file,
        parameterOverrides: {},
      }),
    );
    expect(events).toEqual(["save", "add"]);
  } finally {
    cleanup();
  }
});

test("a file the target chart already runs offers Reload on chart instead of another copy", async () => {
  const { addIndicator, reload, user, cleanup } = setup(
    [
      placement("chart", "cht_one", 0),
      placement("workspace", "wsp_research", 12),
    ],
    { cht_one: [{ id: "ind_rsi", revision: 7, source: file }] },
  );
  try {
    await user.click(
      await screen.findByRole("button", { name: "Reload on chart" }),
    );
    await waitFor(() =>
      expect(reload).toHaveBeenCalledExactlyOnceWith({
        id: "ind_rsi",
        expectedRevision: 7,
      }),
    );
    expect(prepare).toHaveBeenCalledOnce();
    expect(await screen.findByText("Reloaded on chart")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add to chart" }),
    ).not.toBeInTheDocument();
    expect(addIndicator).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test("Reload on chart waits for the save, stops when it fails and says when nothing changed", async () => {
  const { addIndicator, reload, user, cleanup } = setup(
    [
      placement("chart", "cht_one", 0),
      placement("workspace", "wsp_research", 12),
    ],
    { cht_one: [{ id: "ind_rsi", revision: 7, source: file }] },
  );
  const button = () => screen.getByRole("button", { name: "Reload on chart" });
  try {
    await screen.findByRole("button", { name: "Reload on chart" });
    // A failed save stops the reload, so the chart never snapshots the stale disk file.
    prepare.mockRejectedValueOnce(new Error("conflict"));
    await user.click(button());
    await findErrorToast("conflict");
    expect(reload).not.toHaveBeenCalled();
    // The reload starts only once the save has finished.
    let saved!: () => void;
    prepare.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          saved = () => {
            events.push("save");
            resolve();
          };
        }),
    );
    reload.mockImplementationOnce(async ({ id }) => {
      events.push("reload");
      // An unchanged file keeps the Indicator's revision.
      return { id, revision: 7 };
    });
    await waitFor(() => expect(button()).toBeEnabled());
    await user.click(button());
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    expect(reload).not.toHaveBeenCalled();
    saved();
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(events).toEqual(["save", "reload"]);
    expect(
      await screen.findByText("The chart already runs this file"),
    ).toBeVisible();
    expect(addIndicator).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test("after an add the button waits for the chart's Indicators, then offers Reload instead of a second copy", async () => {
  const running: Record<string, unknown[]> = {};
  const { addIndicator, reload, list, client, user, cleanup } = setup(
    [
      placement("chart", "cht_one", 0),
      placement("workspace", "wsp_research", 12),
    ],
    running,
  );
  try {
    const add = await screen.findByRole("button", { name: "Add to chart" });
    await waitFor(() => expect(add).toBeEnabled());
    // The refetch after the add is held until `listed()`.
    let listed!: () => void;
    list.mockImplementationOnce(async ({ filter }) => {
      await new Promise<void>((resolve) => (listed = resolve));
      return { items: running[filter.chartId] ?? [], nextCursor: null };
    });
    await user.click(add);
    await waitFor(() => expect(addIndicator).toHaveBeenCalledOnce());
    running.cht_one = [{ id: "ind_rsi", revision: 1, source: file }];
    await waitFor(() => expect(client.isMutating()).toBe(0));
    // Let React render the settled add before checking the button.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(add).toBeDisabled();
    listed();
    await user.click(
      await screen.findByRole("button", { name: "Reload on chart" }),
    );
    await waitFor(() =>
      expect(reload).toHaveBeenCalledExactlyOnceWith({
        id: "ind_rsi",
        expectedRevision: 1,
      }),
    );
    expect(addIndicator).toHaveBeenCalledOnce();
  } finally {
    cleanup();
  }
});

test("a Dashboard without a chart contributes no chart action", async () => {
  const { cleanup } = setup([placement("workspace", "wsp_research", 0)]);
  try {
    expect(
      await screen.findByRole("region", { name: "Workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /chart/ }),
    ).not.toBeInTheDocument();
  } finally {
    cleanup();
  }
});
