// Purpose: Exercise the real workspace adapter, view and host together across multiple placements.
import { useEffect, useState } from "react";
import {
  AuiConfig,
  AuiProvider,
  ModelContextClient,
} from "@assistant-ui/react";
import { defineId } from "@openchart/identifier";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import type { DockviewReadyEvent } from "dockview-react";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { WidgetHost } from "@openchart/app/features/dashboard/components/widget-host";
import { AppHostProvider } from "@openchart/app/lib/host/host";
import { testAppHost } from "@openchart/app/testing/test-utils";
import { useWidget } from "@openchart/app/hooks/use-widget";
import { workspaceWidget } from "@openchart/app/features/workspace/components/widget";
import {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { UnsavedChangesProvider } from "@openchart/app/lib/unsaved-changes/unsaved-changes";

vi.mock("dockview-react", async (original) => ({
  ...(await original<typeof import("dockview-react")>()),
  DockviewReact: ({
    onReady,
  }: {
    onReady: (event: DockviewReadyEvent) => void;
  }) => {
    const { placementId } = useWidget();
    const [api] = useState(() => ({
      panels: [{ params: { dirty: false } }],
      onDidActivePanelChange: () => ({ dispose() {} }),
    }));
    useEffect(
      () => onReady({ api } as unknown as DockviewReadyEvent),
      [onReady, api],
    );
    return (
      <button
        onClick={() => {
          api.panels[0]!.params.dirty = true;
        }}
      >
        Edit {placementId}
      </button>
    );
  },
}));

beforeAll(async () => {
  // Load the real lazy view before timing its widget interaction assertions.
  await import("@openchart/app/features/workspace/components/workspace-view");
});

test("keeps dirty drafts across layout refreshes, checks every widget on navigation, and scopes removal", async () => {
  const dashboard: Dashboard = {
    id: defineId("dsh", "Dashboard.ID").create(),
    name: "Research",
    favorite: false,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    widgets: ["one", "two"].map((name) => ({
      id: defineId("wdg", "WidgetPlacement.ID").make(`wdg_${name}`),
      kind: "workspace",
      layout: { x: 0, y: 0, w: 12, h: 14 },
    })),
  };
  const snapshot = vi
    .fn()
    .mockResolvedValue({ status: "ready", entries: [], directories: [] });
  const transport = {
    url: "test",
    rpc: {
      resources: {
        workspace: {
          getDefault: { query: async () => "wsp_default" },
          list: {
            query: async () => ({
              items: ["one", "two"].map((name) => ({
                id: `wsp_${name}`,
                root: `/workspaces/${name}`,
              })),
            }),
          },
        },
      },
      workspace: { listDirectory: { query: snapshot } },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const key = dashboardQueryOptions(transport, dashboard.id).queryKey;
  client.setQueryData(key, dashboard);
  const removed = vi.fn();
  function DashboardFixture() {
    const [widgets, setWidgets] = useState(dashboard.widgets);
    return (
      <>
        <Link to="/next">Leave dashboard</Link>
        <button
          onClick={() =>
            client.setQueryData(key, () => ({
              ...dashboard,
              revision: 2,
              widgets: dashboard.widgets.map((widget) => ({
                ...widget,
                layout: { ...widget.layout, w: 4 },
              })),
            }))
          }
        >
          Refresh layout
        </button>
        {widgets.map((placement) => (
          <section key={placement.id} aria-label={placement.id}>
            <WidgetHost
              placement={placement}
              dashboardId={dashboard.id}
              transport={transport}
              definition={workspaceWidget}
              disabled={false}
              onPlaceBeside={vi.fn()}
              onRemove={() => {
                removed(placement.id);
                setWidgets((current) =>
                  current.filter((item) => item.id !== placement.id),
                );
              }}
            />
          </section>
        ))}
      </>
    );
  }
  const router = createMemoryRouter([
    {
      element: (
        <UnsavedChangesProvider>
          <Outlet />
        </UnsavedChangesProvider>
      ),
      children: [
        { path: "/", element: <DashboardFixture /> },
        { path: "/next", element: <p>Next page</p> },
      ],
    },
  ]);
  const context = AuiConfig({ modelContext: ModelContextClient() });
  const view = render(
    <QueryClientProvider client={client}>
      <AuiProvider config={context}>
        <TooltipProvider>
          <AppHostProvider value={testAppHost()}>
            <RouterProvider router={router} />
          </AppHostProvider>
        </TooltipProvider>
      </AuiProvider>
    </QueryClientProvider>,
  );
  try {
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Edit wdg_two" });
    for (const id of ["wdg_one", "wdg_two"]) {
      const widget = within(screen.getByRole("region", { name: id }));
      expect(await widget.findByRole("button", { name: "one" })).toBeVisible();
      expect(widget.getByRole("button", { name: "two" })).toBeVisible();
      expect(
        widget.getByRole("button", { name: "Create workspace" }),
      ).toBeVisible();
      if (id === "wdg_one") {
        expect(snapshot).not.toHaveBeenCalled();
        await user.click(widget.getByRole("button", { name: "one" }));
        await user.click(widget.getByRole("button", { name: "two" }));
      }
    }
    await user.click(screen.getByRole("button", { name: "Edit wdg_one" }));
    await user.click(screen.getByRole("button", { name: "Refresh layout" }));
    await user.click(screen.getByRole("link", { name: "Leave dashboard" }));
    await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    expect(router.state.location.pathname).toBe("/");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    // A clean sibling can close immediately even while the first widget is dirty.
    await user.click(
      within(screen.getByRole("region", { name: "wdg_two" })).getByRole(
        "button",
        { name: "Remove from dashboard" },
      ),
    );
    expect(removed).toHaveBeenCalledExactlyOnceWith(dashboard.widgets[1]!.id);
    const removeDirty = () =>
      fireEvent.click(
        within(screen.getByRole("region", { name: "wdg_one" })).getByRole(
          "button",
          { name: "Remove from dashboard" },
        ),
      );
    removeDirty();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(removed).toHaveBeenCalledTimes(1);
    removeDirty();
    await user.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    expect(removed).toHaveBeenCalledTimes(2);
    expect(removed).toHaveBeenLastCalledWith(dashboard.widgets[0]!.id);
    expect(
      screen.queryByRole("button", { name: "Edit wdg_one" }),
    ).not.toBeInTheDocument();
    const afterUnmount = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
    await user.click(screen.getByRole("link", { name: "Leave dashboard" }));
    expect(await screen.findByText("Next page")).toBeVisible();
    expect(snapshot).toHaveBeenCalledWith(
      { workspaceId: "wsp_one", path: "" },
      expect.anything(),
    );
    expect(snapshot).toHaveBeenCalledWith(
      { workspaceId: "wsp_two", path: "" },
      expect.anything(),
    );
  } finally {
    view.unmount();
    router.dispose();
    client.clear();
    vi.unstubAllGlobals();
  }
});
