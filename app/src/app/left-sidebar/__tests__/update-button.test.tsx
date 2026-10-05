// Purpose: Verify the sidebar offers a restart only after Desktop reports a downloaded update.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { UpdateButton } from "@openchart/app/app/left-sidebar/update-button";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from "@openchart/app/components/ui/sidebar";
import { AppHostProvider } from "@openchart/app/lib/host/host";
import { testAppHost } from "@openchart/app/testing/test-utils";

test("a downloaded update shows one restart button, which asks Desktop to restart", async () => {
  let announce: (release: string) => void = () => {};
  const unsubscribe = vi.fn();
  const restartToUpdate = vi.fn(async () => {});
  const host = testAppHost({
    onUpdateReady: (listener) => {
      announce = listener;
      return unsubscribe;
    },
    restartToUpdate,
  });
  const view = render(
    <AppHostProvider value={host}>
      <SidebarProvider>
        <SidebarMenu>
          <SidebarMenuItem>
            <UpdateButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarProvider>
    </AppHostProvider>,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  act(() => announce("OpenChart 0.1.6"));
  await userEvent.click(
    screen.getByRole("button", { name: "Restart to install OpenChart 0.1.6" }),
  );
  expect(restartToUpdate).toHaveBeenCalledOnce();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalled();
});
