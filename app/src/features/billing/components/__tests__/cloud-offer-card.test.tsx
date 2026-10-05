// Purpose: Verify the Cloud offer card appears only for accounts without Cloud access and leads to the plan.
import { FeedError, FeedReasons } from "@openchart/feed";
import { ProviderId } from "@openchart/market";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CloudOfferCard } from "@openchart/app/features/billing/components/cloud-offer-card";
import { AppHostProvider } from "@openchart/app/lib/host/host";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { reportUpsell, useUpsell } from "@openchart/app/lib/upsell/upsell";
import { testAppHost } from "@openchart/app/testing/test-utils";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { id: "user_1" } }),
}));

beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  useUpsell.setState({
    pending: undefined,
    open: false,
    lastShownAt: undefined,
  });
});
afterEach(() => vi.unstubAllGlobals());

const limited = new FeedError({
  reason: new FeedReasons.HistoryUnavailable({
    provider: ProviderId.make("yfinance"),
    availableFrom: 0,
  }),
});
const trial = {
  status: "trialing",
  planId: "openchart",
  interval: "month",
  currentPeriodStart: "2026-10-01T12:00:00.000Z",
  currentPeriodEnd: "2026-10-31T12:00:00.000Z",
  cancelAtPeriodEnd: false,
  cancelAt: null,
};

function fixture({
  subscription = { status: "none" } as object,
  canAccess = false,
  paused = false,
} = {}) {
  const getSubscription = vi.fn(async () => subscription);
  const transport = {
    rpc: {
      access: {
        billing: {
          getSubscription: { query: getSubscription },
          getAccess: {
            query: vi.fn(async () => ({
              canAccess,
              complimentaryAccessUntil: null,
            })),
          },
          createCheckout: { mutate: vi.fn() },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AppHostProvider value={testAppHost()}>
        <CloudOfferCard transport={transport} paused={paused} />
      </AppHostProvider>
    </QueryClientProvider>,
  );
  return { getSubscription, view };
}

test("a moment Cloud solves shows the offer once; Stay on limited data closes it", async () => {
  const user = userEvent.setup();
  const { getSubscription } = fixture();
  expect(getSubscription).not.toHaveBeenCalled();
  act(() => reportUpsell(limited));
  expect(await screen.findByText("Keep your data flowing")).toBeInTheDocument();
  expect(
    screen.getByText("Explore higher quality market data"),
  ).toBeInTheDocument();
  expect(useUpsell.getState().lastShownAt).toBeTypeOf("number");

  await user.click(
    screen.getByRole("button", { name: "Stay on limited data" }),
  );
  expect(screen.queryByText("Keep your data flowing")).not.toBeInTheDocument();
  // Within the cooldown a new moment stays quiet.
  act(() => reportUpsell(limited));
  await waitFor(() => expect(useUpsell.getState().pending).toBeUndefined());
  expect(screen.queryByText("Keep your data flowing")).not.toBeInTheDocument();
});

test("Explore Cloud opens the plan dialog", async () => {
  const user = userEvent.setup();
  fixture();
  act(() => reportUpsell(limited));
  await user.click(
    await screen.findByRole("button", { name: /Explore Cloud/ }),
  );
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.queryByText("Keep your data flowing")).not.toBeInTheDocument();
});

test.each([
  ["a subscriber", { subscription: trial }],
  ["an invited account", { canAccess: true }],
])("%s never sees the offer", async (_, options) => {
  fixture(options);
  act(() => reportUpsell(limited));
  await waitFor(() => expect(useUpsell.getState().pending).toBeUndefined());
  expect(screen.queryByText("Keep your data flowing")).not.toBeInTheDocument();
  expect(useUpsell.getState().lastShownAt).toBeUndefined();
});

test("while paused, moments are dropped without reading billing", async () => {
  const { getSubscription } = fixture({ paused: true });
  act(() => reportUpsell(limited));
  await waitFor(() => expect(useUpsell.getState().pending).toBeUndefined());
  expect(getSubscription).not.toHaveBeenCalled();
  expect(screen.queryByText("Keep your data flowing")).not.toBeInTheDocument();
});
