// Purpose: Verify Clerk sessions connect the local account in the background, Profile opens Clerk's sign-in modal, and sign-out ends Clerk first.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { AccountConnectionProvider } from "@openchart/app/features/account/account-connection";
import { AccountProfile } from "@openchart/app/features/account/account-profile";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { renderWithToaster } from "@openchart/app/testing/test-utils";

const user = {
  id: "user_1",
  fullName: "Test User",
  firstName: "Test",
  lastName: "User",
  primaryEmailAddress: { emailAddress: "test@example.com" },
};

const clerk = vi.hoisted(() => {
  const state = {
    user: null as null | { id: string },
    session: null as null | { id: string },
    calls: [] as string[],
    openSignIn: vi.fn(),
    signOut: vi.fn(async () => {
      state.calls.push("clerk.signOut");
      state.user = null;
      state.session = null;
    }),
    apiKeys: {
      create: vi.fn(async () => ({ id: "new-key", secret: "secret" })),
      getAll: vi.fn(),
    },
  };
  return state;
});
vi.mock("@clerk/react", () => ({
  useClerk: () => clerk,
  useUser: () => ({ isLoaded: true, user: clerk.user }),
  useSession: () => ({ session: clerk.session }),
  UserAvatar: () => null,
}));

type LocalState =
  { status: "signed-out" } | { status: "signed-in"; user: { id: string } };

function fixture(initial: LocalState = { status: "signed-out" }) {
  let local = initial;
  const auth = {
    getState: { query: vi.fn(async () => local) },
    getSavedKey: { query: vi.fn(async () => null) },
    completeSignIn: {
      mutate: vi.fn(async () => {
        local = { status: "signed-in", user: { id: user.id } };
      }),
    },
    restoreSignIn: { mutate: vi.fn(async () => {}) },
    logout: {
      mutate: vi.fn(async () => {
        clerk.calls.push("auth.logout");
        local = { status: "signed-out" };
      }),
    },
  };
  const transport = {
    rpc: { access: { auth } },
    events: { subscribe: () => ({ unsubscribe: () => {} }) },
  } as unknown as AppTransport;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Shell() {
    return (
      <QueryClientProvider client={queryClient}>
        <AccountConnectionProvider transport={transport}>
          <AccountProfile transport={transport} />
        </AccountConnectionProvider>
      </QueryClientProvider>
    );
  }
  return { auth, Shell };
}

function signInToClerk(sessionID = "session_1") {
  clerk.user = user;
  clerk.session = { id: sessionID };
}

afterEach(() => {
  clerk.user = null;
  clerk.session = null;
  clerk.calls = [];
  vi.clearAllMocks();
});

test("signed-out Profile opens Clerk's sign-in modal without a handoff", async () => {
  const { auth, Shell } = fixture();
  render(<Shell />);

  await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  expect(clerk.openSignIn).toHaveBeenCalledOnce();
  expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();
});

test("a new Clerk session connects the local account in the background", async () => {
  const { auth, Shell } = fixture();
  const view = render(<Shell />);
  await screen.findByRole("button", { name: "Sign in" });

  signInToClerk();
  view.rerender(<Shell />);

  expect(await screen.findByText("Test User")).toBeInTheDocument();
  await waitFor(() =>
    expect(auth.completeSignIn.mutate).toHaveBeenCalledOnce(),
  );
  expect(clerk.apiKeys.create).toHaveBeenCalledOnce();
});

test("a retained session with a matching local account connects without issuing a key", async () => {
  signInToClerk();
  const { auth, Shell } = fixture({
    status: "signed-in",
    user: { id: user.id },
  });
  render(<Shell />);

  expect(await screen.findByText("Test User")).toBeInTheDocument();
  // The session handoff reads local state without a query signal.
  await waitFor(() => expect(auth.getState.query).toHaveBeenCalledWith());
  expect(clerk.apiKeys.create).not.toHaveBeenCalled();
  expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();
});

