// Purpose: Verify direct widget actions, local-content widgets, menu dismissal and Dashboard save locking.
import { defineId } from "@openchart/identifier";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WidgetGallery } from "@openchart/app/app/widgets/widget-gallery";
import type { Dashboard } from "@openchart/app/lib/resource/dashboard";

function setup(disabled = false) {
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
  const content = (value: Dashboard) => (
    <QueryClientProvider client={client}>
      <WidgetGallery dashboard={value} disabled={disabled} onAdd={onAdd} />
    </QueryClientProvider>
  );
  const view = render(content(dashboard));
  return {
    dashboard,
    onAdd,
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
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(kind);
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Widgets" })).toHaveFocus();
  },
);

test("offers Chart, Workspace and Watchlist; Alerts live in the sidebar, not on dashboards", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
  ).toEqual(["Chart", "Workspace", "Watchlist"]);
});

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
