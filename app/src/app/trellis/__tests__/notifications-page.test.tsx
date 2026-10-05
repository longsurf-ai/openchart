// Purpose: Verify the onboarding notification page asks Desktop once on opening, offers asking again, keeps itself up on failure, and always lets the user move on.
import { StrictMode } from "react";
import { expect, test, vi } from "vitest";

import { NotificationsPage } from "@openchart/app/app/trellis/workflows/starter/notifications-page";
import { AppHostProvider, type AppHost } from "@openchart/app/lib/host/host";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  findErrorToast,
  renderWithToaster,
  screen,
  testAppHost,
  userEvent,
  waitFor,
} from "@openchart/app/testing/test-utils";

function mount(enableNotifications: AppHost["enableNotifications"]) {
  const onDone = vi.fn();
  renderWithToaster(
    <StrictMode>
      <AppHostProvider value={testAppHost({ enableNotifications })}>
        <NotificationsPage transport={{} as AppTransport} onDone={onDone} />
      </AppHostProvider>
    </StrictMode>,
  );
  return onDone;
}

test("opening the page asks Desktop once, and Continue moves on without asking again", async () => {
  const enableNotifications = vi.fn(async () => {});
  const onDone = mount(enableNotifications);

  expect(
    screen.getByRole("dialog", { name: "Turn on notifications" }),
  ).toBeInTheDocument();
  await waitFor(() => expect(enableNotifications).toHaveBeenCalledOnce());
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(onDone).toHaveBeenCalledOnce();
  expect(enableNotifications).toHaveBeenCalledOnce();
});

test("a missed prompt can be asked for again without leaving the page", async () => {
  const enableNotifications = vi.fn(async () => {});
  const onDone = mount(enableNotifications);
  await waitFor(() => expect(enableNotifications).toHaveBeenCalledOnce());

  await userEvent.click(
    screen.getByRole("button", {
      name: "Didn’t see it? Turn on notifications",
    }),
  );
  expect(enableNotifications).toHaveBeenCalledTimes(2);
  expect(onDone).not.toHaveBeenCalled();
});

test("a failure shows an error and keeps the page up until the user continues", async () => {
  const enableNotifications = vi.fn(async () => {
    throw new Error("Desktop operation refused for an untrusted frame");
  });
  const onDone = mount(enableNotifications);

  expect(
    await findErrorToast("Couldn’t turn on notifications"),
  ).toHaveTextContent("untrusted frame");
  expect(onDone).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(onDone).toHaveBeenCalledOnce();
});
