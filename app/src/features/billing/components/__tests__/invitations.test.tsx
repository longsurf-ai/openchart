// Purpose: Verify lifetime invitation issuance, copying and redemption stay scoped to the signed-in account.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { Invitations } from "@openchart/app/features/billing/components/invitations";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const clerk = vi.hoisted(() => ({ userId: "user_1" }));
vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { id: clerk.userId } }),
}));
afterEach(() => {
  clerk.userId = "user_1";
});

const friendCode = "ABCDEF";
const codes = [1, 2, 3].map((number) => ({
  code: String(number).repeat(6),
  redeemed: false,
}));
type Referrals = {
  canInvite: boolean;
  codes: typeof codes;
  redeemedCode: string | null;
};
const empty: Referrals = { canInvite: false, codes: [], redeemedCode: null };
const granted = {
  canAccess: true,
  complimentaryAccessUntil: "2099-11-03T12:00:00.000Z",
};

function fixture(
  initial: Referrals = empty,
  options: { issueError?: boolean; readError?: boolean } = {},
) {
  let value = initial;
  const getReferrals = vi.fn(async () => {
    if (options.readError) throw new Error("Offline");
    return value;
  });
  const issueReferrals = vi.fn(async () => {
    if (options.issueError) throw new Error("Offline");
    value = { ...value, codes };
    return value;
  });
  const redeemReferral = vi.fn(async (input: { code: string }) => {
    value = { ...value, redeemedCode: input.code };
    return granted;
  });
  const getAccess = vi.fn(async () => granted);
  const transport = {
    rpc: {
      access: {
        billing: {
          getReferrals: { query: getReferrals },
          issueReferrals: { mutate: issueReferrals },
          redeemReferral: { mutate: redeemReferral },
          getAccess: { query: getAccess },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["billing", "user_1"], { status: "none" });
  const onAccessChange = vi.fn();
  const tree = (
    <StrictMode>
      <QueryClientProvider client={client}>
        <Invitations transport={transport} onAccessChange={onAccessChange} />
      </QueryClientProvider>
    </StrictMode>
  );
  const view = render(tree);
  return {
    ...view,
    client,
    getReferrals,
    getAccess,
    issueReferrals,
    redeemReferral,
    onAccessChange,
    remount: () => {
      view.unmount();
      return render(tree);
    },
  };
}

test("a subscriber gets three lifetime tickets, issued once even in Strict Mode", async () => {
  const app = fixture({ ...empty, canInvite: true });
  const list = await screen.findByRole("list", {
    name: "Your invitation codes",
  });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(app.issueReferrals).toHaveBeenCalledOnce();
  expect(screen.getByText("3 of 3 left")).toBeVisible();
  app.remount();
  await waitFor(() => expect(app.client.isFetching()).toBe(0));
  expect(app.issueReferrals).toHaveBeenCalledOnce();
});

test("copy sends the complete code and redeemed tickets cannot be shared", async () => {
  const user = userEvent.setup();
  const clipboard = vi.spyOn(navigator.clipboard, "writeText");
  fixture({
    ...empty,
    codes: codes.map((code, index) => ({ ...code, redeemed: index === 1 })),
  });
  await user.click(
    await screen.findByRole("button", { name: "Copy invite 1" }),
  );
  expect(clipboard).toHaveBeenCalledWith(codes[0]?.code);
  expect(
    await screen.findByRole("button", { name: "Copied invite 1" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Invite 2 redeemed" }),
  ).toBeDisabled();
  expect(screen.getByText("2 of 3 left")).toBeVisible();
});

test("an unsubscribed account can redeem and refresh access without acquiring a plan", async () => {
  const app = fixture();
  await waitFor(() => expect(app.client.isFetching()).toBe(0));
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  expect(app.issueReferrals).not.toHaveBeenCalled();
  const input = screen.getByRole("textbox", { name: "Invitation code" });
  const submit = screen.getByRole("button", { name: "Redeem code" });
  expect(submit).toBeDisabled();
  await userEvent.type(input, `  ${friendCode.toLowerCase()}  `);
  await userEvent.click(submit);
  expect(
    await screen.findByText(
      "Invite redeemed. You both received 30 extra days.",
    ),
  ).toBeVisible();
  expect(app.redeemReferral).toHaveBeenCalledExactlyOnceWith({
    code: friendCode,
  });
  expect(app.onAccessChange).toHaveBeenCalledOnce();
  expect(app.client.getQueryData(["billing", "user_1", "access"])).toEqual(
    granted,
  );
  expect(app.client.getQueryData(["billing", "user_1"])).toEqual({
    status: "none",
  });
  expect(screen.getByText(/Free Cloud access until/)).toBeVisible();
});

test("subscribers can also redeem, while accounts that already redeemed see that state", async () => {
  const app = fixture({
    canInvite: true,
    codes,
    redeemedCode: "ABC123",
  });
  expect(
    await screen.findByText("You’ve already redeemed an invite."),
  ).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(app.redeemReferral).not.toHaveBeenCalled();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});

test.each(["A1B2C3", "  a1b2c3  "])(
  "an account cannot submit its own invitation %j and can correct it to a friend's code",
  async (code) => {
    const user = userEvent.setup();
    const app = fixture({
      ...empty,
      codes: [{ code: "A1B2C3", redeemed: false }],
    });
    await screen.findByRole("list", { name: "Your invitation codes" });
    const input = screen.getByRole("textbox", { name: "Invitation code" });
    const submit = screen.getByRole("button", { name: "Redeem code" });
    await user.type(input, code);
    expect(submit).toBeDisabled();
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription(
      "You cannot redeem your own invitation code.",
    );
    expect(screen.getByRole("alert")).toBeVisible();
    await user.click(submit);
    await user.keyboard("{Enter}");
    // A disabled button must not be the only protection against form submission.
    fireEvent.submit(submit);
    expect(app.redeemReferral).not.toHaveBeenCalled();
    expect(app.onAccessChange).not.toHaveBeenCalled();
    expect(screen.getByText("1 of 1 left")).toBeVisible();

    await user.clear(input);
    await user.type(input, friendCode);
    expect(input).toBeValid();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(
      await screen.findByText(
        "Invite redeemed. You both received 30 extra days.",
      ),
    ).toBeVisible();
    expect(app.redeemReferral).toHaveBeenCalledExactlyOnceWith({
      code: friendCode,
    });
    expect(app.onAccessChange).toHaveBeenCalledOnce();
  },
);

test("failed issuance requires an explicit retry and does not block redemption", async () => {
  const app = fixture({ ...empty, canInvite: true }, { issueError: true });
  const retry = await screen.findByRole("button", {
    name: "Retry invitations",
  });
  expect(app.issueReferrals).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("textbox", { name: "Invitation code" }),
  ).toBeEnabled();
  app.issueReferrals.mockResolvedValue({ ...empty, canInvite: true, codes });
  await userEvent.click(retry);
  expect(await screen.findByRole("list")).toBeVisible();
  expect(app.issueReferrals).toHaveBeenCalledTimes(2);
});

test("failed redemption preserves the code for correction and is never automatically retried", async () => {
  const app = fixture();
  app.redeemReferral.mockRejectedValueOnce(
    new Error("This invitation has already been used."),
  );
  const input = screen.getByRole("textbox", { name: "Invitation code" });
  await userEvent.type(input, friendCode);
  await userEvent.click(screen.getByRole("button", { name: "Redeem code" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Redeem code" })).toBeEnabled(),
  );
  expect(input).toHaveValue(friendCode);
  expect(app.redeemReferral).toHaveBeenCalledOnce();
  expect(app.onAccessChange).not.toHaveBeenCalled();
});

test("pending redemption cannot be submitted twice or refresh a later account", async () => {
  const app = fixture();
  let finish!: (value: typeof granted) => void;
  app.redeemReferral.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.type(screen.getByRole("textbox"), friendCode);
  await userEvent.click(screen.getByRole("button", { name: "Redeem code" }));
  expect(screen.getByRole("button", { name: "Redeeming…" })).toBeDisabled();
  expect(screen.getByRole("textbox")).toBeDisabled();
  clerk.userId = "user_2";
  app.remount();
  await act(async () => finish(granted));
  expect(app.onAccessChange).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox")).toHaveValue("");
  expect(app.redeemReferral).toHaveBeenCalledOnce();
});

test("a lost success response reconciles facts and refreshes access without replaying redemption", async () => {
  const app = fixture();
  await waitFor(() => expect(app.client.isFetching()).toBe(0));
  app.redeemReferral.mockImplementationOnce(async () => {
    app.getReferrals.mockResolvedValue({
      ...empty,
      redeemedCode: friendCode,
    });
    throw new Error("Connection lost");
  });
  await userEvent.type(screen.getByRole("textbox"), friendCode);
  await userEvent.click(screen.getByRole("button", { name: "Redeem code" }));
  expect(
    await screen.findByText("You’ve already redeemed an invite."),
  ).toBeVisible();
  await waitFor(() => expect(app.onAccessChange).toHaveBeenCalledOnce());
  expect(app.redeemReferral).toHaveBeenCalledOnce();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(app.client.getQueryData(["billing", "user_1"])).toEqual({
    status: "none",
  });
});

test("an unavailable invitation read leaves redemption available without inventing tickets", async () => {
  fixture(empty, { readError: true });
  expect(
    await screen.findByRole("button", { name: "Retry invitations" }),
  ).toBeVisible();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  expect(
    screen.getByRole("textbox", { name: "Invitation code" }),
  ).toBeEnabled();
});

test("an incomplete code is caught by the field before sending a redemption", async () => {
  const app = fixture();
  const input = screen.getByRole("textbox", { name: "Invitation code" });
  await userEvent.type(input, "incomplete-code");
  await userEvent.click(screen.getByRole("button", { name: "Redeem code" }));
  expect(input).toBeInvalid();
  expect(app.redeemReferral).not.toHaveBeenCalled();
});
