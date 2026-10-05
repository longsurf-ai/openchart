// Purpose: Verify the workspace opens for a Clerk session unless another user's local account is present, connects Cloud access in the background, and sign-out closes it.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import {
  AccountConnectionProvider,
  useAccountConnection,
} from "@openchart/app/features/account/account-connection";
import { useSession, useUser } from "@clerk/react";
import { AccountGate } from "@openchart/app/features/account/account-gate";
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
  SignIn: () => <p>Clerk sign in</p>,
}));

type LocalState =
  { status: "signed-out" } | { status: "signed-in"; user: { id: string } };

function fixture(
  initial: LocalState = { status: "signed-out" },
  backdrop: ReactNode = <p>Workspace outline</p>,
) {
  let local = initial;
  const listeners = new Set<(frame: unknown) => void>();
  const auth = {
    getState: {
      query: vi.fn<(...args: unknown[]) => Promise<LocalState>>(
        async () => local,
      ),
    },
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
    events: {
      subscribe: ({ next }: { next: (frame: unknown) => void }) => {
        listeners.add(next);
        return { unsubscribe: () => listeners.delete(next) };
      },
    },
  } as unknown as AppTransport;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const mounts = vi.fn();
  function Workspace() {
    const { user } = useUser();
    const { session } = useSession();
    const { logout } = useAccountConnection();
    useEffect(() => mounts(), []);
    return (
      <>
        <p>Workspace for {`${user?.id}:${session?.id}`}</p>
        <button onClick={() => logout.mutate()}>Workspace sign out</button>
      </>
    );
  }
  function Shell() {
    return (
      <QueryClientProvider client={queryClient}>
        <AccountConnectionProvider transport={transport}>
          <AccountGate transport={transport} backdrop={backdrop}>
            <Workspace />
          </AccountGate>
        </AccountConnectionProvider>
      </QueryClientProvider>
    );
  }
  function publish(type: string) {
    act(() => {
      for (const next of listeners) next({ kind: "event", event: { type } });
    });
  }
  return { auth, Shell, mounts, publish };
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

test("signed-out users see Clerk sign-in instead of the workspace", async () => {
  const { auth, Shell } = fixture();
  render(<Shell />);

  expect(await screen.findByText("Clerk sign in")).toBeInTheDocument();
  expect(screen.getByText("Workspace outline")).toBeInTheDocument();
  expect(screen.queryByText(/Workspace for/)).not.toBeInTheDocument();
  expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();
});

test("a failing backdrop never blocks sign-in", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function Broken(): ReactNode {
    throw new Error("backdrop failed");
  }
  const { Shell } = fixture(undefined, <Broken />);
  render(<Shell />);

  expect(await screen.findByText("Clerk sign in")).toBeInTheDocument();
});

