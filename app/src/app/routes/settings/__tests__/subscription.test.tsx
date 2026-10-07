// Purpose: Verify Subscription scopes billing to the signed-in local account, offers sign-in while signed out, and refreshes provider access on status.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { expect, test, vi } from "vitest";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { AppHostProvider } from "@openchart/app/lib/host/host";
import { testAppHost } from "@openchart/app/testing/test-utils";
import SubscriptionSettings from "@openchart/app/app/routes/settings/subscription";

const context = vi.hoisted(() => ({
  transport: undefined as AppTransport | undefined,
}));
const clerk = vi.hoisted(() => ({ openSignIn: vi.fn() }));
vi.mock("react-router", () => ({ useOutletContext: () => context }));
vi.mock("@clerk/react", () => ({
  useClerk: () => clerk,
  useUser: () => ({ user: { id: "user_1" } }),
}));
vi.mock("@openchart/app/app/routes/settings/settings-page", () => ({
  SettingsPage: ({ children }: PropsWithChildren) => children,
}));

function showSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AppHostProvider value={testAppHost()}>
        <SubscriptionSettings />
      </AppHostProvider>
    </QueryClientProvider>,
  );
  return client;
}

test("a signed-out account is offered Clerk sign-in without reading billing", async () => {
  const billing = vi.fn();
  context.transport = {
    rpc: {
      providers: { refresh: { mutate: vi.fn() } },
      access: {
        auth: {
          getState: { query: vi.fn(async () => ({ status: "signed-out" })) },
        },
        billing: { getSubscription: { query: billing } },
      },
    },
    events: { subscribe: () => ({ unsubscribe() {} }) },
  } as unknown as AppTransport;
  showSettings();
  await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  expect(clerk.openSignIn).toHaveBeenCalledOnce();
  expect(billing).not.toHaveBeenCalled();
});

test("signed-in billing loads once and refreshes provider access when status changes", async () => {
  const billing = vi.fn(async (): Promise<object> => ({ status: "none" }));
  const refresh = vi.fn(async () => {});
  let redeemedCode: string | null = null;
  context.transport = {
    rpc: {
      providers: { refresh: { mutate: refresh } },
      access: {
        auth: {
          getState: {
            query: vi.fn(async () => ({
              status: "signed-in",
              user: { id: "user_1" },
            })),
          },
        },
        billing: {
          getSubscription: { query: billing },
          getReferrals: {
            query: vi.fn(async () => ({
              canInvite: false,
              codes: [],
              redeemedCode,
            })),
          },
          getAccess: {
            query: vi.fn(async () => ({
              canAccess: false,
              complimentaryAccessUntil: null,
            })),
          },
          redeemReferral: {
            mutate: vi.fn(async ({ code }: { code: string }) => {
              redeemedCode = code;
              return {
                canAccess: true,
                complimentaryAccessUntil: "2099-11-03T12:00:00.000Z",
              };
            }),
          },
        },
      },
    },
    events: { subscribe: () => ({ unsubscribe() {} }) },
  } as unknown as AppTransport;
  const client = showSettings();
  expect(
    await screen.findByRole("button", { name: "Subscribe" }),
  ).toBeVisible();
  expect(billing).toHaveBeenCalledOnce();
  expect(client.getQueryData(["billing", "user_1"])).toEqual({
    status: "none",
  });
  expect(refresh).not.toHaveBeenCalled();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Invitation code" }),
    "ABCDEF",
  );
  await userEvent.click(screen.getByRole("button", { name: "Redeem code" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(client.getQueryData(["billing", "user_1"])).toEqual({
    status: "none",
  });
  expect(screen.getByRole("button", { name: "Subscribe" })).toBeVisible();
  refresh.mockClear();
  billing.mockResolvedValue({
    status: "trialing",
    planId: "openchart",
    interval: "month",
    currentPeriodStart: "2026-10-01T12:00:00.000Z",
    currentPeriodEnd: "2026-10-31T12:00:00.000Z",
    cancelAtPeriodEnd: false,
    cancelAt: null,
  });
  await act(() => window.dispatchEvent(new Event("focus")));
  expect(await screen.findByText("Free trial")).toBeVisible();
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});