test("sign-out ends the Clerk session before disabling local access", async () => {
  signInToClerk();
  const { auth, Shell } = fixture({
    status: "signed-in",
    user: { id: user.id },
  });
  render(<Shell />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Sign out of OpenChart" }),
  );
  expect(
    await screen.findByRole("button", { name: "Sign in" }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(clerk.calls).toEqual(["clerk.signOut", "auth.logout"]),
  );
  expect(auth.restoreSignIn.mutate).not.toHaveBeenCalled();
  expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();
});

test("a failed Clerk sign-out keeps local access", async () => {
  signInToClerk();
  const { auth, Shell } = fixture({
    status: "signed-in",
    user: { id: user.id },
  });
  clerk.signOut.mockRejectedValueOnce(new Error("offline"));
  render(<Shell />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Sign out of OpenChart" }),
  );
  expect(await screen.findByText("Test User")).toBeInTheDocument();
  expect(auth.logout.mutate).not.toHaveBeenCalled();
});

test("another user's local account is refused until sign-out", async () => {
  signInToClerk();
  const { auth, Shell } = fixture({
    status: "signed-in",
    user: { id: "user_other" },
  });
  renderWithToaster(<Shell />);

  expect(
    await screen.findByText(
      "OpenChart is signed in to another account on this computer",
    ),
  ).toBeInTheDocument();
  expect(
    await screen.findByText("Sign out before connecting a different account."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Test User")).not.toBeInTheDocument();
  expect(clerk.apiKeys.create).not.toHaveBeenCalled();

  await userEvent.click(
    screen.getByRole("button", { name: "Sign out of OpenChart" }),
  );
  expect(
    await screen.findByRole("button", { name: "Sign in" }),
  ).toBeInTheDocument();
  expect(auth.logout.mutate).toHaveBeenCalledOnce();
});

test("an ended Clerk session stops its pending handoff", async () => {
  let resolveKey!: (key: { id: string; secret: string }) => void;
  clerk.apiKeys.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveKey = resolve;
      }),
  );
  const { auth, Shell } = fixture();
  const view = render(<Shell />);
  await screen.findByRole("button", { name: "Sign in" });
  signInToClerk();
  view.rerender(<Shell />);
  await waitFor(() => expect(clerk.apiKeys.create).toHaveBeenCalledOnce());

  clerk.user = null;
  clerk.session = null;
  view.rerender(<Shell />);
  expect(
    await screen.findByRole("button", { name: "Sign in" }),
  ).toBeInTheDocument();
  await act(async () => resolveKey({ id: "late-key", secret: "late-secret" }));
  expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();
});

test("a late result from an old Clerk session cannot cancel the new handoff", async () => {
  let resolveOld!: (key: { id: string; secret: string }) => void;
  let resolveCurrent!: (key: { id: string; secret: string }) => void;
  clerk.apiKeys.create
    .mockImplementationOnce(
      () => new Promise((resolve) => (resolveOld = resolve)),
    )
    .mockImplementationOnce(
      () => new Promise((resolve) => (resolveCurrent = resolve)),
    );
  const { auth, Shell } = fixture();
  const view = render(<Shell />);
  await screen.findByRole("button", { name: "Sign in" });

  signInToClerk("old-session");
  view.rerender(<Shell />);
  await waitFor(() => expect(clerk.apiKeys.create).toHaveBeenCalledTimes(1));

  signInToClerk("current-session");
  view.rerender(<Shell />);
  await waitFor(() => expect(clerk.apiKeys.create).toHaveBeenCalledTimes(2));
  await act(async () => resolveOld({ id: "old-key", secret: "old-secret" }));
  expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();

  await act(async () =>
    resolveCurrent({ id: "current-key", secret: "current-secret" }),
  );
  await waitFor(() =>
    expect(auth.completeSignIn.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKeyID: "current-key" }),
    ),
  );
});

test("a failed key handoff offers Retry", async () => {
  clerk.apiKeys.create.mockRejectedValueOnce(new Error("Clerk unavailable"));
  signInToClerk();
  const { auth, Shell } = fixture();
  renderWithToaster(<Shell />);

  expect(
    await screen.findByText("Couldn’t finish signing in"),
  ).toBeInTheDocument();
  expect(screen.getByText("Test User")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(auth.completeSignIn.mutate).toHaveBeenCalledOnce(),
  );
});
