import { toast } from "sonner";
import { findErrorToast } from "@openchart/app/testing/test-utils";
import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
// Purpose: Verify provider coverage, honest loading/error states and index action wiring.
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ProviderSettings from "@openchart/app/app/routes/settings/providers";
import { FeedReactContext } from "@openchart/app/lib/feed/provider";
import { FeedTransport } from "@openchart/app/lib/feed/transport";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const rpc = vi.hoisted(() => ({
  providers: { checkAccess: { query: vi.fn() }, refresh: { mutate: vi.fn() } },
  access: {
    auth: { getState: { query: vi.fn() } },
    tradingview: {
      start: { mutate: vi.fn() },
      complete: { mutate: vi.fn() },
      cancel: { mutate: vi.fn() },
    },
    integration: {
      listIntegrations: { query: vi.fn() },
      connection: {
        disconnect: { mutate: vi.fn() },
      },
    },
  },
  feed: {
    symbology: { indexStatus: { query: vi.fn() }, index: { mutate: vi.fn() } },
  },
  resources: { symbology: { counts: { query: vi.fn() } } },
}));
const updateConfig = vi.hoisted(() => vi.fn());
const refreshConfig = vi.hoisted(() => vi.fn());
const preference = vi.hoisted(() => ({
  openchart: true,
  tradingview: true,
  isSaving: false,
  configAvailable: true,
  readError: null as Error | null,
}));
const navigate = vi.hoisted(() => vi.fn());
const clerk = vi.hoisted(() => ({ openSignIn: vi.fn() }));
const listeners = new Set<(frame: unknown) => void>();
const transport = {
  rpc,
  events: {
    subscribe: ({ next }: { next: (frame: unknown) => void }) => {
      listeners.add(next);
      return { unsubscribe: () => listeners.delete(next) };
    },
  },
};
vi.mock("@clerk/react", () => ({ useClerk: () => clerk }));
vi.mock("react-router", () => ({
  useOutletContext: () => ({ transport }),
  useNavigate: () => navigate,
}));
vi.mock("@openchart/app/hooks/use-config", () => ({
  useConfig: () => ({
    config: preference.configAvailable
      ? {
          providers: {
            binance: { enabled: true },
            yfinance: { enabled: true },
            openchart: { enabled: preference.openchart },
            tradingview: { enabled: preference.tradingview },
          },
        }
      : undefined,
    update: updateConfig,
    refresh: refreshConfig,
    readError: preference.readError,
    isSaving: preference.isSaving,
  }),
}));
vi.mock("@openchart/app/app/section-page", () => ({
  SectionPage: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));
let client: QueryClient;
beforeEach(() => {
  vi.spyOn(window, "open").mockReturnValue(null);
  preference.openchart = true;
  preference.tradingview = true;
  preference.isSaving = false;
  preference.configAvailable = true;
  preference.readError = null;
  updateConfig.mockImplementation((_patch, options) => options?.onSuccess());
  rpc.access.tradingview.start.mutate.mockResolvedValue({
    attemptID: "attempt-1",
    url: "https://auth.tradingview.com/accounts/tvd/connect/?key=public-hash",
    instructions: "Copy your login link from TradingView and paste it here.",
    proof: "proof-1",
  });
  rpc.access.tradingview.complete.mutate.mockResolvedValue({
    status: "complete",
  });
  rpc.access.tradingview.cancel.mutate.mockResolvedValue(undefined);
  rpc.access.auth.getState.query.mockResolvedValue({ status: "signed-out" });
  rpc.providers.checkAccess.query.mockResolvedValue({ status: "granted" });
  rpc.providers.refresh.mutate.mockResolvedValue(undefined);
  rpc.access.integration.listIntegrations.query.mockResolvedValue([]);
  rpc.access.integration.connection.disconnect.mutate.mockResolvedValue(
    undefined,
  );
  client = createQueryClient({ defaultOptions: { queries: { retry: false } } });
  rpc.feed.symbology.indexStatus.query.mockResolvedValue([
    {
      providerId: "binance",
      indexable: true,
      available: true,
      job: { state: "idle" },
    },
    {
      providerId: "yfinance",
      indexable: false,
      available: true,
      job: { state: "idle" },
    },
    {
      providerId: "tradingview",
      indexable: false,
      available: true,
      job: { state: "idle" },
    },
  ]);
  rpc.resources.symbology.counts.query.mockResolvedValue([
    { provider: "binance", count: 1250 },
  ]);
  rpc.feed.symbology.index.mutate.mockResolvedValue({ runId: "run-1" });
});
afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function show() {
  // The real Feed client decodes the mocked wire payloads.
  const feed = new FeedTransport({ rpc } as unknown as AppTransport).client();
  return render(
    <QueryClientProvider client={client}>
      <FeedReactContext.Provider value={feed}>
        <ProviderSettings />
      </FeedReactContext.Provider>
    </QueryClientProvider>,
  );
}

test("a completed run still describes its actual scope without exposing scope controls", async () => {
  rpc.feed.symbology.indexStatus.query.mockResolvedValue([
    {
      providerId: "binance",
      indexable: true,
      available: true,
      job: {
        state: "succeeded",
        runId: "run-1",
        filter: { quoteAsset: "USDT" },
        listingCount: 100,
      },
    },
  ]);
  show();
  await screen.findByText("1,250 listings indexed");
  fireEvent.click(screen.getByText("Binance"));
  expect(
    await screen.findByText("Indexed 100 USDT listings."),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Quote asset")).not.toBeInTheDocument();
});

test("header switches work without expanding rows; Index always requests the complete catalog", async () => {
  show();
  expect(await screen.findByText("1,250 listings indexed")).toBeInTheDocument();
  expect(screen.getAllByText("0 listings indexed")).toHaveLength(3);
  const disclosure = screen.getByRole("button", {
    name: /Binance.*listings indexed/,
  });
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.getByRole("switch", { name: "Enable Yahoo Finance" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("switch", { name: "Enable Binance" }));
  expect(updateConfig).toHaveBeenCalledWith({
    providers: { binance: { enabled: false } },
  });
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(screen.getByText("Binance"));
  expect(screen.queryByLabelText("Quote asset")).not.toBeInTheDocument();
  expect(
    screen.getByText("Index listings for faster symbol search."),
  ).toBeVisible();
  fireEvent.click(screen.getAllByRole("button", { name: "Index" })[0]!);
  await waitFor(() =>
    expect(rpc.feed.symbology.index.mutate).toHaveBeenCalledWith(
      { providerId: "binance", filter: {} },
      expect.anything(),
    ),
  );
  expect(screen.getByText("Yahoo Finance")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Yahoo Finance.*listings indexed/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Full indexing is unavailable/),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Index" })).toHaveLength(1);
});

test("failed counts never become zero; running jobs show indeterminate progress and cannot restart", async () => {
  rpc.resources.symbology.counts.query.mockRejectedValue(new Error("offline"));
  rpc.feed.symbology.indexStatus.query.mockResolvedValue([
    {
      providerId: "binance",
      indexable: true,
      available: true,
      job: { state: "running", runId: "run-1", filter: {}, phase: "fetching" },
    },
  ]);
  show();
  expect(
    await screen.findByRole("button", { name: "Retry indexed counts" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("0 listings indexed")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Binance"));
  expect(
    screen.getByRole("progressbar", { name: "Indexing Binance listings" }),
  ).not.toHaveAttribute("value");
  expect(screen.getByRole("button", { name: "Indexing…" })).toBeDisabled();
});

test("a collapsed provider still reports a failed index once and offers retry", async () => {
  rpc.feed.symbology.indexStatus.query.mockResolvedValue([
    {
      providerId: "binance",
      indexable: true,
      available: true,
      job: {
        state: "failed",
        runId: "run-1",
        filter: {},
        reason: { _tag: "Feed.SourceUnavailable", provider: "binance" },
      },
    },
  ]);
  show();
  const disclosure = await screen.findByRole("button", {
    name: /Binance.*Index failed/,
  });
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  const notification = await findErrorToast(
    "Binance is unavailable right now. The previous catalog was preserved.",
  );
  await act(() =>
    client.invalidateQueries({ queryKey: ["symbology", "indexStatus"] }),
  );
  expect(toast.getToasts()).toHaveLength(1);
  fireEvent.click(within(notification).getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(rpc.feed.symbology.index.mutate).toHaveBeenCalledWith(
      { providerId: "binance", filter: {} },
      expect.anything(),
    ),
  );
  await waitForElementToBeRemoved(notification);
});

test.each([
  ["subscribe", "Subscribe"],
  ["manage-subscription", "Manage subscription"],
])(
  "access requirement %s replaces the switch for any provider",
  async (action, label) => {
    rpc.providers.checkAccess.query.mockImplementation(
      async ({ providerId }) =>
        providerId === "binance"
          ? { status: "required", action }
          : { status: "granted" },
    );
    show();
    fireEvent.click(await screen.findByRole("button", { name: label }));
    expect(navigate).toHaveBeenCalledWith("/app/settings/subscription");
    expect(
      screen.queryByRole("switch", { name: "Enable Binance" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Enable OpenChart Cloud" }),
    ).toBeVisible();
    expect(updateConfig).not.toHaveBeenCalled();
  },
);

test("sign-in opens Clerk's modal, and signing in rechecks access", async () => {
  rpc.providers.checkAccess.query.mockImplementation(async ({ providerId }) =>
    providerId === "openchart"
      ? { status: "required", action: "sign-in" }
      : { status: "granted" },
  );
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  expect(clerk.openSignIn).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("switch", { name: "Enable OpenChart Cloud" }),
  ).not.toBeInTheDocument();

  rpc.access.auth.getState.query.mockResolvedValue({
    status: "signed-in",
    user: { id: "user_1" },
  });
  rpc.providers.checkAccess.query.mockResolvedValue({ status: "granted" });
  act(() => {
    for (const next of listeners)
      next({ kind: "event", event: { type: "integration.updated" } });
  });
  expect(
    await screen.findByRole("switch", { name: "Enable OpenChart Cloud" }),
  ).toBeChecked();
  expect(rpc.providers.refresh.mutate).not.toHaveBeenCalled();
  expect(updateConfig).not.toHaveBeenCalled();
});

test("access failures offer retry without inventing a subscription requirement", async () => {
  rpc.providers.checkAccess.query.mockImplementation(async ({ providerId }) => {
    if (providerId === "openchart") throw new Error("Cannot check access");
    return { status: "granted" };
  });
  show();
  const retry = await screen.findByRole("button", {
    name: "Retry OpenChart Cloud access",
  });
  expect(
    screen.queryByRole("button", { name: "Subscribe" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("switch", { name: "Enable OpenChart Cloud" }),
  ).not.toBeInTheDocument();
  rpc.providers.checkAccess.query.mockResolvedValue({ status: "granted" });
  fireEvent.click(retry);
  expect(
    await screen.findByRole("switch", { name: "Enable OpenChart Cloud" }),
  ).toBeChecked();
  expect(rpc.providers.refresh.mutate).toHaveBeenCalledOnce();
  expect(updateConfig).not.toHaveBeenCalled();
});

test("recovering access preserves a disabled provider preference", async () => {
  preference.openchart = false;
  rpc.providers.checkAccess.query.mockImplementation(async ({ providerId }) =>
    providerId === "openchart"
      ? { status: "required", action: "subscribe" }
      : { status: "granted" },
  );
  show();
  await screen.findByRole("button", { name: "Subscribe" });
  rpc.providers.checkAccess.query.mockResolvedValue({ status: "granted" });
  await act(() => client.invalidateQueries({ queryKey: ["provider-access"] }));
  expect(
    await screen.findByRole("switch", { name: "Enable OpenChart Cloud" }),
  ).not.toBeChecked();
  expect(updateConfig).not.toHaveBeenCalled();
});

test("a failed index offers Retry only when it can succeed", async () => {
  const failed = { state: "failed", runId: "run-1", filter: {} };
  rpc.feed.symbology.indexStatus.query.mockResolvedValue([
    {
      providerId: "binance",
      indexable: true,
      available: true,
      job: {
        ...failed,
        reason: { _tag: "Feed.AccessDenied", provider: "binance" },
      },
    },
    {
      providerId: "yfinance",
      indexable: true,
      available: true,
      job: failed,
    },
  ]);
  show();
  const denied = await findErrorToast(
    "Binance denied access. The previous catalog was preserved.",
  );
  expect(
    within(denied).queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  const internal = await findErrorToast(
    "Something went wrong while loading data. The previous catalog was preserved.",
  );
  expect(
    within(internal).getByRole("button", { name: "Retry" }),
  ).toBeInTheDocument();
});

test("TradingView account actions stay visible under the provider header without expanding", async () => {
  rpc.access.integration.listIntegrations.query.mockResolvedValue([
    {
      id: "tradingview",
      name: "TradingView",
      methods: [
        { id: "browser", type: "oauth", label: "Sign in with your browser" },
      ],
      credentialSources: [
        {
          type: "credential",
          id: "cred_1",
          label: "OpenChartHQ",
          active: true,
        },
      ],
    },
  ]);
  show();
  expect(
    await screen.findByRole("button", { name: "Disconnect" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /TradingView.*listings indexed/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Switch account" })).toBeVisible();
  expect(screen.getByText("Connected as OpenChartHQ")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Index" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Index listings for faster/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Full indexing is unavailable/),
  ).not.toBeInTheDocument();
});

test("enabling TradingView asks for an account choice and closing cancels the pending enable", async () => {
  preference.tradingview = false;
  show();
  const toggle = await screen.findByRole("switch", {
    name: "Enable TradingView",
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  expect(
    screen.getByRole("dialog", { name: "Connect your TradingView account" }),
  ).toBeVisible();
  expect(updateConfig).not.toHaveBeenCalled();
  expect(rpc.access.tradingview.start.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(toggle).not.toBeChecked();
  expect(updateConfig).not.toHaveBeenCalled();
});

test("continuing without sign-in enables TradingView only after the explicit choice", async () => {
  preference.tradingview = false;
  show();
  const toggle = await screen.findByRole("switch", {
    name: "Enable TradingView",
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  fireEvent.click(
    screen.getByRole("button", { name: "Continue without signing in" }),
  );
  expect(updateConfig).toHaveBeenCalledWith(
    { providers: { tradingview: { enabled: true } } },
    expect.objectContaining({ onSuccess: expect.any(Function) }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(rpc.access.tradingview.start.mutate).not.toHaveBeenCalled();
});

const tradingViewAccount = [
  {
    id: "tradingview",
    credentialSources: [
      { type: "credential", id: "cred_alice", label: "alice", active: true },
    ],
  },
];

test("enabling a previously connected account does not ask for sign-in again", async () => {
  preference.tradingview = false;
  rpc.access.integration.listIntegrations.query.mockResolvedValue(
    tradingViewAccount,
  );
  show();
  const toggle = await screen.findByRole("switch", {
    name: "Enable TradingView",
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  expect(updateConfig).toHaveBeenCalledWith({
    providers: { tradingview: { enabled: true } },
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(rpc.access.tradingview.start.mutate).not.toHaveBeenCalled();
});

test.each([false, true])(
  "standalone account connection preserves provider enabled=%s",
  async (enabled) => {
    preference.tradingview = enabled;
    show();
    const connect = await screen.findByRole("button", {
      name: "Connect your TradingView account",
    });
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    fireEvent.click(screen.getByRole("button", { name: "Connect account" }));
    fireEvent.change(await screen.findByLabelText("Login link"), {
      target: { value: "tradingview://browser-auth/?token=secret" },
    });
    rpc.access.integration.listIntegrations.query.mockResolvedValue(
      tradingViewAccount,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByRole("button", { name: "Switch account" });
    expect(updateConfig).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);

test("a failed anonymous enable retains the choice for retry or cancel", async () => {
  preference.tradingview = false;
  updateConfig.mockImplementationOnce(() => {});
  show();
  const toggle = await screen.findByRole("switch", {
    name: "Enable TradingView",
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  fireEvent.click(
    screen.getByRole("button", { name: "Continue without signing in" }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(toggle).not.toBeChecked();
  fireEvent.click(
    screen.getByRole("button", { name: "Continue without signing in" }),
  );
  expect(updateConfig).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("successful sign-in remains connected if the subsequent enable save fails", async () => {
  preference.tradingview = false;
  updateConfig.mockImplementationOnce(() => {});
  show();
  const toggle = await screen.findByRole("switch", {
    name: "Enable TradingView",
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Connect account" }));
  fireEvent.change(await screen.findByLabelText("Login link"), {
    target: { value: "tradingview://browser-auth/?token=secret" },
  });
  expect(updateConfig).not.toHaveBeenCalled();
  rpc.access.integration.listIntegrations.query.mockResolvedValue(
    tradingViewAccount,
  );
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByRole("button", { name: "Switch account" });
  expect(updateConfig).toHaveBeenCalledOnce();
  expect(toggle).not.toBeChecked();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Start again" }),
  ).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(updateConfig).toHaveBeenCalledTimes(2);
  expect(rpc.access.tradingview.complete.mutate).toHaveBeenCalledOnce();
});

test("failed or cancelled sign-in never enables the pending provider", async () => {
  preference.tradingview = false;
  rpc.access.tradingview.complete.mutate.mockRejectedValueOnce(
    new Error("TradingView sign-in failed"),
  );
  show();
  const toggle = await screen.findByRole("switch", {
    name: "Enable TradingView",
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Connect account" }));
  fireEvent.change(await screen.findByLabelText("Login link"), {
    target: { value: "tradingview://browser-auth/?token=secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await findErrorToast("TradingView sign-in failed");
  expect(updateConfig).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(toggle).not.toBeChecked();
  expect(toggle).toBeEnabled();
  expect(updateConfig).not.toHaveBeenCalled();
  expect(rpc.access.tradingview.cancel.mutate).toHaveBeenCalledOnce();
  expect(
    rpc.access.integration.connection.disconnect.mutate,
  ).not.toHaveBeenCalled();
});

test.each(["pending", "failed"] as const)(
  "TradingView can be enabled while account metadata is %s without assuming it is disconnected",
  async (state) => {
    preference.tradingview = false;
    if (state === "failed") {
      rpc.access.integration.listIntegrations.query.mockRejectedValue(
        new Error("Account metadata unavailable"),
      );
    } else {
      rpc.access.integration.listIntegrations.query.mockReturnValue(
        new Promise(() => {}),
      );
    }
    show();
    if (state === "failed") {
      expect(
        await screen.findByRole("button", {
          name: "Retry TradingView connection",
        }),
      ).toBeVisible();
    } else {
      expect(screen.getByText("Checking connection…")).toBeVisible();
    }
    const toggle = await screen.findByRole("switch", {
      name: "Enable TradingView",
    });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(updateConfig).toHaveBeenCalledWith({
      providers: { tradingview: { enabled: true } },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rpc.access.tradingview.start.mutate).not.toHaveBeenCalled();
    expect(
      rpc.access.integration.connection.disconnect.mutate,
    ).not.toHaveBeenCalled();
    if (state === "failed") {
      fireEvent.click(
        screen.getByRole("button", { name: "Retry TradingView connection" }),
      );
      await waitFor(() =>
        expect(
          rpc.access.integration.listIntegrations.query,
        ).toHaveBeenCalledTimes(2),
      );
    }
  },
);

test("failed Config reads retain the logo credit and settings retry", async () => {
  preference.configAvailable = false;
  preference.readError = new Error("Settings unavailable");
  show();
  expect(screen.getByRole("link", { name: "Elbstream" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Elbstream" })).toHaveAttribute(
    "href",
    "https://elbstream.com",
  );
  expect(
    screen.queryByRole("switch", { name: "Enable TradingView" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }),
  );
  expect(refreshConfig).toHaveBeenCalledOnce();
  expect(updateConfig).not.toHaveBeenCalled();
});
