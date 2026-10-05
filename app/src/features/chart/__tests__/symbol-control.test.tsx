// Purpose: Header symbol changes capture Resource identities without a chart runtime.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { defineId } from "@openchart/identifier";
import { ProviderId } from "@openchart/market";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import {
  chartDetail,
  createCell,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { SymbolControl } from "@openchart/app/features/chart/components/symbol-control";
import type { SymbolPicker } from "@openchart/app/features/chart/components/symbol-picker";
import {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

vi.mock("@openchart/app/features/chart/components/symbol-picker", () => ({
  SymbolPicker: ({ onSelect }: React.ComponentProps<typeof SymbolPicker>) => (
    <button
      onClick={() =>
        void onSelect(
          {
            provider: ProviderId.make("test"),
            listing: { symbol: "GOOG", currency: "USD" },
          },
          [
            {
              resolution: "1d",
              session: "regular",
              adjustment: "raw",
              modes: ["history", "delayed"],
            },
          ],
        )
      }
    >
      Choose GOOG
    </button>
  ),
}));

function setup() {
  const chart = (symbol: string): ChartResource => ({
    id: defineId("cht", "Chart.ID").create(),
    dashboardId: "dsh_test",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1",
    cells: [
      createCell(
        {
          provider: ProviderId.make("test"),
          listing: { symbol, currency: "USD" },
        },
        { resolution: "1d", session: "regular", adjustment: "raw" },
      ),
    ],
    links: [],
  });
  const a = chart("AAPL");
  const b = chart("MSFT");
  const patch = vi.fn().mockImplementation((input) =>
    Promise.resolve({
      ...a,
      revision: 2,
      cells: input.operations.find(
        (op: { path: string }) => op.path === "/cells",
      ).value,
    }),
  );
  const transport = {
    url: "test",
    rpc: {
      resources: {
        chart: { get: { query: vi.fn() }, patch: { mutate: patch } },
        dashboard: { get: { query: vi.fn() } },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const dashboard: Dashboard = {
    id: defineId("dsh", "Dashboard.ID").create(),
    name: "Test",
    favorite: false,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    widgets: [a, b].map((item, index) => ({
      id: defineId("wdg", "WidgetPlacement.ID").create(),
      kind: "chart",
      resourceId: item.id,
      layout: { x: index * 6, y: 0, w: 6, h: 8 },
    })),
  };
  client.setQueryData(
    dashboardQueryOptions(transport, dashboard.id).queryKey,
    dashboard,
  );
  for (const item of [a, b])
    client.setQueryData(chartDetail(transport, item.id).queryKey, item);
  const content = (chartId: string) => (
    <QueryClientProvider client={client}>
      <SymbolControl
        dashboardId={dashboard.id}
        chartId={chartId}
        transport={transport}
      />
    </QueryClientProvider>
  );
  const view = render(content(a.id));
  return {
    a,
    b,
    patch,
    transport,
    client,
    dashboard,
    view,
    content,
    user: userEvent.setup(),
  };
}

it("changes the chart captured when opening, even if another widget gains focus", async () => {
  const { a, b, patch, client, view, content, user } = setup();
  await user.click(
    screen.getByRole("button", { name: "Symbol AAPL. Change symbol" }),
  );
  view.rerender(content(b.id));
  await user.click(screen.getByRole("button", { name: "Choose GOOG" }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(patch.mock.calls[0]![0]).toMatchObject({
    id: a.id,
    expectedRevision: 1,
    operations: [
      {
        path: "/cells",
        value: [
          {
            id: a.cells[0]!.id,
            marketSources: [{ listing: { symbol: "GOOG", currency: "USD" } }],
          },
        ],
      },
    ],
  });
  expect(
    screen.getByRole("button", { name: "Symbol MSFT. Change symbol" }),
  ).toBeVisible();
  view.unmount();
  client.clear();
});

it("closes a captured picker when its placement is removed without retargeting it", async () => {
  const { patch, client, transport, dashboard, view, user } = setup();
  await user.click(
    screen.getByRole("button", { name: "Symbol AAPL. Change symbol" }),
  );
  await act(() =>
    client.setQueryData(
      dashboardQueryOptions(transport, dashboard.id).queryKey,
      { ...dashboard, widgets: [] },
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Choose GOOG" }),
    ).not.toBeInTheDocument(),
  );
  expect(patch).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
});
