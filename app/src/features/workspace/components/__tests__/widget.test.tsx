// Purpose: A Workspace placement opens and reveals files requested for it, including before it mounts and repeats of the same file, but never again on remount.
import { useEffect, useState } from "react";
import {
  AuiConfig,
  AuiProvider,
  ModelContextClient,
} from "@assistant-ui/react";
import { defineId } from "@openchart/identifier";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { DockviewReadyEvent } from "dockview-react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { workspaceWidget } from "@openchart/app/features/workspace/components/widget";
import { AppHostProvider } from "@openchart/app/lib/host/host";
import { testAppHost } from "@openchart/app/testing/test-utils";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { UnsavedChangesProvider } from "@openchart/app/lib/unsaved-changes/unsaved-changes";
import { WidgetContext } from "@openchart/app/lib/widget/widget";
import {
  requestWorkspaceFile,
  useWorkspaceFileRequests,
} from "@openchart/app/lib/workspace/workspace";

const dock = vi.hoisted(() => ({
  panels: new Map<
    string,
    { params: unknown; api: { setActive: () => void } }
  >(),
  addPanel: vi.fn(),
  setActive: vi.fn(),
  ready: vi.fn(),
}));
vi.mock("dockview-react", async (original) => ({
  ...(await original<typeof import("dockview-react")>()),
  DockviewReact: ({
    onReady,
  }: {
    onReady: (event: DockviewReadyEvent) => void;
  }) => {
    const [api] = useState(() => ({
      get panels() {
        return [...dock.panels.values()];
      },
      getPanel: (id: string) => dock.panels.get(id),
      addPanel: (panel: { id: string; params: unknown }) => {
        dock.addPanel(panel);
        dock.panels.set(panel.id, {
          params: panel.params,
          api: { setActive: dock.setActive },
        });
      },
      onDidActivePanelChange: () => ({ dispose() {} }),
    }));
    useEffect(() => {
      dock.ready();
      onReady({ api } as unknown as DockviewReadyEvent);
    }, [onReady, api]);
    return null;
  },
}));

test("opens requested files in its own placement once, including before mount and repeated requests", async () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const placementId = defineId("wdg", "WidgetPlacement.ID").create();
  const dashboardId = defineId("dsh", "Dashboard.ID").create();
  const transport = {
    url: "test",
    rpc: {
      resources: {
        workspace: {
          list: {
            query: async () => ({
              items: [{ id: "wsp_test", root: "/workspaces/test" }],
            }),
          },
          getDefault: { query: async () => "wsp_test" },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const file = { workspaceId: "wsp_test", path: "indicators/rsi.tea" };
  // The Dashboard saves a new placement before its widget mounts.
  requestWorkspaceFile(placementId, file);
  const Content = workspaceWidget.Content;
  const route = () =>
    createMemoryRouter([
      {
        path: "/",
        element: (
          <UnsavedChangesProvider>
            <WidgetContext.Provider
              value={{
                placementId,
                dashboardId,
                transport,
                holdControls: () => () => {},
                placeBeside: vi.fn(),
              }}
            >
              <Content />
            </WidgetContext.Provider>
          </UnsavedChangesProvider>
        ),
      },
    ]);
  const mount = (router: ReturnType<typeof route>) =>
    render(
      <QueryClientProvider client={client}>
        <AppHostProvider value={testAppHost()}>
          <AuiProvider
            config={AuiConfig({ modelContext: ModelContextClient() })}
          >
            <RouterProvider router={router} />
          </AuiProvider>
        </AppHostProvider>
      </QueryClientProvider>,
    );
  let router = route();
  let view = mount(router);
  try {
    await waitFor(() =>
      expect(dock.addPanel).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: "wsp_test/indicators/rsi.tea",
          params: file,
        }),
      ),
    );
    // Another placement's request never reaches this widget.
    act(() => requestWorkspaceFile("wdg_other", { ...file, path: "a.tea" }));
    expect(dock.addPanel).toHaveBeenCalledTimes(1);
    expect(dock.setActive).not.toHaveBeenCalled();
    // An opened request is spent and the widget is brought into view.
    expect(useWorkspaceFileRequests.getState()[placementId]).toBeUndefined();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    // After the user switches tabs, asking for the same file activates it again.
    act(() => requestWorkspaceFile(placementId, file));
    expect(dock.setActive).toHaveBeenCalledTimes(1);
    expect(dock.addPanel).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    // After the user closes the tab, a remount (route change, Discard) never reopens it.
    dock.panels.clear();
    view.unmount();
    router.dispose();
    router = route();
    const readied = dock.ready.mock.calls.length;
    view = mount(router);
    await waitFor(() =>
      expect(dock.ready.mock.calls.length).toBeGreaterThan(readied),
    );
    expect(dock.addPanel).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  } finally {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    view.unmount();
    router.dispose();
    client.clear();
  }
});
