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

test("checkout opens once and only a fresh cloud response changes the displayed subscription", async () => {
  const app = fixture();
  await userEvent.click(
    await screen.findByRole("button", { name: "Subscribe" }),
  );
  expect(app.createCheckout).toHaveBeenCalledWith({
    planId: "openchart",
    interval: "year",
  });
  expect(app.openBilling).toHaveBeenCalledOnce();
  expect(app.onStatusChange).not.toHaveBeenCalled();
  expect(screen.getByRole("switch", { name: "Yearly billing" })).toBeVisible();
  app.returned();
  await waitFor(() => expect(app.getSubscription).toHaveBeenCalledTimes(2));
  expect(app.onStatusChange).not.toHaveBeenCalled();
  expect(screen.getByRole("switch", { name: "Yearly billing" })).toBeVisible();
  app.getSubscription.mockResolvedValue(trial);
  app.returned();
  expect(await screen.findByText("Free trial")).toBeVisible();
  expect(app.onStatusChange).toHaveBeenCalledOnce();
  await userEvent.click(
    screen.getByRole("button", { name: "Manage subscription" }),
  );
  expect(app.createPortal).toHaveBeenCalledOnce();
  app.getSubscription.mockResolvedValue({ ...trial, cancelAtPeriodEnd: true });
  app.returned();
  expect(await screen.findByText("Scheduled to end")).toBeVisible();
  expect(screen.getByText("Free trial")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Subscribe" }),
  ).not.toBeInTheDocument();
});

test("the billing toggle sends the selected monthly price to checkout", async () => {
  const app = fixture();
  const toggle = await screen.findByRole("switch", { name: "Yearly billing" });
  expect(toggle).toBeChecked();
  expect(screen.getByText("$99")).toBeVisible();
  await userEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(screen.getByText("$9")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
  expect(app.createCheckout).toHaveBeenCalledWith({
    planId: "openchart",
    interval: "month",
  });
});

test("an unavailable subscription does not show an offer until retry confirms none", async () => {
  const app = fixture(new Error("Offline"));
  expect(await screen.findByText(/details are unavailable/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Subscribe" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  app.getSubscription.mockResolvedValue({ status: "none" });
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(
    await screen.findByRole("button", { name: "Subscribe" }),
  ).toBeEnabled();
});

test("a failed refresh disables the offer until subscription facts recover", async () => {
  const app = fixture();
  await screen.findByRole("button", { name: "Subscribe" });
  app.getSubscription.mockRejectedValue(new Error("Offline"));
  app.returned();
  expect(await screen.findByText(/may be out of date/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Subscribe" })).toBeDisabled();
  expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true");
  expect(app.createCheckout).not.toHaveBeenCalled();
  app.getSubscription.mockResolvedValue({ status: "none" });
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeEnabled(),
  );
});

test("annual subscribers keep the management design and see their billing interval", async () => {
  fixture({ ...trial, status: "active", interval: "year" });
  expect(await screen.findByText("Active")).toBeVisible();
  expect(screen.getByText("$99 USD / year")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Manage subscription" }),
  ).toBeEnabled();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
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
  expect(
    await screen.findByRole("button", { name: "Subscribe" }),
  ).toBeVisible();
});

// The account gate unmounts Billing on any account change.
test("pending checkout cannot open after unmount", async () => {
  const app = fixture();
  let resolve!: (link: { url: string }) => void;
  app.createCheckout.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Subscribe" }),
  );
  expect(screen.getByRole("button", { name: "Opening…" })).toBeDisabled();
  expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true");
  app.unmount();
  await act(async () => {
    resolve({ url: "https://checkout.stripe.com/c/pay/old" });
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
  "%s subscriptions offer checkout without billing management and refresh on focus",
  async (status) => {
    const app = fixture({
      ...trial,
      status,
      cancelAtPeriodEnd: true,
    });
    expect(
      await screen.findByRole("button", { name: "Subscribe" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Manage/ }),
    ).not.toBeInTheDocument();
    expect(app.createPortal).not.toHaveBeenCalled();
    expect(screen.getByText(/Billing period end/)).toBeVisible();
    app.getSubscription.mockResolvedValue(trial);
    await act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("Free trial")).toBeVisible();
  },
);
