// Purpose: Verify hosted billing never turns navigation, failures, or stale accounts into subscription facts.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Subscription } from "@openchart/app/features/billing/components/subscription";
import { AppHostProvider } from "@openchart/app/lib/host/host";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { testAppHost } from "@openchart/app/testing/test-utils";

const clerk = vi.hoisted(() => ({ userId: "user_1" }));
vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { id: clerk.userId } }),
}));

// jsdom omits PointerEvent, which Base UI uses to forward switch clicks.
beforeEach(() => vi.stubGlobal("PointerEvent", MouseEvent));
afterEach(() => {
  vi.unstubAllGlobals();
  clerk.userId = "user_1";
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
function fixture(initial: object = { status: "none" }) {
  const getSubscription = vi.fn(async () => {
    if (initial instanceof Error) throw initial;
    return initial;
  });
  const createCheckout = vi.fn(async () => ({
    url: "https://checkout.stripe.com/c/pay/cs_test_fixture",
  }));
  const createPortal = vi.fn(async () => ({
    url: "https://billing.stripe.com/p/session/test_fixture",
  }));
  const openBilling = vi.fn(async () => {});
  const callbacks = new Set<() => void>();
  const host = testAppHost({
    openBilling,
    onBillingReturn: (callback) => {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
  });
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
              complimentaryAccessUntil: null,
            })),
          },
          createCheckout: { mutate: createCheckout },
          createPortal: { mutate: createPortal },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onStatusChange = vi.fn();
  const tree = (
    <QueryClientProvider client={client}>
      <AppHostProvider value={host}>
        <Subscription transport={transport} onStatusChange={onStatusChange} />
      </AppHostProvider>
    </QueryClientProvider>
  );
  const view = render(tree);
  return {
    ...view,
    remount: () => {
      view.unmount();
      return render(tree);
    },
    getSubscription,
    onStatusChange,
    createCheckout,
    createPortal,
    openBilling,
    client,
    returned: () =>
      act(() => {
        for (const callback of callbacks) callback();
      }),
  };
}

test.each([
  "none",
  "canceled",
  "incomplete_expired",
  "active",
  "trialing",
  "past_due",
])(
  "%s never offers purchases, trials or invitations after retirement",
  async (status) => {
    const app = fixture(status === "none" ? { status } : { ...trial, status });
    await screen.findByRole("button", { name: "Refresh" });
    expect(screen.getByText(/market data has been retired/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Subscribe" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "Yearly billing" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Invite friends")).not.toBeInTheDocument();
    expect(app.createCheckout).not.toHaveBeenCalled();
  },
);

test("unavailable billing remains an error until a fresh read confirms no subscription", async () => {
  const app = fixture(new Error("Offline"));
  expect(await screen.findByText(/details are unavailable/)).toBeVisible();
  expect(
    screen.queryByText("No existing subscription."),
  ).not.toBeInTheDocument();
  app.getSubscription.mockResolvedValue({ status: "none" });
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText("No existing subscription.")).toBeVisible();
  expect(app.createCheckout).not.toHaveBeenCalled();
});

test("query failures preserve facts and never offer checkout for an unknown subscription", async () => {
  const app = fixture(trial);
  await screen.findByText("Free trial");
  app.getSubscription.mockRejectedValue(new Error("Offline"));
  app.returned();
  expect(await screen.findByText(/may be out of date/)).toBeVisible();
  expect(app.onStatusChange).not.toHaveBeenCalled();
  expect(screen.getByText("Free trial")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Manage subscription" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Subscribe" }),
  ).not.toBeInTheDocument();
  app.getSubscription.mockResolvedValue(trial);
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Manage subscription" }),
    ).toBeEnabled(),
  );
});

test("revisits render cached facts at once and refresh in the background", async () => {
  const app = fixture(trial);
  await screen.findByText("Free trial");
  app.getSubscription.mockResolvedValue({ ...trial, status: "active" });
  app.remount();
  expect(screen.getByText("Free trial")).toBeVisible();
  expect(screen.queryByText("Loading subscription…")).not.toBeInTheDocument();
  expect(await screen.findByText("Active")).toBeVisible();
  expect(app.getSubscription).toHaveBeenCalledTimes(2);
});

test("another user never sees the previous user's cached facts", async () => {
  const app = fixture(trial);
  await screen.findByText("Free trial");
  clerk.userId = "user_2";
  app.getSubscription.mockResolvedValue({ status: "none" });
  app.remount();
  expect(screen.queryByText("Free trial")).not.toBeInTheDocument();
  expect(screen.getByText("Loading subscription…")).toBeVisible();
  expect(await screen.findByText("No existing subscription.")).toBeVisible();
});

// Subscription settings remount Billing for each signed-in account.
test("pending billing management cannot open after unmount", async () => {
  const app = fixture(trial);
  let resolve!: (link: { url: string }) => void;
  app.createPortal.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Manage subscription" }),
  );
  app.unmount();
  await act(async () => {
    resolve({ url: "https://billing.stripe.com/p/session/old" });
  });
  expect(app.openBilling).not.toHaveBeenCalled();
});

test.each(["past_due", "unpaid", "paused", "incomplete"])(
  "%s goes to Portal without creating another subscription",
  async (status) => {
    const app = fixture({ ...trial, status });
    await userEvent.click(
      await screen.findByRole("button", { name: "Manage subscription" }),
    );
    expect(app.createPortal).toHaveBeenCalledOnce();
    expect(app.createCheckout).not.toHaveBeenCalled();
  },
);

test.each(["canceled", "incomplete_expired"])(
  "%s retains customer management and never offers resubscription",
  async (status) => {
    const app = fixture({ ...trial, status, cancelAtPeriodEnd: true });
    await userEvent.click(
      await screen.findByRole("button", { name: "Manage subscription" }),
    );
    expect(app.createPortal).toHaveBeenCalledOnce();
    expect(app.createCheckout).not.toHaveBeenCalled();
    app.getSubscription.mockResolvedValue(trial);
    await act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("Free trial")).toBeVisible();
  },
);
