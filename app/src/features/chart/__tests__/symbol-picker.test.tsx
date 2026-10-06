// Purpose: Saved symbol hits accelerate display without suppressing provider searches.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  FeedError,
  FeedReasons,
  type SymbolSearchRequest,
  type SymbolSearchResult,
} from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { SymbolSearch } from "@openchart/app/features/chart/components/symbol-picker";

const { search, getCapabilities } = vi.hoisted(() => ({
  search:
    vi.fn<(request: SymbolSearchRequest) => Promise<SymbolSearchResult>>(),
  getCapabilities: vi.fn(async () => [
    {
      resolution: "1d",
      session: "regular",
      adjustment: "raw",
      modes: ["history"],
    },
  ]),
}));
vi.mock("@openchart/app/hooks/use-datafeed", () => ({
  useDatafeed: () => ({ symbology: { search }, bars: { getCapabilities } }),
  useFeedVersion: () => "test",
}));

it("keeps same-symbol listings separate through reordered results and selection", async () => {
  const listings = [
    { id: 10244, name: "The SPAC and New Issue ETF" },
    { id: 55090, name: "Space Exploration Technologies Corp." },
  ].map((entry) => ({
    provider: ProviderId.make("openchart"),
    listing: { ...entry, symbol: "SPCX", venue: "NASDAQ", currency: "USD" },
  }));
  search.mockReset();
  search.mockResolvedValue(listings);
  getCapabilities.mockClear();
  const onSelect = vi.fn();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <SymbolSearch initialQuery="SPCX" onSelect={onSelect} />
    </QueryClientProvider>,
  );
  try {
    fireEvent.click(
      await screen.findByRole("button", { name: /SPCX The SPAC/ }),
    );
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(listings[0], expect.any(Array)),
    );
    search.mockResolvedValue([...listings].reverse());
    fireEvent.change(screen.getByRole("textbox", { name: "Search symbols" }), {
      target: { value: "SPC" },
    });
    const second = await screen.findByRole("button", {
      name: /SPCX Space Exploration/,
    });
    await waitFor(() => expect(second).toBeEnabled());
    fireEvent.click(second);
    await waitFor(() =>
      expect(onSelect).toHaveBeenLastCalledWith(listings[1], expect.any(Array)),
    );
    expect(getCapabilities).toHaveBeenNthCalledWith(1, listings[0]);
    expect(getCapabilities).toHaveBeenNthCalledWith(2, listings[1]);
    expect(error).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
    error.mockRestore();
  }
});

it.each(["matches", "empty", "failure", "denied"])(
  "automatically replaces saved hits with the provider outcome: %s",
  async (outcome) => {
    const saved = {
      provider: ProviderId.make("test"),
      listing: { symbol: "ETHBTC", currency: "BTC" },
    };
    const live = {
      provider: ProviderId.make("test"),
      listing: { symbol: "ETHUSD", currency: "USD" },
    };
    let resolve!: (value: SymbolSearchResult) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<SymbolSearchResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    search.mockReset();
    search.mockImplementation((request) =>
      request.indexed ? Promise.resolve([saved]) : pending,
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <SymbolSearch initialQuery="ETH" onSelect={vi.fn()} />
      </QueryClientProvider>,
    );
    try {
      expect(
        await screen.findByRole("button", { name: /ETHBTC/ }),
      ).toBeVisible();
      expect(search).toHaveBeenCalledWith({
        query: "ETH",
        limit: 30,
        indexed: false,
      });
      expect(screen.queryByText("Search providers")).not.toBeInTheDocument();
      expect(screen.getByText("Searching…")).toBeVisible();
      expect(
        screen.queryByText("No matching symbols."),
      ).not.toBeInTheDocument();
      await act(async () => {
        if (outcome === "failure" || outcome === "denied")
          reject(
            new FeedError({
              reason:
                outcome === "failure"
                  ? new FeedReasons.SourceUnavailable({
                      provider: live.provider,
                    })
                  : new FeedReasons.AccessDenied({ provider: live.provider }),
            }),
          );
        else resolve(outcome === "matches" ? [live] : []);
        await pending.catch(() => undefined);
      });
      if (outcome === "matches")
        expect(
          await screen.findByRole("button", { name: /ETHUSD/ }),
        ).toBeVisible();
      else if (outcome === "empty")
        expect(await screen.findByText("No matching symbols.")).toBeVisible();
      else if (outcome === "failure")
        expect(
          await screen.findByRole("button", { name: "Retry" }),
        ).toBeVisible();
      else {
        // Access stays denied however often the search repeats.
        await vi.waitFor(() =>
          expect(screen.queryByText("Searching…")).not.toBeInTheDocument(),
        );
        expect(
          screen.queryByRole("button", { name: "Retry" }),
        ).not.toBeInTheDocument();
      }
      expect(
        screen.queryByRole("button", { name: /ETHBTC/ }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
    } finally {
      view.unmount();
      client.clear();
    }
  },
);
