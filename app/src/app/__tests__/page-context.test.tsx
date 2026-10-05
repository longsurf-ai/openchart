// Purpose: Verify routed page context follows the page and selected Dashboard.
import {
  AuiConfig,
  AuiProvider,
  ModelContextClient,
  type AssistantClient,
} from "@assistant-ui/react";
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";

import { CopilotControlsProvider } from "@openchart/app/app/agent/copilot-controls";
import { DashboardPage } from "@openchart/app/app/dashboard/dashboard-page";
import { SchedulePage } from "@openchart/app/app/schedule/schedule-page";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

vi.mock("@openchart/app/features/schedule/components/schedule-view", () => ({
  ScheduleView: () => <p>Schedule</p>,
}));
vi.mock("@openchart/app/app/schedule/schedule-prompt-editor", () => ({
  SchedulePromptEditor: () => null,
}));
vi.mock("@openchart/app/features/dashboard/components/dashboard-view", () => ({
  DashboardView: () => <p>Dashboard</p>,
}));
vi.mock("@openchart/app/app/dashboard/dashboard-header", () => ({
  DashboardHeader: () => null,
}));
vi.mock("@openchart/app/app/widgets/widget-registry", () => ({
  widgetCatalog: {
    workspace: { definition: {} },
    chart: { definition: {} },
    alerts: { definition: {} },
  },
  widgetRegistry: {},
}));

test("page context follows Schedule, Dashboard ID changes, and route exit", async () => {
  const assistant = createRef<AssistantClient>();
  const context = AuiConfig({ modelContext: ModelContextClient() });
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ transport: {} as AppTransport }} />,
        children: [
          { path: "/schedule", element: <SchedulePage /> },
          { path: "/dashboards/:dashboardId", element: <DashboardPage /> },
          { path: "/other", element: <p>Other</p> },
        ],
      },
    ],
    { initialEntries: ["/schedule"] },
  );
  const view = render(
    <AuiProvider config={context} ref={assistant}>
      <CopilotControlsProvider value={null}>
        <RouterProvider router={router} />
      </CopilotControlsProvider>
    </AuiProvider>,
  );
  const readContext = () =>
    assistant.current!.modelContext.getModelContext().system;

  expect(readContext()).toBe("user is in schedule page");
  await act(() => router.navigate("/dashboards/dsh_first"));
  expect(readContext()).toBe("user is viewing dashboard with id dsh_first");
  await act(() => router.navigate("/dashboards/dsh_second"));
  expect(readContext()).toBe("user is viewing dashboard with id dsh_second");
  await act(() => router.navigate("/other"));
  expect(readContext()).toBeUndefined();

  view.unmount();
  router.dispose();
});
