// Purpose: Compose Formula code selection and watchlist navigation without creating chart attachments.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext, type PropsWithChildren } from "react";
import { FormulaCodePicker } from "../formula-code-picker";
import { widgetRegistry } from "../widget-registry";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { WidgetContext } from "@openchart/app/lib/widget/widget";
import { WatchlistFormulaPicker } from "@openchart/app/features/watchlist/components/context";
import {
  WorkspaceFileNavigation,
  useWorkspaceFileRequests,
} from "@openchart/app/lib/workspace/workspace";

vi.mock("@openchart/app/app/alerts/chart-alerts", () => ({
  ChartAlertsProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock("@openchart/app/features/chart/components/widget", () => ({
  chartWidget: { kind: "chart" },
}));
vi.mock("@openchart/app/features/chart/components/symbol-picker", () => ({
  SymbolPicker: () => null,
}));
vi.mock("@openchart/app/features/watchlist/components/widget", () => ({
  watchlistWidget: {
    kind: "watchlist",
    Provider: ({ children }: PropsWithChildren) => children,
  },
}));
vi.mock("@openchart/app/features/workspace/components/widget", () => ({
  workspaceWidget: { kind: "workspace" },
}));
vi.mock("../workspace-chart-actions", () => ({
  WorkspaceChartActions: ({ children }: PropsWithChildren) => children,
}));

function setup({
  unavailable = false,
  installFails = false,
  probe = false,
} = {}) {
  const picked = vi.fn();
  const close = vi.fn();
  const install = installFails
    ? vi.fn().mockRejectedValue(new Error("Disk unavailable"))
    : vi.fn().mockResolvedValue({
        workspaceId: "wsp_home",
        path: "indicators/builtin/sma.tea",
      });
  const addIndicator = vi.fn();
  const tree = vi
    .fn()
    .mockImplementation(({ workspaceId }: { workspaceId: string }) =>
      Promise.resolve(
        workspaceId === "wsp_other" && unavailable
          ? { status: "unavailable", entries: [] }
          : {
              status: "ready",
              entries:
                workspaceId === "wsp_home"
                  ? [
                      { path: "signals/momentum.tea" },
                      { path: "notes.md" },
                      { path: "indicators/builtin/sma.tea" },
                    ]
                  : [{ path: "alerts/breakout.tea" }],
            },
      ),
    );
  const transport = {
    url: "formula-test",
    rpc: {
      indicators: {
        list: {
          query: vi.fn().mockResolvedValue([
            {
              id: "sma",
              name: "Moving average",
              description: "Smooth closing prices",
            },
            {
              id: "rsi",
              name: "Relative strength",
              description: "Momentum oscillator",
            },
          ]),
        },
        install: { mutate: install },
      },
      workspace: { listTree: { query: tree } },
      resources: {
        workspace: {
          getDefault: { query: vi.fn().mockResolvedValue("wsp_home") },
          list: {
            query: vi.fn().mockResolvedValue({
              items: [
                { id: "wsp_home", root: "/research" },
                { id: "wsp_other", root: "/strategies" },
              ],
              nextCursor: null,
            }),
          },
        },
        macro: { addIndicator: { mutate: addIndicator } },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const placeBeside = vi.fn().mockReturnValue("wdg_workspace");
  const Provider = widgetRegistry.watchlist!.Provider!;
  const view = render(
    <QueryClientProvider client={client}>
      <WidgetContext.Provider
        value={{
          transport,
          placementId: "wdg_watchlist",
          dashboardId: "dsh_test",
          holdControls: () => () => {},
          placeBeside,
        }}
      >
        {probe ? (
          <Provider>
            <Probe />
          </Provider>
        ) : (
          <FormulaCodePicker onSelect={picked} onClose={close} />
        )}
      </WidgetContext.Provider>
    </QueryClientProvider>,
  );
  return {
    ...view,
    picked,
    close,
    install,
    addIndicator,
    tree,
    client,
    placeBeside,
    user: userEvent.setup(),
  };
}

function Probe() {
  const picker = useContext(WatchlistFormulaPicker);
  const open = useContext(WorkspaceFileNavigation);
  return (
    <>
      <p>
        {picker === FormulaCodePicker
          ? "Formula picker connected"
          : "Missing picker"}
      </p>
      <button
        onClick={() =>
          open?.({ workspaceId: "wsp_home", path: "signals/momentum.tea" })
        }
      >
        Open code
      </button>
    </>
  );
}

afterEach(() => useWorkspaceFileRequests.setState({}, true));

test("built-in selection installs code and returns the source without a chart attachment", async () => {
  const { user, picked, install, addIndicator } = setup();
  await user.click(
    await screen.findByRole("button", { name: /Moving average/ }),
  );
  await waitFor(() =>
    expect(picked).toHaveBeenCalledWith({
      workspaceId: "wsp_home",
      path: "indicators/builtin/sma.tea",
    }),
  );
  expect(install).toHaveBeenCalledWith({ id: "sma" });
  expect(addIndicator).not.toHaveBeenCalled();
});

test("workspace selection filters code files and bundled copies, then returns the chosen source directly", async () => {
  const { user, picked, install, addIndicator } = setup();
  await user.click(screen.getByRole("tab", { name: "Workspace" }));
  const code = await screen.findByRole("button", {
    name: /signals\/momentum.tea/,
  });
  expect(
    screen.queryByRole("button", { name: /notes.md/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /indicators\/builtin/ }),
  ).not.toBeInTheDocument();
  await user.click(code);
  await waitFor(() =>
    expect(picked).toHaveBeenCalledWith({
      workspaceId: "wsp_home",
      path: "signals/momentum.tea",
    }),
  );
  expect(install).not.toHaveBeenCalled();
  expect(addIndicator).not.toHaveBeenCalled();
});

test("an unreadable workspace remains visible as a coverage error beside available files", async () => {
  const { user, tree } = setup({ unavailable: true });
  await user.click(screen.getByRole("tab", { name: "Workspace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Some workspaces couldn’t be read",
  );
  expect(
    screen.getByRole("button", { name: /signals\/momentum.tea/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("No Tea code in your workspaces yet."),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(tree.mock.calls.length).toBeGreaterThan(2));
});

test("search matches catalog descriptions and workspace paths", async () => {
  const { user } = setup();
  await screen.findByRole("button", { name: /Moving average/ });
  await user.type(
    screen.getByRole("textbox", { name: "Search formula code" }),
    "MOMENTUM",
  );
  expect(
    screen.getByRole("button", { name: /Relative strength/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Moving average/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Workspace" }));
  expect(
    await screen.findByRole("button", { name: /signals\/momentum.tea/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /breakout.tea/ }),
  ).not.toBeInTheDocument();
});

test("installation failure retains the picker and does not select a source", async () => {
  const { user, picked, close } = setup({ installFails: true });
  await user.click(
    await screen.findByRole("button", { name: /Moving average/ }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Moving average/ }),
    ).toBeEnabled(),
  );
  expect(
    screen.getByRole("dialog", { name: "Add formula column" }),
  ).toBeInTheDocument();
  expect(picked).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

test("watchlist registry supplies code selection and adjacent Workspace navigation", async () => {
  const { user, placeBeside } = setup({ probe: true });
  expect(screen.getByText("Formula picker connected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open code" }));
  await waitFor(() =>
    expect(placeBeside).toHaveBeenCalledWith({ kind: "workspace" }),
  );
  expect(useWorkspaceFileRequests.getState().wdg_workspace).toEqual({
    workspaceId: "wsp_home",
    path: "signals/momentum.tea",
  });
});
