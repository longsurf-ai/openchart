// Purpose: Verify the starter workflow opens with its agent and notification pages, explains each page once, opens the next one on Next, finishes, and keeps saved progress meaningful across versions.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, useLocation } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, test, vi } from "vitest";

import { OnboardingHost } from "@openchart/app/app/trellis/host";
import { useOnboardingProgress } from "@openchart/app/app/trellis/progress";
import type { OnboardingPageProps } from "@openchart/app/app/trellis/views";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

// The pages have their own tests; here they only need to hand back control.
const transport = {} as AppTransport;
vi.mock(
  "@openchart/app/app/trellis/workflows/starter/connect-agents-page",
  () => ({
    ConnectAgentsPage: ({ transport: given, onDone }: OnboardingPageProps) => (
      <div role="dialog" aria-label="Connect your agent">
        {given === transport ? (
          <button onClick={onDone}>Skip for now</button>
        ) : null}
      </div>
    ),
  }),
);
vi.mock(
  "@openchart/app/app/trellis/workflows/starter/notifications-page",
  () => ({
    NotificationsPage: ({ onDone }: OnboardingPageProps) => (
      <div role="dialog" aria-label="Turn on notifications">
        <button onClick={onDone}>Continue</button>
      </div>
    ),
  }),
);

const dashboard = "/app/dashboards/dsh_88JOx0yX7TH65p";
const session = "/app/sessions/ses_rrbFx6CsSf2Xk8";
const alert = "/app/alerts/rules/alr_88PH5QdFSkCg4R";

function Page() {
  return <output aria-label="Page">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            <Page />
            <Link to="/app/feed">Feed</Link>
            <Link to="/app/watchlist">Watchlist</Link>
            <OnboardingHost transport={transport} />
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

const page = () => screen.getByRole("status", { name: "Page" });

test("the agent and notification pages open first wherever the user is, then the tour starts", async () => {
  const user = userEvent.setup();
  useOnboardingProgress.setState({ workflow: "starter", seen: [] });
  renderAt(session);

  await screen.findByRole("dialog", { name: "Connect your agent" });
  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  // The notification page follows on the same page, outside the tour's count.
  await screen.findByRole("dialog", { name: "Turn on notifications" });
  expect(page()).toHaveTextContent(session);
  expect(useOnboardingProgress.getState().seen).toEqual([0]);

  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(page()).toHaveTextContent(dashboard);
  expect(
    await screen.findByRole("dialog", {
      name: "Watch the market from your dashboard",
    }),
  ).toHaveTextContent("1 of 6");
  expect(useOnboardingProgress.getState().seen).toEqual([0, 1]);
});

test("Next opens each next page until the workflow finishes", async () => {
  const user = userEvent.setup();
  useOnboardingProgress.setState({ workflow: "starter", seen: [0, 1] });
  renderAt(dashboard);

  expect(
    await screen.findByRole("dialog", {
      name: "Watch the market from your dashboard",
    }),
  ).toHaveTextContent("1 of 6");
  // The chart cards follow on the same dashboard.
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(page()).toHaveTextContent(dashboard);
  expect(
    await screen.findByRole("dialog", { name: "Make the chart yours" }),
  ).toHaveTextContent("2 of 6");

  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(page()).toHaveTextContent(dashboard);
  expect(
    await screen.findByRole("dialog", {
      name: "Ask the Agent for an indicator",
    }),
  ).toHaveTextContent("3 of 6");

  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(page()).toHaveTextContent(session);
  expect(
    screen.getByRole("dialog", { name: "All your agents, in one place" }),
  ).toHaveTextContent("4 of 6");

  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(page()).toHaveTextContent(alert);
  expect(
    screen.getByRole("dialog", { name: "Alerts put agents to work" }),
  ).toHaveTextContent("5 of 6");

  // The closing card brings the user back to the dashboard.
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(page()).toHaveTextContent(dashboard);
  expect(
    screen.getByRole("dialog", { name: "Star us on GitHub" }),
  ).toHaveTextContent("6 of 6");
  await user.click(screen.getByRole("button", { name: "Done" }));

  expect(page()).toHaveTextContent(dashboard);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(useOnboardingProgress.getState()).toMatchObject({
    workflow: undefined,
    seen: [],
  });
});

test("leaving a page counts as seeing it", async () => {
  const user = userEvent.setup();
  useOnboardingProgress.setState({ workflow: "starter", seen: [0, 1] });
  renderAt(alert);

  await screen.findByRole("dialog", { name: "Alerts put agents to work" });
  await user.click(screen.getByRole("link", { name: "Feed" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(useOnboardingProgress.getState().seen).toEqual([0, 1, 6]);
});

test("Next out of order opens the first unseen step", async () => {
  const user = userEvent.setup();
  useOnboardingProgress.setState({ workflow: "starter", seen: [0, 1] });
  renderAt(session);

  await user.click(await screen.findByRole("button", { name: "Next" }));
  expect(page()).toHaveTextContent(dashboard);
});

test("the last card offers web pages without closing", async () => {
  useOnboardingProgress.setState({
    workflow: "starter",
    seen: [0, 1, 2, 3, 4, 5, 6],
  });
  renderAt(dashboard);
  await screen.findByRole("dialog", { name: "Star us on GitHub" });

  for (const [name, url] of [
    ["Open GitHub", "https://github.com/longsurf-ai/openchart"],
    ["Join Discord", "https://discord.gg/PR4gfbMKUD"],
  ]) {
    const link = screen.getByRole("link", { name });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
  }
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Done"]);
});

test("saved progress drops a workflow this build no longer has", async () => {
  localStorage.setItem(
    "local:onboarding",
    JSON.stringify({ state: { workflow: "retired", seen: [0] }, version: 1 }),
  );
  await act(() => useOnboardingProgress.persist.rehydrate());
  expect(useOnboardingProgress.getState().workflow).toBeUndefined();
});

test("progress saved before the chart cards keeps its seen steps", async () => {
  // Version 1 had the dashboard at 2, the Agent at 3 and the alert at 4.
  localStorage.setItem(
    "local:onboarding",
    JSON.stringify({
      state: { workflow: "starter", seen: [0, 1, 2, 3] },
      version: 1,
    }),
  );
  await act(() => useOnboardingProgress.persist.rehydrate());
  expect(useOnboardingProgress.getState()).toMatchObject({
    workflow: "starter",
    seen: [0, 1, 2, 5],
  });

  // A finished tour stays finished.
  localStorage.setItem(
    "local:onboarding",
    JSON.stringify({ state: { seen: [] }, version: 1 }),
  );
  await act(() => useOnboardingProgress.persist.rehydrate());
  expect(useOnboardingProgress.getState()).toMatchObject({
    workflow: undefined,
    seen: [],
  });
});

test("chart-card migration preserves the completed Pine conversion offer", async () => {
  localStorage.setItem(
    "local:onboarding",
    JSON.stringify({
      state: { seen: [], started: ["pine-conversion"] },
      version: 1,
    }),
  );
  await act(() => useOnboardingProgress.persist.rehydrate());
  useOnboardingProgress.getState().startOnce("pine-conversion");
  expect(useOnboardingProgress.getState()).toMatchObject({
    workflow: undefined,
    seen: [],
    started: ["pine-conversion"],
  });
});