test("a new Clerk session connects the local account, then opens the workspace", async () => {
  const { auth, Shell } = fixture();
  const view = render(<Shell />);
  await screen.findByText("Clerk sign in");

  signInToClerk();
  view.rerender(<Shell />);

  expect(
    await screen.findByText("Workspace for user_1:session_1"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Workspace outline")).not.toBeInTheDocument();
  expect(clerk.apiKeys.create).toHaveBeenCalledOnce();
  expect(auth.completeSignIn.mutate).toHaveBeenCalledOnce();
});

test("a retained session with a matching local account opens without issuing a key", async () => {
  signInToClerk();
  const { auth, Shell } = fixture({
    status: "signed-in",
    user: { id: user.id },
  });
  render(<Shell />);

  expect(
    await screen.findByText("Workspace for user_1:session_1"),
  ).toBeInTheDocument();
  // The session handoff reads local state without a query signal.
  await waitFor(() => expect(auth.getState.query).toHaveBeenCalledWith());
  expect(clerk.apiKeys.create).not.toHaveBeenCalled();
  expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();
});

test("account refreshes keep the workspace mounted", async () => {
  signInToClerk();
  const { auth, Shell, mounts, publish } = fixture({
    status: "signed-in",
    user: { id: user.id },
  });
  render(<Shell />);
  await screen.findByText("Workspace for user_1:session_1");

  let resolve!: (state: LocalState) => void;
  auth.getState.query.mockImplementationOnce(
    () => new Promise((done) => (resolve = done)),
  );
  publish("integration.updated");
  await waitFor(() => expect(resolve).toBeDefined());
  expect(screen.getByText("Workspace for user_1:session_1")).toBeVisible();

  await act(async () =>
    resolve({ status: "signed-in", user: { id: user.id } }),
  );
  expect(screen.getByText("Workspace for user_1:session_1")).toBeVisible();
  expect(mounts).toHaveBeenCalledOnce();
});

test("a new Clerk session rebuilds the workspace", async () => {
  signInToClerk();
  const { Shell, mounts } = fixture({
    status: "signed-in",
    user: { id: user.id },
  });
  const view = render(<Shell />);
  await screen.findByText("Workspace for user_1:session_1");

  signInToClerk("session_2");
  view.rerender(<Shell />);

  expect(
    await screen.findByText("Workspace for user_1:session_2"),
  ).toBeInTheDocument();
  expect(mounts).toHaveBeenCalledTimes(2);
});

test("an unreadable account offers retry instead of sign-in", async () => {
  signInToClerk();
  const { auth, Shell } = fixture({
    status: "signed-in",
    user: { id: user.id },
  });
  // Only the gate's account query fails; the session handoff still reads state.
  let failing = true;
  auth.getState.query.mockImplementation(async (...args) => {
    if (failing && args.length > 1) throw new Error("storage unavailable");
    return { status: "signed-in", user: { id: user.id } };
  });
  render(<Shell />);

  const retry = await screen.findByRole("button", { name: "Retry" });
  failing = false;
  await userEvent.click(retry);
  expect(screen.queryByText("Clerk sign in")).not.toBeInTheDocument();
  expect(
    await screen.findByText("Workspace for user_1:session_1"),
  ).toBeInTheDocument();
});

test("sign-out ends the Clerk session before disabling local access", async () => {
  signInToClerk();
  const { auth, Shell } = fixture({
    status: "signed-in",
    user: { id: user.id },
  });
  render(<Shell />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Workspace sign out" }),
  );
  expect(await screen.findByText("Clerk sign in")).toBeInTheDocument();
  expect(clerk.calls).toEqual(["clerk.signOut", "auth.logout"]);
  expect(auth.restoreSignIn.mutate).not.toHaveBeenCalled();
  expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();
});

test("a failed Clerk sign-out keeps local access and the workspace", async () => {
  signInToClerk();
  const { auth, Shell } = fixture({
    status: "signed-in",
    user: { id: user.id },
  });
  clerk.signOut.mockRejectedValueOnce(new Error("offline"));
  render(<Shell />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Workspace sign out" }),
  );
  expect(
    await screen.findByText("Workspace for user_1:session_1"),
  ).toBeInTheDocument();
  expect(auth.logout.mutate).not.toHaveBeenCalled();
});

test("a different local account stays gated until sign-out", async () => {
  signInToClerk();
  const { auth, Shell } = fixture({
    status: "signed-in",
    user: { id: "user_other" },
  });
  render(<Shell />);

  expect(
    await screen.findByText(
      "OpenChart is signed in to another account on this computer",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Workspace for/)).not.toBeInTheDocument();
  expect(clerk.apiKeys.create).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByText("Clerk sign in")).toBeInTheDocument();
  expect(auth.logout.mutate).toHaveBeenCalledOnce();
});

test("the workspace opens while the key handoff runs, and an ended Clerk session stops it", async () => {
  let resolveKey!: (key: { id: string; secret: string }) => void;
  clerk.apiKeys.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveKey = resolve;
      }),
  );
  const { auth, Shell } = fixture();
  const view = render(<Shell />);
  await screen.findByText("Clerk sign in");
  signInToClerk();
  view.rerender(<Shell />);
  await waitFor(() => expect(clerk.apiKeys.create).toHaveBeenCalledOnce());

  expect(
    screen.getByText("Workspace for user_1:session_1"),
  ).toBeInTheDocument();
  expect(auth.completeSignIn.mutate).not.toHaveBeenCalled();

  clerk.user = null;
  clerk.session = null;
  view.rerender(<Shell />);
  expect(await screen.findByText("Clerk sign in")).toBeInTheDocument();
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
  await screen.findByText("Clerk sign in");

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
  expect(
    await screen.findByText("Workspace for user_1:current-session"),
  ).toBeInTheDocument();
  expect(auth.completeSignIn.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ apiKeyID: "current-key" }),
  );
});

test("a failed key handoff keeps the workspace open and offers Retry", async () => {
  clerk.apiKeys.create.mockRejectedValueOnce(new Error("Clerk unavailable"));
  signInToClerk();
  const { auth, Shell } = fixture();
  renderWithToaster(<Shell />);

  expect(
    await screen.findByText("Workspace for user_1:session_1"),
  ).toBeInTheDocument();
  expect(
    await screen.findByText("Couldn’t finish signing in"),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(auth.completeSignIn.mutate).toHaveBeenCalledOnce(),
  );
  expect(
    screen.getByText("Workspace for user_1:session_1"),
  ).toBeInTheDocument();
});
