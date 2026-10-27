// Purpose: Verify browser sign-in, transient login links, cancellation, and honest account state.
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TradingViewAccount } from "@openchart/app/app/routes/settings/tradingview-account";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  findErrorToast,
  renderWithToaster as render,
} from "@openchart/app/testing/test-utils";

const rpc = {
  providers: { refresh: { mutate: vi.fn() } },
  access: {
    integration: {
      listIntegrations: { query: vi.fn() },
      connection: {
        setApiKey: { mutate: vi.fn() },
        disconnect: { mutate: vi.fn() },
      },
    },
    tradingview: {
      start: { mutate: vi.fn() },
      complete: { mutate: vi.fn() },
      cancel: { mutate: vi.fn() },
    },
  },
};
const transport = { rpc } as unknown as AppTransport;
const attempt = {
  attemptID: "attempt-1",
  url: "https://auth.tradingview.com/accounts/tvd/connect/?key=public-hash",
  instructions:
    "At the bottom of TradingView’s page, click “copy the secret key” to copy your login link.",
  mode: "code",
  time: { created: 100, expires: 200 },
};
const loginLink = "tradingview://browser-auth/?token=one-time-secret";
const connected = [
  {
    id: "tradingview",
    credentialSources: [
      { type: "credential", id: "cred_alice", label: "alice", active: true },
    ],
  },
];
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = createQueryClient();
  rpc.providers.refresh.mutate.mockResolvedValue(undefined);
  rpc.access.integration.listIntegrations.query.mockResolvedValue([]);
  rpc.access.integration.connection.disconnect.mutate.mockResolvedValue(
    undefined,
  );
  rpc.access.tradingview.start.mutate.mockResolvedValue(attempt);
  rpc.access.tradingview.complete.mutate.mockResolvedValue({
    status: "complete",
  });
  rpc.access.tradingview.cancel.mutate.mockResolvedValue(undefined);
  vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function show() {
  return render(
    <QueryClientProvider client={client}>
      <TradingViewAccount transport={transport} />
    </QueryClientProvider>,
  );
}
async function start() {
  const button = await screen.findByRole("button", { name: "Connect account" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  return screen.findByRole("dialog", { name: "Connect TradingView" });
}
function paste(value: string = loginLink) {
  fireEvent.change(screen.getByLabelText("Login link"), {
    target: { value },
  });
}
function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
}

test("opens normal browser sign-in and allows reopening the same challenge", async () => {
  show();
  const dialog = await start();
  expect(window.open).toHaveBeenCalledWith(
    attempt.url,
    "_blank",
    "noopener,noreferrer",
  );
  expect(within(dialog).getByText(attempt.instructions)).toBeVisible();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Return to browser" }),
  );
  expect(window.open).toHaveBeenCalledTimes(2);
  expect(rpc.access.tradingview.start.mutate).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Login link")).toHaveAttribute(
    "type",
    "password",
  );
});

test("exchanges the pasted link without passing cookies or caching the secret", async () => {
  const view = show();
  await start();
  paste(`  ${loginLink}  `);
  rpc.access.integration.listIntegrations.query.mockResolvedValue(connected);
  submit();
  await waitFor(() =>
    expect(rpc.access.tradingview.complete.mutate).toHaveBeenCalledWith({
      attemptID: attempt.attemptID,
      link: loginLink,
    }),
  );
  expect(
    await screen.findByRole("button", { name: "Reconnect" }),
  ).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(rpc.providers.refresh.mutate).toHaveBeenCalledOnce();
  expect(
    rpc.access.integration.connection.setApiKey.mutate,
  ).not.toHaveBeenCalled();
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain("one-time-secret");
  expect(
    JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state),
    ),
  ).not.toContain("one-time-secret");
  view.unmount();
  expect(rpc.access.tradingview.cancel.mutate).not.toHaveBeenCalled();
});

test("closing cancels the attempt and a new attempt has an empty draft", async () => {
  show();
  await start();
  paste();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(rpc.access.tradingview.cancel.mutate).toHaveBeenCalledWith({
    attemptID: attempt.attemptID,
  });
  await start();
  expect(screen.getByLabelText("Login link")).toHaveValue("");
  expect(rpc.access.tradingview.complete.mutate).not.toHaveBeenCalled();
});

