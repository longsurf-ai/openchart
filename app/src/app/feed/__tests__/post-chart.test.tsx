// Purpose: A deleted chart reads as unavailable; only transient failures offer Retry.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PostChart } from "@openchart/app/app/feed/post-chart";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

function mount(failure: Error) {
  const transport = {
    url: "test",
    rpc: {
      resources: {
        chart: { get: { query: vi.fn().mockRejectedValue(failure) } },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PostChart transport={transport} chartId="cht_gone" at={0} />
    </QueryClientProvider>,
  );
}

test("a deleted chart shows the unavailable placeholder without Retry", async () => {
  mount(Object.assign(new Error("gone"), { data: { code: "NOT_FOUND" } }));
  expect(
    await screen.findByText("This chart is no longer available."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Retry chart" }),
  ).not.toBeInTheDocument();
});

test("a transient failure still offers Retry", async () => {
  mount(new Error("offline"));
  expect(
    await screen.findByRole("button", { name: "Retry chart" }),
  ).toBeVisible();
});
