// Purpose: Keep the film tied to explicit discovery or a new saved Workspace widget, once per device.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, useParams } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, expect, test, vi } from "vitest";

import { usePineConversionOnboarding } from "@openchart/app/app/onboarding";
import { OnboardingHost } from "@openchart/app/app/trellis/host";
import { useOnboardingProgress } from "@openchart/app/app/trellis/progress";
import {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/lib/resource/dashboard";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", () => ({ useReducedMotion: () => motion.reduced }));
const title = "Bring your Pine indicators with you";
const copy =
  "If you have existing indicators in Pinescript, you can port them over simply by pasting the code and asking your agent.";

beforeEach(() => {
  motion.reduced = false;
  useOnboardingProgress.setState({
    workflow: undefined,
    seen: [],
    started: [],
  });
});

function savedDashboard(id: string, kinds: string[]): Dashboard {
  return {
    id: id as Dashboard["id"],
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    name: "Demo",
    favorite: false,
    widgets: kinds.map((kind, index) => ({
      id: `wdg_${index}` as Dashboard["widgets"][number]["id"],
      kind,
      layout: { x: 0, y: index * 12, w: 12, h: 12 },
    })),
  };
}

function mount(path: string, kinds: string[] | null = []) {
  const query = vi.fn(async ({ id }: { id: string }) => {
    if (kinds === null)
      throw Object.assign(new Error("Dashboard not found"), {
        data: { code: "NOT_FOUND" },
      });
    return savedDashboard(id, kinds);
  });
  const transport = {
    url: "http://onboarding.test/trpc",
    rpc: { resources: { dashboard: { get: { query } } } },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Page() {
    const offer = usePineConversionOnboarding(transport);
    const { id = "demo" } = useParams();
    return (
      <>
        <Link to="/app/workspaces">Workspace</Link>
        <Link to="/app/feed">Feed</Link>
        <Link to="/app/dashboards/other">Other dashboard</Link>
        <button onClick={offer}>Indicators</button>
        <button
          onClick={() =>
            client.setQueryData(
              dashboardQueryOptions(transport, id).queryKey,
              savedDashboard(id, ["chart", "workspace"]),
            )
          }
        >
          Commit Workspace widget
        </button>
        <OnboardingHost transport={transport} />
      </>
    );
  }
  const router = createMemoryRouter(
    [
      { path: "/app/dashboards/:id", element: <Page /> },
      { path: "*", element: <Page /> },
    ],
    { initialEntries: [path] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const loaded = (id = "demo") =>
    waitFor(() =>
      expect(
        client.getQueryState(dashboardQueryOptions(transport, id).queryKey)
          ?.status,
      ).toBe("success"),
    );
  return { ...view, query, loaded };
}

test("first Indicators click shows the exact copy and manual playback controls", async () => {
  const user = userEvent.setup();
  mount("/app/feed");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Indicators" }));
  expect(await screen.findByRole("dialog", { name: title })).toHaveTextContent(
    copy,
  );
  const video = screen.getByLabelText("Pine Script conversion demo");
  expect(video).toHaveAttribute("autoplay");
  expect(video).toHaveAttribute("controls");
  expect(video).toHaveAttribute("poster");
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("button", { name: "Indicators" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test.each([
  { kinds: [] },
  { kinds: ["chart"] },
  { kinds: ["chart", "workspace"] },
])(
  "loading a Dashboard with $kinds never offers the film",
  async ({ kinds }) => {
    const { loaded } = mount("/app/dashboards/demo", kinds);
    await loaded();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useOnboardingProgress.getState().started).toEqual([]);
  },
);

test("opening the Workspace page never offers the film", async () => {
  const user = userEvent.setup();
  const { query } = mount("/app/feed");
  await user.click(screen.getByRole("link", { name: "Workspace" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(query).not.toHaveBeenCalled();
});

test("a missing Dashboard keeps onboarding idle and the page usable", async () => {
  const { loaded } = mount("/app/dashboards/demo", null);
  await loaded();
  expect(screen.getByRole("button", { name: "Indicators" })).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(useOnboardingProgress.getState().started).toEqual([]);
});

test("a newly committed Workspace widget offers the film; Indicators shares the same history", async () => {
  const user = userEvent.setup();
  const { loaded } = mount("/app/dashboards/demo", ["chart"]);
  await loaded();
  await user.click(
    screen.getByRole("button", { name: "Commit Workspace widget" }),
  );
  await screen.findByRole("dialog", { name: title });
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("button", { name: "Indicators" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a prior Indicators offer suppresses the later widget offer, including after restart", async () => {
  const user = userEvent.setup();
  const first = mount("/app/feed");
  await user.click(screen.getByRole("button", { name: "Indicators" }));
  await user.click(await screen.findByRole("button", { name: "Done" }));
  const saved = localStorage.getItem("local:onboarding")!;
  first.unmount();
  useOnboardingProgress.setState({
    workflow: undefined,
    seen: [],
    started: [],
  });
  localStorage.setItem("local:onboarding", saved);
  await act(() => useOnboardingProgress.persist.rehydrate());
  const next = mount("/app/dashboards/demo", ["chart"]);
  await next.loaded();
  await user.click(
    screen.getByRole("button", { name: "Commit Workspace widget" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("navigating to an existing Workspace widget is not an addition", async () => {
  const user = userEvent.setup();
  const { query, loaded } = mount("/app/dashboards/demo", ["chart"]);
  await loaded();
  query.mockResolvedValueOnce(savedDashboard("other", ["workspace"]));
  await user.click(screen.getByRole("link", { name: "Other dashboard" }));
  await loaded("other");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a click waits for a running tour on the same page", async () => {
  const user = userEvent.setup();
  useOnboardingProgress.setState({ workflow: "starter", seen: [0, 1] });
  mount("/app/workspaces");
  await user.click(screen.getByRole("button", { name: "Indicators" }));
  expect(useOnboardingProgress.getState()).toMatchObject({
    workflow: "starter",
    seen: [0, 1],
    started: [],
  });
  act(() => useOnboardingProgress.setState({ workflow: undefined, seen: [] }));
  await screen.findByRole("dialog", { name: title });
});

test("leaving the page expires an offer waiting behind another tour", async () => {
  const user = userEvent.setup();
  useOnboardingProgress.setState({ workflow: "starter", seen: [0, 1] });
  mount("/app/workspaces");
  await user.click(screen.getByRole("button", { name: "Indicators" }));
  await user.click(screen.getByRole("link", { name: "Feed" }));
  act(() => useOnboardingProgress.setState({ workflow: undefined, seen: [] }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("reduced motion keeps the film manually controlled", async () => {
  motion.reduced = true;
  const user = userEvent.setup();
  mount("/app/feed");
  await user.click(screen.getByRole("button", { name: "Indicators" }));
  await screen.findByRole("dialog", { name: title });
  expect(
    screen.getByLabelText("Pine Script conversion demo"),
  ).not.toHaveAttribute("autoplay");
  expect(screen.getByLabelText("Pine Script conversion demo")).toHaveAttribute(
    "controls",
  );
});

test("older progress without offer history preserves the starter tour", async () => {
  localStorage.setItem(
    "local:onboarding",
    JSON.stringify({
      state: { workflow: "starter", seen: [0, 1, 2] },
      version: 1,
    }),
  );
  await act(() => useOnboardingProgress.persist.rehydrate());
  expect(useOnboardingProgress.getState()).toMatchObject({
    workflow: "starter",
    seen: [0, 1, 2],
    started: [],
  });
});