test("failed cancellation preserves the draft and can be retried", async () => {
  rpc.access.tradingview.cancel.mutate.mockRejectedValueOnce(
    new Error("Cancellation unavailable"),
  );
  show();
  await start();
  paste();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await findErrorToast("Cancellation unavailable");
  expect(screen.getByLabelText("Login link")).toHaveValue(loginLink);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(rpc.access.tradingview.cancel.mutate).toHaveBeenCalledTimes(2);
});

test.each([
  "",
  "https://www.tradingview.com/",
  "tradingview://browser-auth/?token=",
  "tradingview://browser-auth/?token=secret&token=other",
  "tradingview://browser-auth/?token=secret&redirect=https://other.example",
  "tradingview://user@browser-auth/?token=secret",
])(
  "rejects a link with invalid shape before sending it (%s)",
  async (invalid) => {
    show();
    await start();
    paste(invalid);
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent("Paste the login link");
    expect(screen.getByLabelText("Login link")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(rpc.access.tradingview.complete.mutate).not.toHaveBeenCalled();
    paste();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
);

test("a failed completion keeps the draft and requires a fresh attempt before submitting again", async () => {
  rpc.access.tradingview.complete.mutate.mockRejectedValueOnce(
    new Error("TradingView is unavailable"),
  );
  show();
  await start();
  paste();
  submit();
  await findErrorToast("TradingView is unavailable");
  expect(screen.getByLabelText("Login link")).toHaveValue(loginLink);
  expect(screen.getByLabelText("Login link")).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Connect" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Return to browser" }),
  ).not.toBeInTheDocument();
  expect(rpc.providers.refresh.mutate).not.toHaveBeenCalled();
  expect(rpc.access.tradingview.complete.mutate).toHaveBeenCalledOnce();

  rpc.access.tradingview.start.mutate.mockResolvedValueOnce({
    ...attempt,
    attemptID: "attempt-2",
    url: "https://auth.tradingview.com/accounts/tvd/connect/?key=new-public-hash",
  });
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Login link")).toHaveValue(""),
  );
  expect(rpc.access.tradingview.cancel.mutate).toHaveBeenCalledWith({
    attemptID: attempt.attemptID,
  });
  const freshLink = "tradingview://browser-auth/?token=fresh-secret";
  paste(freshLink);
  submit();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(rpc.access.tradingview.complete.mutate).toHaveBeenCalledTimes(2);
  expect(rpc.access.tradingview.complete.mutate).toHaveBeenLastCalledWith({
    attemptID: "attempt-2",
    link: freshLink,
  });
});

