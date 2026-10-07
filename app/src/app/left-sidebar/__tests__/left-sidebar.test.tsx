// Purpose: Verify the sidebar's account row shows the community links until an update is downloaded, then its restart button instead.
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";

import { communityUrls } from "@openchart/app/app/community-urls";
import { LeftSidebar } from "@openchart/app/app/left-sidebar";
import { SidebarProvider } from "@openchart/app/components/ui/sidebar";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { AppHostProvider } from "@openchart/app/lib/host/host";
import { testAppHost } from "@openchart/app/testing/test-utils";

vi.mock("@clerk/react", () => ({
  UserAvatar: () => <span />,
  useClerk: () => ({ openSignIn: vi.fn() }),
  useUser: () => ({ user: { fullName: "Xiaowen Zhang" } }),
}));
// The sections above the footer have their own tests.
vi.mock("@openchart/app/app/left-sidebar/nav-main", () => ({
  NavMain: () => null,
}));
vi.mock("@openchart/app/app/left-sidebar/nav-dashboards", () => ({
  NavDashboards: () => null,
}));
vi.mock("@openchart/app/app/left-sidebar/nav-alerts", () => ({
  NavAlerts: () => null,
}));
vi.mock("@openchart/app/app/left-sidebar/nav-chats", () => ({
  NavChats: () => null,
}));
// Signed out: no Cloud offer above the account row.
vi.mock("@openchart/app/features/account/use-account", () => ({
  useAccount: () => ({ data: { status: "signed-out" } }),
}));
vi.mock("@openchart/app/app/routes/settings/provider-access", () => ({
  useRefreshProviderAccess: () => ({ mutate: vi.fn() }),
}));

test("a downloaded update replaces the Discord and GitHub icons on the account row", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  let announce: (release: string) => void = () => {};
  const host = testAppHost({
    onUpdateReady: (listener) => {
      announce = listener;
      return () => {};
    },
  });
  render(
    <MemoryRouter>
      <AppHostProvider value={host}>
        <SidebarProvider>
          <LeftSidebar
            transport={{} as AppTransport}
            chats={{} as never}
            onCreateChat={() => {}}
            dashboards={{} as never}
            onCreateDashboard={() => {}}
          />
        </SidebarProvider>
      </AppHostProvider>
    </MemoryRouter>,
  );
  const restart = { name: "Restart to install OpenChart 0.1.10" };
  expect(screen.getByRole("link", { name: "Discord" })).toHaveAttribute(
    "href",
    communityUrls.discord,
  );
  expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    communityUrls.github,
  );
  expect(screen.queryByRole("button", restart)).not.toBeInTheDocument();
  act(() => announce("OpenChart 0.1.10"));
  expect(screen.getByRole("button", restart)).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Discord" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "GitHub" }),
  ).not.toBeInTheDocument();
  // The account link stays, now followed by the restart button alone.
  expect(screen.getByRole("link", { name: "Xiaowen Zhang" })).toHaveAttribute(
    "href",
    "/app/settings/profile",
  );
  vi.unstubAllGlobals();
});
