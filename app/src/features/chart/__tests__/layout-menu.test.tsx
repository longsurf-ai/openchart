import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import { findErrorToast } from "@openchart/app/testing/test-utils";
// Purpose: Keep symbol selection open until the Resource commit succeeds.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { FeedVersion } from "@openchart/feed";
import { defineId } from "@openchart/identifier";
import { ProviderId } from "@openchart/market";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { expect, it, vi } from "vitest";

import {
  chartDetail,
  createCell,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { GridPresetMenu } from "@openchart/app/features/chart/components/layout-menu";
import { ChartSelectionContext } from "@openchart/app/lib/chart/selection";
import { ChartGridProvider } from "@openchart/app/lib/chart/grid";
import type { FeedClient } from "@openchart/app/lib/feed/client";
import {
  FeedReactContext,
  FeedVersionContext,
} from "@openchart/app/lib/feed/provider";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

it("lets the empty grid retry a failed save and closes its picker only after commit", async () => {
  const options = {
    resolution: "1d",
    session: "regular",
    adjustment: "raw",
  } as const;
  const listing = {
    provider: ProviderId.make("test"),
    listing: { symbol: "AAPL", currency: "USD" },
  };
  const resource: ChartResource = {
    id: defineId("cht", "Chart.ID").create(),
    dashboardId: "dsh_test",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    preset: "1",
    cells: [],
    links: [],
  };
  let finish!: (resource: ChartResource) => void;
  const pending = new Promise<ChartResource>((resolve) => {
    finish = resolve;
  });
  const patch = vi
    .fn()
    .mockRejectedValueOnce(new Error("Save unavailable"))
    .mockReturnValue(pending);
  const transport = {
    rpc: {
      resources: {
        chart: {
          get: { query: vi.fn().mockResolvedValue(resource) },
          patch: { mutate: patch },
        },
      },
    },
  } as unknown as AppTransport;
  const feed: FeedClient = {
    bars: {
      observe: vi.fn(),
      getCapabilities: vi
        .fn()
        .mockResolvedValue([{ ...options, modes: ["history", "delayed"] }]),
    },
    symbology: {
      index: vi.fn(),
      indexStatus: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([listing]),
    },
    calendar: { getCalendar: vi.fn() },
    logos: { getLogo: vi.fn() },
    close: vi.fn(),
  };
  const queryClient = createQueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(
    chartDetail(transport, resource.id).queryKey,
    resource,
  );
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FeedReactContext.Provider value={feed}>
        <FeedVersionContext.Provider value={FeedVersion.make("test")}>
          <ChartSelectionContext.Provider
            value={{
              activeChartId: resource.id,
              focusedCells: {},
              focus: vi.fn(),
            }}
          >
            <ChartGridProvider chartId={resource.id} transport={transport}>
              <TooltipProvider>
                <GridPresetMenu empty />
              </TooltipProvider>
            </ChartGridProvider>
          </ChartSelectionContext.Provider>
        </FeedVersionContext.Provider>
      </FeedReactContext.Provider>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Add a chart" }));
  await user.type(
    screen.getByRole("textbox", { name: "Search symbols" }),
    "AAPL",
  );
  await user.click(await screen.findByRole("button", { name: /AAPL/ }));
  expect(await findErrorToast("Save unavailable")).toHaveTextContent(
    "Save unavailable",
  );
  await user.click(screen.getByRole("button", { name: /AAPL/ }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("dialog")).toHaveTextContent("Opening symbol…");
  expect(screen.getByRole("button", { name: /AAPL/ })).toBeDisabled();
  await act(async () =>
    finish({ ...resource, revision: 2, cells: [createCell(listing, options)] }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    queryClient.getQueryData(chartDetail(transport, resource.id).queryKey),
  ).toMatchObject({ revision: 2 });
  view.unmount();
  queryClient.clear();
});
