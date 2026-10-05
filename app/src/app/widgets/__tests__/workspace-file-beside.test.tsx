// Purpose: Opening code from a chart docks its Workspace widget on the chart's right and opens the file there.
import { defineId } from "@openchart/identifier";
import { QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext, useRef, type PropsWithChildren } from "react";
import type { GridLayoutProps } from "react-grid-layout";

import { widgetRegistry } from "@openchart/app/app/widgets/widget-registry";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { DashboardView } from "@openchart/app/features/dashboard/components/dashboard-view";
import { useWidget } from "@openchart/app/hooks/use-widget";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import type { WidgetDefinition } from "@openchart/app/lib/widget/widget";
import {
  useWorkspaceFileRequests,
  WorkspaceFileNavigation,
} from "@openchart/app/lib/workspace/workspace";
import {
  findErrorToast,
  renderWithToaster as render,
} from "@openchart/app/testing/test-utils";

// Only the registry's Open code wiring is under test; alert drawing has its own tests.
vi.mock("@openchart/app/app/alerts/chart-alerts", () => ({
  ChartAlertsProvider: ({ children }: PropsWithChildren) => children,
}));
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
// Stands in for the Indicator legend: it only calls the navigation it is given.
function OpenCode() {
  const openFile = useContext(WorkspaceFileNavigation);
  return <button onClick={() => openFile?.(file)}>Open code</button>;
}
function RequestedFile() {
  const { placementId } = useWidget();
  const request = useWorkspaceFileRequests((requests) => requests[placementId]);
  return <p>{request ? `Requested ${request.path}` : "No request"}</p>;
}
const registry: Record<string, WidgetDefinition> = {
  chart: {
    kind: "chart",
    title: "Chart",
    Icon: () => null,
    defaultSize: { w: 12, h: 12 },
    minSize: { w: 4, h: 6 },
    Provider: widgetRegistry.chart!.Provider,
    Content: OpenCode,
  },
  workspace: {
    kind: "workspace",
    title: "Workspace",
    Icon: () => null,
    defaultSize: { w: 12, h: 14 },
    minSize: { w: 3, h: 6 },
    Content: RequestedFile,
  },
};
const placementId = defineId("wdg", "WidgetPlacement.ID");
const chart = {
  id: placementId.make("wdg_chart"),
  kind: "chart",
  resourceId: "cht_1",
  layout: { x: 0, y: 0, w: 12, h: 24 },
};

beforeEach(() => {
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
});
afterEach(() => {
  useWorkspaceFileRequests.setState({}, true);
  vi.unstubAllGlobals();
});

function setup(widgets: Dashboard["widgets"]) {
  const dashboard: Dashboard = {
    id: defineId("dsh", "Dashboard.ID").make("dsh_test"),
    name: "Research",
    favorite: false,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    widgets,
  };
  const get = vi.fn().mockResolvedValue(dashboard);
  const patch = vi.fn();
  const transport = {
    url: "http://beside.test",
    rpc: {
      resources: {
        dashboard: { get: { query: get }, patch: { mutate: patch } },
      },
    },
  } as unknown as AppTransport;
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
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <DashboardView
          id={dashboard.id}
          transport={transport}
          registry={registry}
          renderHeader={() => null}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return {
    dashboard,
    client,
    get,
    patch,
    user: userEvent.setup(),
    cleanup: () => {
      view.unmount();
      client.clear();
    },
  };
}

function saveAs(dashboard: Dashboard, get: ReturnType<typeof vi.fn>) {
  return async ({
    operations,
  }: {
    operations: [{ value: Dashboard["widgets"] }];
  }) => {
    const saved = { ...dashboard, revision: 2, widgets: operations[0].value };
    get.mockResolvedValue(saved);
    return saved;
  };
}

