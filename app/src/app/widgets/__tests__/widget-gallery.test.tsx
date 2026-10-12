// Purpose: Verify direct widget actions, local-content widgets, custom widget sources and load retry, menu dismissal and Dashboard save locking.
import { defineId } from "@openchart/identifier";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customWidgetDefinition } from "@openchart/app/app/widgets/custom/custom-widget";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { WorkspaceFileNavigation } from "@openchart/app/lib/workspace/workspace";
import { WidgetGallery } from "@openchart/app/app/widgets/widget-gallery";
import { widgetCatalog } from "@openchart/app/app/widgets/widget-registry";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

type Saved = {
  kind: string;
  title: string;
  source: { workspaceId: string; path: string };
};

function setup(disabled = false, custom: Saved[] = [], failFirstList = false) {
  const dashboard: Dashboard = {
    id: defineId("dsh", "Dashboard.ID").create(),
    name: "Research",
    favorite: false,
    revision: 3,
    createdAt: 1,
    updatedAt: 1,
    widgets: [],
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onAdd = vi.fn();
  const openFile = vi.fn();
  const transport = {
    url: "test",
    rpc: {
      resources: {
        custom_widget: {
          list: {
            query: failFirstList
              ? vi
                  .fn()
                  .mockRejectedValueOnce(new Error("Backend unavailable"))
                  .mockResolvedValue({ items: custom, cursor: null })
              : vi.fn(async () => ({ items: custom, cursor: null })),
          },
        },
      },
    },
  } as unknown as AppTransport;
  const content = (value: Dashboard) => (
    <QueryClientProvider client={client}>
      <WorkspaceFileNavigation.Provider value={openFile}>
        <TooltipProvider>
          <WidgetGallery
            dashboard={value}
            transport={transport}
            disabled={disabled}
            onAdd={onAdd}
          />
        </TooltipProvider>
      </WorkspaceFileNavigation.Provider>
    </QueryClientProvider>
  );
  const view = render(content(dashboard));
  return {
    dashboard,
    onAdd,
    openFile,
    user: userEvent.setup(),
    refresh: (value: Dashboard) => view.rerender(content(value)),
  };
}

test.each([
  ["Chart", "chart"],
  ["Workspace", "workspace"],
  ["Watchlist", "watchlist"],
] as const)(
  "adds %s with one selection and returns focus to the trigger",
  async (name, kind) => {
    const { onAdd, user } = setup();
    await user.click(screen.getByRole("button", { name: "Widgets" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(
      widgetCatalog[kind].definition,
    );
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Widgets" })).toHaveFocus();
  },
);

test("honors Dashboard's shared pending state", async () => {
  const { user, onAdd } = setup(true);
  expect(screen.getByRole("button", { name: "Widgets" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(onAdd).not.toHaveBeenCalled();
});

test.each([
  ["chart", "Chart"],
  ["workspace", "Workspace"],
  ["watchlist", "Watchlist"],
])("disables %s when the dashboard already has one", async (kind, title) => {
  const { user, dashboard, refresh } = setup();
  refresh({
    ...dashboard,
    widgets: [
      {
        id: defineId("wdg", "WidgetPlacement.ID").create(),
        kind,
        layout: { x: 0, y: 0, w: 12, h: 24 },
      },
    ],
  });
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  expect(screen.getByRole("menuitem", { name: title })).toHaveAttribute(
    "data-disabled",
  );
  expect(
    screen.getByRole("menuitem", {
      name: kind === "chart" ? "Workspace" : "Chart",
    }),
  ).not.toHaveAttribute("data-disabled");
});

const rates: Saved = {
  kind: "rates",
  title: "Rates heatmap",
  source: { workspaceId: "wsp_test", path: "widgets/rates.widget.tsx" },
};

test("lists built-ins (Alerts stay in the sidebar), then saved custom widgets, and adds them as custom kinds", async () => {
  const { user, onAdd } = setup(false, [rates]);
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  expect(
    (await screen.findAllByRole("menuitem")).map(
      (item) => item.getAttribute("aria-label") ?? item.textContent,
    ),
  ).toEqual([
    "Chart",
    "Workspace",
    "Watchlist",
    "Rates heatmapCustom",
    "Open widgets/rates.widget.tsx in Workspace",
  ]);
  await user.click(
    screen.getByRole("menuitem", { name: "Rates heatmap Custom" }),
  );
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(
    customWidgetDefinition("rates"),
  );
});

test("opens a custom widget's source in Workspace, even while it is placed", async () => {
  const { user, onAdd, openFile, dashboard, refresh } = setup(false, [rates]);
  refresh({
    ...dashboard,
    widgets: [
      {
        id: defineId("wdg", "WidgetPlacement.ID").create(),
        kind: "custom:rates",
        layout: { x: 0, y: 0, w: 12, h: 24 },
      },
    ],
  });
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  expect(
    await screen.findByRole("menuitem", { name: "Rates heatmap Custom" }),
  ).toHaveAttribute("data-disabled");
  await user.click(
    screen.getByRole("menuitem", {
      name: "Open widgets/rates.widget.tsx in Workspace",
    }),
  );
  expect(openFile).toHaveBeenCalledExactlyOnceWith(rates.source);
  expect(onAdd).not.toHaveBeenCalled();
});

test("offers a retry when saved widgets fail to load, keeping the menu open", async () => {
  const { user } = setup(false, [rates], true);
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  await user.click(
    await screen.findByRole("menuitem", {
      name: "Retry loading saved widgets",
    }),
  );
  expect(
    await screen.findByRole("menuitem", { name: "Rates heatmap Custom" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "Retry loading saved widgets" }),
  ).not.toBeInTheDocument();
});