const nextAttempt = {
  ...attempt,
  attemptID: "attempt-2",
  url: "https://auth.tradingview.com/accounts/tvd/connect/?key=new-public-hash",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function failCompletion() {
  rpc.access.tradingview.complete.mutate.mockRejectedValueOnce(
    new Error("The login link has expired"),
  );
  show();
  const dialog = await start();
  paste();
  submit();
  await findErrorToast("The login link has expired");
  return dialog;
}

test("starting again keeps the failed dialog until cancellation and a slow replacement finish", async () => {
  const dialog = await failCompletion();
  const cancellation = deferred<undefined>();
  const replacement = deferred<typeof nextAttempt>();
  rpc.access.tradingview.cancel.mutate.mockReturnValueOnce(
    cancellation.promise,
  );
  rpc.access.tradingview.start.mutate.mockReturnValueOnce(replacement.promise);
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  await waitFor(() =>
    expect(rpc.access.tradingview.cancel.mutate).toHaveBeenCalledWith({
      attemptID: attempt.attemptID,
    }),
  );
  expect(rpc.access.tradingview.start.mutate).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Start again" })).toBeDisabled();

  await act(async () => cancellation.resolve(undefined));
  await waitFor(() =>
    expect(rpc.access.tradingview.start.mutate).toHaveBeenCalledTimes(2),
  );
  // The same dialog and draft stay visible while the replacement opens.
  expect(dialog).toBeInTheDocument();
  expect(screen.getByLabelText("Login link")).toHaveValue(loginLink);
  expect(
    screen.getByRole("button", { name: "Opening browser…" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(window.open).toHaveBeenCalledOnce();

  await act(async () => replacement.resolve(nextAttempt));
  await waitFor(() =>
    expect(window.open).toHaveBeenLastCalledWith(
      nextAttempt.url,
      "_blank",
      "noopener,noreferrer",
    ),
  );
  expect(dialog).toBeInTheDocument();
  expect(screen.getByLabelText("Login link")).toHaveValue("");
  expect(screen.getByLabelText("Login link")).toBeEnabled();
  expect(rpc.access.tradingview.cancel.mutate).toHaveBeenCalledOnce();
  expect(rpc.access.tradingview.complete.mutate).toHaveBeenCalledOnce();
});

test("a failed cancellation never opens a replacement while the old attempt may still run", async () => {
  await failCompletion();
  rpc.access.tradingview.cancel.mutate.mockRejectedValueOnce(
    new Error("Cancellation unavailable"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  await findErrorToast("Cancellation unavailable");
  expect(rpc.access.tradingview.start.mutate).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Login link")).toHaveValue(loginLink);
  rpc.access.tradingview.start.mutate.mockResolvedValueOnce(nextAttempt);
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Login link")).toHaveValue(""),
  );
  expect(rpc.access.tradingview.cancel.mutate).toHaveBeenCalledTimes(2);
  expect(window.open).toHaveBeenLastCalledWith(
    nextAttempt.url,
    "_blank",
    "noopener,noreferrer",
  );
});

test("a failed replacement start keeps the dialog recoverable", async () => {
  await failCompletion();
  rpc.access.tradingview.start.mutate.mockRejectedValueOnce(
    new Error("Backend unavailable"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  await findErrorToast("Backend unavailable");
  expect(screen.getByLabelText("Login link")).toHaveValue(loginLink);
  expect(screen.getByRole("button", { name: "Start again" })).toBeEnabled();
  rpc.access.tradingview.start.mutate.mockResolvedValueOnce(nextAttempt);
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Login link")).toHaveValue(""),
  );
  expect(rpc.access.tradingview.cancel.mutate).toHaveBeenCalledTimes(2);
  paste("tradingview://browser-auth/?token=fresh-secret");
  submit();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(rpc.access.tradingview.complete.mutate).toHaveBeenLastCalledWith({
    attemptID: nextAttempt.attemptID,
    link: "tradingview://browser-auth/?token=fresh-secret",
  });
});

test("unmounting cancels an active browser attempt", async () => {
  const view = show();
  await start();
  view.unmount();
  await waitFor(() =>
    expect(rpc.access.tradingview.cancel.mutate).toHaveBeenCalledWith({
      attemptID: attempt.attemptID,
    }),
  );
});

test("a start that finishes after unmount is cancelled without opening a browser", async () => {
  let resolve!: (result: typeof attempt) => void;
  rpc.access.tradingview.start.mutate.mockImplementationOnce(
    () =>
      new Promise<typeof attempt>((done) => {
        resolve = done;
      }),
  );
  const view = show();
  const button = await screen.findByRole("button", { name: "Connect account" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() =>
    expect(rpc.access.tradingview.start.mutate).toHaveBeenCalledOnce(),
  );
  view.unmount();
  await act(async () => {
    resolve(attempt);
  });
  await waitFor(() =>
    expect(rpc.access.tradingview.cancel.mutate).toHaveBeenCalledWith({
      attemptID: attempt.attemptID,
    }),
  );
  expect(window.open).not.toHaveBeenCalled();
});

test("a failed account read stays unknown and offers retry", async () => {
  rpc.access.integration.listIntegrations.query.mockRejectedValueOnce(
    new Error("Connection read unavailable"),
  );
  show();
  const retry = await screen.findByRole("button", {
    name: "Retry TradingView connection",
  });
  expect(screen.getByText("Connection status is unavailable.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Connect account" }),
  ).not.toBeInTheDocument();
  rpc.access.integration.listIntegrations.query.mockResolvedValue(connected);
  fireEvent.click(retry);
  expect(
    await screen.findByRole("button", { name: "Reconnect" }),
  ).toBeVisible();
  expect(rpc.access.tradingview.start.mutate).not.toHaveBeenCalled();
});

test("disconnect clears the server account and refreshes provider access", async () => {
  rpc.access.integration.listIntegrations.query.mockResolvedValue(connected);
  show();
  const button = await screen.findByRole("button", { name: "Disconnect" });
  rpc.access.integration.listIntegrations.query.mockResolvedValue([]);
  fireEvent.click(button);
  await waitFor(() =>
    expect(
      rpc.access.integration.connection.disconnect.mutate,
    ).toHaveBeenCalledWith({ integrationID: "tradingview" }),
  );
  expect(
    await screen.findByRole("button", { name: "Connect account" }),
  ).toBeEnabled();
  expect(rpc.providers.refresh.mutate).toHaveBeenCalledOnce();
  expect(
    rpc.access.integration.connection.setApiKey.mutate,
  ).not.toHaveBeenCalled();
});