test("a full-width chart shrinks to half and the Workspace docks on its right with the file open", async () => {
  const { dashboard, get, patch, user, cleanup } = setup([chart]);
  try {
    patch.mockImplementation(saveAs(dashboard, get));
    await user.click(screen.getByRole("button", { name: "Open code" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const { expectedRevision, operations } = patch.mock.calls[0]![0];
    expect(expectedRevision).toBe(1);
    const [resized, workspace] = operations[0].value as Dashboard["widgets"];
    expect(resized).toEqual({ ...chart, layout: { x: 0, y: 0, w: 6, h: 24 } });
    // The Workspace shows every registered folder, so it references no Resource.
    expect(workspace).toEqual({
      id: expect.stringMatching(/^wdg_/),
      kind: "workspace",
      layout: { x: 6, y: 0, w: 6, h: 24 },
    });
    const card = await screen.findByRole("region", { name: "Workspace" });
    expect(
      await within(card).findByText("Requested indicators/rsi.tea"),
    ).toBeInTheDocument();
    expect(useWorkspaceFileRequests.getState()).toEqual({
      [workspace!.id]: file,
    });
  } finally {
    cleanup();
  }
});

test("the Dashboard's Workspace widget receives the file without saving", async () => {
  const existing = {
    id: placementId.make("wdg_workspace"),
    kind: "workspace",
    layout: { x: 6, y: 0, w: 6, h: 24 },
  };
  const { patch, user, cleanup } = setup([
    { ...chart, layout: { x: 0, y: 0, w: 6, h: 24 } },
    existing,
  ]);
  try {
    await user.click(screen.getByRole("button", { name: "Open code" }));
    expect(
      await screen.findByText("Requested indicators/rsi.tea"),
    ).toBeInTheDocument();
    expect(useWorkspaceFileRequests.getState()).toEqual({
      wdg_workspace: file,
    });
    expect(patch).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test("a file from another workspace opens in the Dashboard's one Workspace widget", async () => {
  const workspace = {
    id: placementId.make("wdg_other"),
    kind: "workspace",
    layout: { x: 0, y: 12, w: 12, h: 12 },
  };
  const { patch, user, cleanup } = setup([
    { ...chart, layout: { x: 0, y: 0, w: 12, h: 12 } },
    workspace,
  ]);
  try {
    await user.click(screen.getByRole("button", { name: "Open code" }));
    await waitFor(() =>
      expect(useWorkspaceFileRequests.getState()).toEqual({ wdg_other: file }),
    );
    // A Dashboard holds at most one Workspace widget, so nothing is added.
    expect(patch).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test("clicking again while the dock saves opens the same Workspace without an error", async () => {
  const { dashboard, get, patch, user, cleanup } = setup([chart]);
  try {
    let release = () => {};
    patch.mockImplementation(
      (input) =>
        new Promise((resolve) => {
          release = () => resolve(saveAs(dashboard, get)(input));
        }),
    );
    const open = screen.getByRole("button", { name: "Open code" });
    await user.dblClick(open);
    expect(await screen.findByText("Saving dashboard…")).toBeInTheDocument();
    release();
    expect(
      await screen.findByText("Requested indicators/rsi.tea"),
    ).toBeInTheDocument();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  } finally {
    cleanup();
  }
});

test("after a failed dock, the Dashboard's Retry docks the Workspace with the file open", async () => {
  const { dashboard, get, patch, user, cleanup } = setup([chart]);
  try {
    patch
      .mockRejectedValueOnce(new Error("Save unavailable"))
      .mockImplementation(saveAs(dashboard, get));
    await user.click(screen.getByRole("button", { name: "Open code" }));
    // The Dashboard reports its own save failure once; opening the file didn't fail.
    await findErrorToast("Save unavailable");
    expect(
      within(
        screen.getByRole("region", { name: /Notifications/ }),
      ).getAllByRole("listitem"),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    const card = await screen.findByRole("region", { name: "Workspace" });
    expect(
      await within(card).findByText("Requested indicators/rsi.tea"),
    ).toBeInTheDocument();
    expect(patch).toHaveBeenCalledTimes(2);
  } finally {
    cleanup();
  }
});
