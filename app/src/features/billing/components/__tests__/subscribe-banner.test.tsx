// Purpose: Verify the sidebar offer appears only for confirmed unsubscribed accounts and checks out through the plan card.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SubscribeBanner } from "@openchart/app/features/billing/components/subscribe-banner";
import { AppHostProvider } from "@openchart/app/lib/host/host";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { testAppHost } from "@openchart/app/testing/test-utils";

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { id: "user_1" } }),
}));

// jsdom omits PointerEvent, which Base UI uses to forward switch clicks.
beforeEach(() => vi.stubGlobal("PointerEvent", MouseEvent));
afterEach(() => vi.unstubAllGlobals());

const trial = {
  status: "trialing",
  planId: "openchart",
  interval: "month",
  currentPeriodStart: "2026-10-01T12:00:00.000Z",
  currentPeriodEnd: "2026-10-31T12:00:00.000Z",
  cancelAtPeriodEnd: false,
  cancelAt: null,
};
const banner = { name: /Try Cloud free/ };

function fixture(
  initial: object | Error,
  complimentaryAccessUntil: string | null = null,
) {
  const getSubscription = vi.fn(async (): Promise<object> => {
    if (initial instanceof Error) throw initial;
    return initial;
  });
  const createCheckout = vi.fn(async () => ({
    url: "https://checkout.stripe.com/c/pay/cs_test_fixture",
  }));
  const openBilling = vi.fn(async () => {});
  const onStatusChange = vi.fn();
  const onInviteFriends = vi.fn();
  const transport = {
    rpc: {
      access: {
        billing: {
          getSubscription: { query: getSubscription },
          getReferrals: {
            query: vi.fn(async () => ({
              canInvite: false,
              codes: [],
              redeemedCode: null,
            })),
          },
          getAccess: {
            query: vi.fn(async () => ({
              canAccess: false,
              complimentaryAccessUntil,
            })),
          },
          createCheckout: { mutate: createCheckout },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AppHostProvider value={testAppHost({ openBilling })}>
        <SubscribeBanner
          transport={transport}
          onStatusChange={onStatusChange}
          onInviteFriends={onInviteFriends}
        />
      </AppHostProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    getSubscription,
    createCheckout,
    openBilling,
    onStatusChange,
    onInviteFriends,
  };
}

test("an unsubscribed account opens the plan card, checks out, and loses the offer once subscribed", async () => {
  const app = fixture({ status: "none" });
  await userEvent.click(await screen.findByRole("button", banner));
  const dialog = await screen.findByRole("dialog", { name: "OpenChart Cloud" });
  expect(dialog).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
  expect(app.createCheckout).toHaveBeenCalledWith({
    planId: "openchart",
    interval: "year",
  });
  expect(app.openBilling).toHaveBeenCalledOnce();
  expect(app.onStatusChange).not.toHaveBeenCalled();
  app.getSubscription.mockResolvedValue(trial);
  await act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole("button", banner)).not.toBeInTheDocument();
  expect(app.onStatusChange).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Invite friends" }));
  expect(app.onInviteFriends).toHaveBeenCalledOnce();
});

test.each([
  ["subscribers", trial],
  ["active subscribers", { ...trial, status: "active" }],
  ["failed reads", new Error("Offline")],
])("%s never see the offer", async (_name, initial) => {
  const app = fixture(initial);
  expect(app.getSubscription).toHaveBeenCalledOnce();
  await waitFor(() => expect(app.client.isFetching()).toBe(0));
  expect(screen.queryByRole("button", banner)).not.toBeInTheDocument();
  if (initial instanceof Error) {
    expect(
      screen.queryByRole("button", { name: "Invite friends" }),
    ).not.toBeInTheDocument();
  } else {
    expect(
      screen.getByRole("button", { name: "Invite friends" }),
    ).toBeVisible();
  }
});

test("complimentary access keeps the no-plan banner and shows its expiry", async () => {
  const app = fixture({ status: "none" }, "2099-11-03T12:00:00.000Z");
  expect(await screen.findByRole("button", banner)).toBeVisible();
  expect(await screen.findByText(/Free access until/)).toBeVisible();
  expect(app.client.getQueryData(["billing", "user_1"])).toEqual({
    status: "none",
  });
});

test("expired complimentary access does not claim free access", async () => {
  const app = fixture({ status: "none" }, "2000-01-01T00:00:00.000Z");
  await screen.findByRole("button", banner);
  await waitFor(() => expect(app.client.isFetching()).toBe(0));
  expect(screen.queryByText(/Free access until/)).not.toBeInTheDocument();
});
