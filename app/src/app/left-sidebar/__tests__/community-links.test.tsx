// Purpose: Verify the sidebar's community icons open GitHub and Discord outside the app.
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { communityUrls } from "@openchart/app/app/community-urls";
import { CommunityLinks } from "@openchart/app/app/left-sidebar/community-links";
import { SidebarProvider } from "@openchart/app/components/ui/sidebar";

test("community icons are labeled links that open in a new window", () => {
  render(
    <SidebarProvider>
      <CommunityLinks />
    </SidebarProvider>,
  );
  for (const [name, url] of [
    ["Discord", communityUrls.discord],
    ["GitHub", communityUrls.github],
  ]) {
    const link = screen.getByRole("link", { name });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
  }
});
