// Purpose: Verify direct widget actions, menu dismissal and Dashboard save locking.
import { defineId } from "@openchart/identifier";
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
  const actions = { Chart: vi.fn(), Workspace: vi.fn() };
  const content = (value: Dashboard) => (
    <WidgetGallery
      dashboard={value}
      disabled={disabled}
      onAddWorkspace={actions.Workspace}
      onAddChart={actions.Chart}
    />
  );
  const view = render(content(dashboard));
  return {
    dashboard,
    actions,
    user: userEvent.setup(),
    refresh: (value: Dashboard) => view.rerender(content(value)),
  };
}

test.each(["Chart", "Workspace"] as const)(
  "adds %s with one selection and returns focus to the trigger",
  async (kind) => {
    const { actions, user } = setup();
    await user.click(screen.getByRole("button", { name: "Widgets" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: kind }));
    expect(actions[kind]).toHaveBeenCalledExactlyOnceWith();
    for (const [name, action] of Object.entries(actions)) {
      if (name !== kind) expect(action).not.toHaveBeenCalled();
    }
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Widgets" })).toHaveFocus();
  },
);

test("offers Chart and Workspace; Alerts live in the sidebar, not on dashboards", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
  ).toEqual(["Chart", "Workspace"]);
});

test("honors Dashboard's shared pending state", async () => {
  const { user, actions } = setup(true);
  expect(screen.getByRole("button", { name: "Widgets" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  for (const action of Object.values(actions))
    expect(action).not.toHaveBeenCalled();
});

test("disables Workspace when the dashboard already has one", async () => {
  const { user, dashboard, refresh } = setup();
  refresh({
    ...dashboard,
    widgets: [
      {
        id: defineId("wdg", "WidgetPlacement.ID").create(),
        kind: "workspace",
        layout: { x: 0, y: 0, w: 12, h: 24 },
      },
    ],
  });
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  expect(screen.getByRole("menuitem", { name: "Workspace" })).toHaveAttribute(
    "data-disabled",
  );
  expect(screen.getByRole("menuitem", { name: "Chart" })).not.toHaveAttribute(
    "data-disabled",
  );
});
