// Purpose: Resolve the original drawing's saved chart without creating resources or mixing market identities.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { ProviderId } from "@openchart/market";
import { AlertDrawingChart } from "@openchart/app/app/alerts/alert-drawing-chart";
import { createCell } from "@openchart/app/features/chart/api/queries";
import { useChartGrid } from "@openchart/app/hooks/use-chart-grid";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import type { DrawingAlert } from "@openchart/app/features/alerts/api/queries";

vi.mock("@openchart/app/features/chart/components/cell", () => ({
  ChartCell: ({
    cellId,
    drawingId,
  }: {
    cellId: string;
    drawingId?: string;
  }) => {
    const { chartId, focusedId } = useChartGrid();
    return (
      <p data-drawing-id={drawingId}>
        Chart {chartId}, cell {cellId}, focused {focusedId}
      </p>
    );
  },
}));
vi.mock("@openchart/app/features/chart/components/drawing-toolbar", () => ({
  FocusedDrawingToolbar: () => <p>Drawing tools</p>,
}));

const inputs = {
  provider: ProviderId.make("binance"),
  listing: { symbol: "BTCUSDT", currency: "USDT", venue: "BINANCE" },
  resolution: "1h" as const,
  session: "regular" as const,
  adjustment: "raw" as const,
};
const drawing: DrawingAlert = {
  kind: "drawing",
  drawingId: "drw_original",
  operator: "crossing",
  inputs,
};
const original = {
  id: drawing.drawingId,
  dashboardId: "dsh_original",
  provider: inputs.provider,
  listing: inputs.listing,
  revision: 1,
  data: { id: "renderer-line", type: "extended_line", anchors: [] },
};
const clients: QueryClient[] = [];
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
});

function mount() {
  const get = vi.fn().mockResolvedValue(original);
  const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const create = vi.fn();
  const patch = vi.fn();
  const transport = {
    url: "linked-chart-test",
    rpc: {
      resources: {
        drawing: { get: { query: get } },
        chart: {
          list: { query: list },
          create: { mutate: create },
          patch: { mutate: patch },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return {
    get,
    list,
    create,
    patch,
    render: () =>
      render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <AlertDrawingChart drawing={drawing} transport={transport} />
          </QueryClientProvider>
        </MemoryRouter>,
      ),
  };
}

test("reads all chart pages and prefers the alert's complete market binding in its original Dashboard", async () => {
  const fixture = mount();
  const daily = createCell(inputs, { ...inputs, resolution: "1d" });
  const otherProvider = createCell(
    { ...inputs, provider: ProviderId.make("other") },
    inputs,
  );
  const otherVenue = createCell(
    { ...inputs, listing: { ...inputs.listing, venue: "OTHER" } },
    inputs,
  );
  const match = createCell(inputs, inputs);
  fixture.list
    .mockResolvedValueOnce({
      items: [
        {
          id: "cht_daily",
          dashboardId: original.dashboardId,
          preset: "1",
          cells: [daily],
        },
        {
          id: "cht_other",
          dashboardId: original.dashboardId,
          preset: "1x2",
          cells: [otherProvider, otherVenue],
        },
      ],
      nextCursor: "next",
    })
    .mockResolvedValueOnce({
      items: [
        {
          id: "cht_original",
          dashboardId: original.dashboardId,
          preset: "1x2",
          cells: [otherProvider, match],
        },
      ],
      nextCursor: null,
    });
  fixture.render();
  expect(
    await screen.findByText(
      `Chart cht_original, cell ${match.id}, focused ${match.id}`,
    ),
  ).toBeVisible();
  expect(screen.queryByText("Drawing tools")).not.toBeInTheDocument();
  expect(
    screen.getByText(
      `Chart cht_original, cell ${match.id}, focused ${match.id}`,
    ),
  ).toHaveAttribute("data-drawing-id", drawing.drawingId);
  expect(screen.getByText("Drawing changes save automatically")).toBeVisible();
  expect(fixture.get).toHaveBeenCalledWith(
    { id: drawing.drawingId },
    expect.anything(),
  );
  expect(fixture.list).toHaveBeenLastCalledWith(
    {
      filter: { dashboardId: original.dashboardId },
      limit: 100,
      cursor: "next",
    },
    expect.anything(),
  );
  expect(fixture.create).not.toHaveBeenCalled();
  expect(fixture.patch).not.toHaveBeenCalled();
});

test("a deleted drawing never falls back to a new or unrelated chart", async () => {
  const fixture = mount();
  fixture.get.mockRejectedValue(
    Object.assign(new Error("Gone"), { data: { code: "NOT_FOUND" } }),
  );
  fixture.render();
  expect(
    await screen.findByText("This drawing is no longer available."),
  ).toBeVisible();
  expect(fixture.list).not.toHaveBeenCalled();
  expect(fixture.create).not.toHaveBeenCalled();
});

test("a comparison series and a matching cell in another Dashboard do not qualify", async () => {
  const fixture = mount();
  const other = createCell(
    { ...inputs, listing: { symbol: "ETHUSDT", currency: "USDT" } },
    inputs,
  );
  const comparison = {
    ...other,
    marketSources: [
      ...other.marketSources,
      createCell(inputs, inputs).marketSources[0]!,
    ],
  };
  fixture.list.mockResolvedValue({
    items: [
      {
        id: "cht_compare",
        dashboardId: original.dashboardId,
        preset: "1",
        cells: [comparison],
      },
      {
        id: "cht_elsewhere",
        dashboardId: "dsh_other",
        preset: "1",
        cells: [createCell(inputs, inputs)],
      },
    ],
    nextCursor: null,
  });
  fixture.render();
  const link = await screen.findByRole("link", { name: "Open dashboard" });
  expect(link).toHaveAttribute("href", "/app/dashboards/dsh_original");
  expect(
    screen.queryByRole("region", { name: "Alert chart" }),
  ).not.toBeInTheDocument();
  expect(fixture.create).not.toHaveBeenCalled();
});

test("failed chart reads offer retry without creating a replacement", async () => {
  const fixture = mount();
  fixture.list.mockRejectedValueOnce(new Error("Offline"));
  fixture.render();
  await userEvent.click(
    await screen.findByRole("button", { name: "Retry chart" }),
  );
  await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(2));
  expect(
    await screen.findByRole("link", { name: "Open dashboard" }),
  ).toBeVisible();
  expect(fixture.create).not.toHaveBeenCalled();
});
