// Purpose: Feed navigation, truthful run status and unsaved Rule drafts share the real app shell.
import {
  AuiConfig,
  AuiProvider,
  ModelContextClient,
  type AssistantClient,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRef, type ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { FeedPage } from "@openchart/app/app/feed/feed-page";
import { NavAlerts } from "@openchart/app/app/left-sidebar/nav-alerts";
import { NavMain } from "@openchart/app/app/left-sidebar/nav-main";
import { SidebarProvider } from "@openchart/app/components/ui/sidebar";
import { AlertsPage } from "@openchart/app/app/alerts/alerts-page";
import { CopilotControlsProvider } from "@openchart/app/app/agent/copilot-controls";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { UnsavedChangesProvider } from "@openchart/app/lib/unsaved-changes/unsaved-changes";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { of } from "rxjs";
import type { AlertRuleDialogProps } from "@openchart/app/features/alerts/components/alert-rule-dialog";
import { useSidebarSort } from "@openchart/app/stores/sidebar";
import { usePostReadState } from "@openchart/app/features/posts/hooks/use-post-read-state";

const createChat = vi.hoisted(() => vi.fn());
const submitPrompt = vi.hoisted(() => vi.fn());
vi.mock("@openchart/app/lib/agent/provider", () => ({
  useAgentContext: () => ({
    agent: {
      createSession: { mutateAsync: createChat, isPending: false },
      submitPrompt: { mutateAsync: submitPrompt },
      modelProviders: {
        isPending: false,
        data: [
          {
            id: "codex",
            models: [{ id: "gpt-session", providerID: "codex" }],
          },
        ],
      },
    },
  }),
}));
// The Post's Session last ran on its own model and workspace.
vi.mock(
  "@openchart/app/lib/agent/use-session-snapshot",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@openchart/app/lib/agent/use-session-snapshot")
      >();
    const empty = { messages: [], state: undefined, loading: false };
    const published = {
      loading: false,
      messages: [{ id: "msg_user", role: "user" }],
      state: {
        messageInfo: {
          msg_user: {
            model: { providerID: "codex", modelID: "gpt-session" },
            workspaceId: "wsp_session",
          },
        },
      },
    };
    return {
      ...original,
      useSessionSnapshot: (
        _agent: unknown,
        sessionID: string | undefined,
        selector: (snapshot: never) => unknown,
      ) => selector((sessionID === "ses_test" ? published : empty) as never),
    };
  },
);
const editorPrompts = vi.hoisted(() => [] as unknown[]);
const instruction = {
  agent: "analyst",
  parts: [{ type: "text", text: "Check the next hour" }],
  model: { providerID: "codex", modelID: "gpt-test" },
  workspaceId: "wsp_test",
};
// The shared prompt editor has its own tests; the Feed only reads its finished prompt.
vi.mock(
  "@openchart/app/features/agent/components/prompt-editor/prompt-editor",
  () => ({
    AgentPromptEditor: ({
      prompt,
      children,
    }: {
      prompt?: unknown;
      children: (editor: unknown) => ReactNode;
    }) => {
      editorPrompts.push(prompt);
      return children({
        content: <p>Composer</p>,
        ready: true,
        read: () => Promise.resolve(instruction),
      });
    },
  }),
);
// Records what each IntersectionObserver watches, so a test can scroll the Feed to its end.
const observed: { callback: IntersectionObserverCallback; target: Element }[] =
  [];
class RecordingObserver {
  constructor(readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    observed.push({ callback: this.callback, target });
  }
  unobserve() {}
  disconnect() {}
}
function reachFeedEnd() {
  const end = observed
    .filter(({ target }) => target.hasAttribute("data-feed-end"))
    .at(-1);
  if (!end) throw new Error("Nothing watches the end of the Feed");
  act(() =>
    end.callback(
      [
        {
          isIntersecting: true,
          target: end.target,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    ),
  );
}
beforeEach(() => {
  observed.length = 0;
  vi.stubGlobal("IntersectionObserver", RecordingObserver);
  editorPrompts.length = 0;
  createChat.mockReset().mockResolvedValue({ id: "ses_alert_creation" });
  submitPrompt.mockReset().mockResolvedValue({});
});

beforeEach(() => {
  usePostReadState.setState({ lastReadAt: 0, readIds: [] });
  useSidebarSort.setState({
    dashboards: "updatedAt",
    alerts: "updatedAt",
    chats: "updatedAt",
  });
});

vi.mock("@openchart/app/components/ui/sidebar", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@openchart/app/components/ui/sidebar")
  >()),
  useSidebar: () => ({ open: true, isMobile: false, setOpenMobile: vi.fn() }),
}));
vi.mock("@openchart/app/app/alerts/alert-listing-picker", () => ({
  renderAlertListingPicker: () => null,
}));
vi.mock("@openchart/app/app/alerts/alert-prompt-editor", () => ({
  alertPromptEditor: () => () => null,
}));
vi.mock("@openchart/app/features/alerts/components/alert-rule-dialog", () => ({
  AlertRulePage: (
    props: AlertRuleDialogProps & {
      onDirtyChange?: (dirty: boolean) => void;
      renderTitle?: (title: ReactNode) => ReactNode;
    },
  ) => (
    <div>
      <p>Configuration: {props.rule?.name ?? "New rule"}</p>
      {props.renderTitle?.(props.rule?.name ?? "New alert")}
      {props.initialActionId ? <p>Prompt: {props.initialActionId}</p> : null}
      <button onClick={() => props.onDirtyChange?.(true)}>Change draft</button>
      <input
        aria-label="Draft"
        defaultValue="Initial draft"
        onChange={() => props.onDirtyChange?.(true)}
      />
      {props.ruleUnavailable ? (
        <p>This rule was deleted. Your draft is preserved.</p>
      ) : null}
      <button onClick={props.onClose}>Cancel</button>
      <button
        disabled={props.ruleUnavailable}
        onClick={() => {
          props.onDirtyChange?.(false);
          props.onClose();
        }}
      >
        Save rule
      </button>
    </div>
  ),
}));
const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
afterEach(() => {
  clients.forEach((client) => client.clear());
  routers.forEach((router) => router.dispose());
  clients.length = 0;
  routers.length = 0;
});
const rule = {
  id: "arl_test",
  name: "Price crossing",
  enabled: true,
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  repeat: true,
  alertable: {
    kind: "tea",
    source: "rule",
    config: { inputs: {}, map: {}, parameters: {}, requests: {} },
  },
};
const origin = { eventId: "aev_test", ruleId: rule.id };
const eventPost = {
  id: "pst_rule",
  revision: 1,
  createdAt: 100,
  updatedAt: 100,
  author: { kind: "rule", ruleId: rule.id, name: rule.name },
  origin: { kind: "alert_event", ...origin, occurredAt: 90 },
  content: [{ type: "text", text: "AAPL crossed 200" }],
  quotedPostId: null,
};
const agentPost = {
  id: "pst_agent",
  revision: 1,
  createdAt: 101,
  updatedAt: 101,
  author: { kind: "provider", providerId: "codex" },
  origin: {
    kind: "agent_run",
    runId: "agr_test",
    sessionId: "ses_test",
    alert: origin,
  },
  content: [{ type: "text", text: "Observed a breakout" }],
  quotedPostId: eventPost.id,
};
function mount(
  path = "/app/feed",
  canEditPrompt = true,
  directoryRules: readonly (typeof rule)[] = [rule],
  items: readonly unknown[] = [
    { post: agentPost, quotedPost: eventPost as typeof eventPost | null },
    { post: eventPost, quotedPost: null },
  ],
  statuses: readonly unknown[] = directoryRules.map((item) => ({
    key: `alert/${item.id}`,
    label: item.name,
    health: { state: "healthy" },
    since: 0,
    checks: [],
  })),
) {
  const selectSession = vi.fn();
  const prefill = vi.fn();
  const feed = vi.fn().mockImplementation(({ cursor }: { cursor?: string }) =>
    Promise.resolve({
      items: cursor ? [] : items,
      nextCursor: cursor ? null : "older",
    }),
  );
  const executions = vi.fn().mockResolvedValue([
    {
      eventId: origin.eventId,
      runs: [
        {
          runId: "agr_test",
          sessionId: "ses_test",
          title: "Analysis",
          providerId: "codex",
          status: "completed",
          triggerId: "trg_second",
          canEditPrompt,
          hasPublished: false,
        },
      ],
    },
  ]);
  const ruleGet = vi.fn().mockResolvedValue(rule);
  const patchRule = vi.fn().mockResolvedValue(undefined);
  const saveRule = vi.fn().mockResolvedValue(undefined);
  const deleteRule = vi.fn().mockResolvedValue(undefined);
  const listRules = vi
    .fn()
    .mockResolvedValue({ items: directoryRules, nextCursor: null });
  const transport = {
    url: "test",
    ready: true,
    events: of({ kind: "ready" as const }),
    rpc: {
      monitoring: { status: { query: vi.fn().mockResolvedValue(statuses) } },
      resources: {
        macro: {
          alertFeedExecutions: { query: executions },
          saveAlertRule: { mutate: saveRule },
        },
        post: {
          feed: { query: feed },
          unreadCounts: {
            query: vi.fn().mockResolvedValue([{ ruleId: rule.id, count: 2 }]),
          },
        },
        alert_rule: {
          list: { query: listRules },
          get: { query: ruleGet },
          patch: { mutate: patchRule },
          delete: { mutate: deleteRule },
        },
        trigger: {
          list: {
            query: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
          },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const router = createMemoryRouter(
    [
      {
        element: (
          <UnsavedChangesProvider>
            <CopilotControlsProvider
              value={{ open: false, toggle: vi.fn(), selectSession, prefill }}
            >
              <aside aria-label="Main navigation">
                <NavMain onCreate={vi.fn()} onCreateDashboard={vi.fn()} />
                <NavAlerts transport={transport} />
              </aside>
              <Outlet context={{ transport }} />
            </CopilotControlsProvider>
          </UnsavedChangesProvider>
        ),
        children: [
          { path: "/app/alerts/*", element: <AlertsPage /> },
          { path: "/app/feed", element: <FeedPage /> },
          { path: "/app/sessions/:sessionId", element: <p>Chat page</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  routers.push(router);
  const assistant = createRef<AssistantClient>();
  const context = AuiConfig({ modelContext: ModelContextClient() });
  render(
    <AuiProvider config={context} ref={assistant}>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SidebarProvider>
            <RouterProvider router={router} />
          </SidebarProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </AuiProvider>,
  );
  return {
    readContext: () => assistant.current!.modelContext.getModelContext().system,
    router,
    selectSession,
    prefill,
    feed,
    executions,
    ruleGet,
    patchRule,
    saveRule,
    deleteRule,
    listRules,
    client,
  };
}

test("navbar New Alert directly opens manual creation and protects same-route drafts", async () => {
  const { router } = mount();
  await userEvent.click(await screen.findByRole("link", { name: "New Alert" }));
  expect(await screen.findByText("Configuration: New rule")).toBeVisible();
  expect(router.state.location.pathname).toBe("/app/alerts/new");
  expect(
    screen.queryByRole("menuitem", { name: "Create with agent" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Draft"), {
    target: { value: "Keep my alert" },
  });
  await userEvent.click(screen.getByRole("link", { name: "New Alert" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Keep editing" }),
  );
  expect(screen.getByLabelText("Draft")).toHaveValue("Keep my alert");
  await userEvent.click(screen.getByRole("link", { name: "New Alert" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  expect(screen.getByLabelText("Draft")).toHaveValue("Initial draft");
  expect(createChat).not.toHaveBeenCalled();
});

test("Agent creation keeps the manual alert draft and only opens Copilot", async () => {
  const { router, saveRule, prefill } = mount(`/app/alerts/rules/${rule.id}`);
  fireEvent.change(await screen.findByLabelText("Draft"), {
    target: { value: "Unsaved alert" },
  });
  await userEvent.click(
    screen.getByRole("button", { name: "New alert", expanded: false }),
  );
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Create with agent" }),
  );
  expect(prefill).toHaveBeenCalledWith("Create an alert when...");
  expect(router.state.location.pathname).toBe(`/app/alerts/rules/${rule.id}`);
  expect(screen.getByLabelText("Draft")).toHaveValue("Unsaved alert");
  expect(
    screen.queryByRole("dialog", { name: "Discard unsaved changes?" }),
  ).not.toBeInTheDocument();
  expect(createChat).not.toHaveBeenCalled();
  expect(saveRule).not.toHaveBeenCalled();
});

test.each(["header", "rail"])(
  "%s Rule actions retain the unsaved-draft guard and reload only after an accepted change",
  async (location) => {
    const view = mount(`/app/alerts/rules/${rule.id}`);
    await screen.findByText("Configuration: Price crossing");
    for (const name of ["Pause", "Copy", "Delete"])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    const menuName =
      location === "header" ? "Rule options" : `Options for ${rule.name}`;
    await userEvent.click(screen.getByRole("button", { name: menuName }));
    for (const name of ["Pause", "Copy", "Delete"])
      expect(screen.getByRole("menuitem", { name })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    const draft = screen.getByRole("textbox", { name: "Draft" });
    fireEvent.change(draft, { target: { value: "Unsaved work" } });
    await userEvent.click(screen.getByRole("button", { name: menuName }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Pause" }));
    expect(
      await screen.findByRole("dialog", { name: "Discard unsaved changes?" }),
    ).toBeVisible();
    expect(view.patchRule).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(view.router.state.location.pathname).toBe(
      `/app/alerts/rules/${rule.id}`,
    );
    expect(draft).toHaveValue("Unsaved work");
    await userEvent.click(screen.getByRole("button", { name: menuName }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Pause" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    await waitFor(() =>
      expect(view.patchRule).toHaveBeenCalledWith({
        id: rule.id,
        expectedRevision: rule.revision,
        operations: [{ op: "replace", path: "/enabled", value: false }],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
        "Initial draft",
      ),
    );
    expect(view.router.state.location.pathname).toBe(
      `/app/alerts/rules/${rule.id}`,
    );
    expect(
      screen.queryByRole("dialog", { name: "Discard unsaved changes?" }),
    ).not.toBeInTheDocument();
  },
);

test("rail actions pause and enable a rule without leaving Feed", async () => {
  const view = mount();
  await screen.findByText("Observed a breakout");
  const rail = screen.getByRole("group", { name: "Alerts" });
  const options = within(rail).getByRole("button", {
    name: `Options for ${rule.name}`,
  });
  expect(
    within(rail).getByRole("link", { name: /Price crossing/ }),
  ).not.toContainElement(options);
  await userEvent.click(options);
  const paused = { ...rule, enabled: false, revision: 2 };
  view.listRules.mockResolvedValue({ items: [paused], nextCursor: null });
  await userEvent.click(screen.getByRole("menuitem", { name: "Pause" }));
  await waitFor(() =>
    expect(view.patchRule).toHaveBeenCalledWith({
      id: rule.id,
      expectedRevision: 1,
      operations: [{ op: "replace", path: "/enabled", value: false }],
    }),
  );
  await waitFor(() => expect(options).toBeEnabled());
  expect(view.router.state.location.pathname).toBe("/app/feed");
  await userEvent.click(options);
  view.listRules.mockResolvedValue({
    items: [{ ...paused, enabled: true, revision: 3 }],
    nextCursor: null,
  });
  await userEvent.click(screen.getByRole("menuitem", { name: "Enable" }));
  await waitFor(() =>
    expect(view.saveRule).toHaveBeenCalledWith(
      expect.objectContaining({
        rule: { id: rule.id, expectedRevision: 2 },
        value: expect.objectContaining({ enabled: true }),
      }),
    ),
  );
  expect(view.router.state.location.pathname).toBe("/app/feed");
});

test("changing another rule from the rail leaves the selected draft untouched", async () => {
  const other = { ...rule, id: "arl_other", name: "Other rule" };
  const view = mount(`/app/alerts/rules/${rule.id}`, true, [rule, other]);
  const draft = await screen.findByRole("textbox", { name: "Draft" });
  fireEvent.change(draft, { target: { value: "Keep this draft" } });
  await userEvent.click(
    screen.getByRole("button", { name: "Options for Other rule" }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Pause" }));
  await waitFor(() =>
    expect(view.patchRule).toHaveBeenCalledWith(
      expect.objectContaining({ id: other.id }),
    ),
  );
  expect(
    screen.queryByRole("dialog", { name: "Discard unsaved changes?" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft).toHaveValue("Keep this draft");
  expect(view.router.state.location.pathname).toBe(
    `/app/alerts/rules/${rule.id}`,
  );
});

test("deleting the selected rule from the rail asks to discard once and returns to Feed", async () => {
  const view = mount(`/app/alerts/rules/${rule.id}`);
  fireEvent.click(await screen.findByRole("button", { name: "Change draft" }));
  await userEvent.click(
    screen.getByRole("button", { name: `Options for ${rule.name}` }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(view.deleteRule).not.toHaveBeenCalled();
  await userEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  await waitFor(() =>
    expect(view.router.state.location.pathname).toBe("/app/feed"),
  );
  expect(view.deleteRule).toHaveBeenCalledWith({ id: rule.id });
  expect(
    screen.queryByRole("dialog", { name: "Discard unsaved changes?" }),
  ).not.toBeInTheDocument();
});

test("a new instruction continues the Session that published the Post, then opens it in Copilot", async () => {
  const view = mount();
  const post = await screen.findByRole("article", { name: "Post by Codex" });
  fireEvent.click(
    within(post).getByRole("button", { name: "New instruction" }),
  );
  // Inline, like a comment: no dialog opens.
  const form = within(post).getByRole("form", { name: "New instruction" });
  // The composer starts from the Session's last model and workspace.
  expect(editorPrompts.at(-1)).toEqual({
    agent: "analyst",
    parts: [],
    model: { providerID: "codex", modelID: "gpt-session" },
    workspaceId: "wsp_session",
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(within(form).getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(view.selectSession).toHaveBeenCalledWith("ses_test"),
  );
  expect(createChat).not.toHaveBeenCalled();
  expect(submitPrompt).toHaveBeenCalledWith({
    sessionID: "ses_test",
    parts: instruction.parts,
    model: instruction.model,
    workspaceId: instruction.workspaceId,
    viewContext: JSON.stringify({ view: "feed", postId: agentPost.id }),
  });
  expect(
    within(post).queryByRole("form", { name: "New instruction" }),
  ).not.toBeInTheDocument();
});

test("a new instruction on a Rule Post starts a Session with the Post as context", async () => {
  const view = mount();
  const post = await screen.findByRole("article", {
    name: `Post by ${rule.name}`,
  });
  fireEvent.click(
    within(post).getByRole("button", { name: "New instruction" }),
  );
  // A Rule Post has no Session, so the composer keeps the global defaults.
  expect(editorPrompts.at(-1)).toBeUndefined();
  fireEvent.click(
    within(
      within(post).getByRole("form", { name: "New instruction" }),
    ).getByRole("button", { name: "Send" }),
  );
  await waitFor(() =>
    expect(view.selectSession).toHaveBeenCalledWith("ses_alert_creation"),
  );
  expect(submitPrompt).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionID: "ses_alert_creation",
      viewContext: JSON.stringify({ view: "feed", postId: eventPost.id }),
    }),
  );
});

test("Feed shows two cards and quotes without run status text; Open session only navigates", async () => {
  const view = mount();
  expect(await screen.findByText("Observed a breakout")).toBeVisible();
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(view.readContext()).toBe(
    JSON.stringify({
      view: "feed",
      filter: "all",
      search: "",
      loadedPostIds: [agentPost.id, eventPost.id],
      hasMore: true,
    }),
  );
  expect(
    within(screen.getByRole("figure", { name: "Quoted post" })).getByText(
      "AAPL crossed 200",
    ),
  ).toBeVisible();
  await waitFor(() => expect(view.executions).toHaveBeenCalled());
  expect(
    screen.queryByText(/Completed without a post/),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Open session" })[0]!);
  expect(view.selectSession).toHaveBeenCalledWith("ses_test");
  expect(view.router.state.location.pathname).toBe("/app/feed");
  fireEvent.click(screen.getByRole("radio", { name: "Unread" }));
  await waitFor(() =>
    expect(view.feed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        unread: { after: 0, excludeIds: [agentPost.id] },
      }),
      expect.objectContaining({ context: { method: "POST" } }),
    ),
  );
  // Reaching the end of the stream loads the next page; there is no button.
  expect(
    screen.queryByRole("button", { name: "Show more posts" }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      observed.some(({ target }) => target.hasAttribute("data-feed-end")),
    ).toBe(true),
  );
  reachFeedEnd();
  await waitFor(() =>
    expect(view.feed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: "older",
        unread: { after: 0, excludeIds: [agentPost.id] },
      }),
      expect.anything(),
    ),
  );
  await waitFor(() =>
    expect(view.readContext()).toBe(
      JSON.stringify({
        view: "feed",
        filter: "unread",
        search: "",
        loadedPostIds: [agentPost.id, eventPost.id],
        hasMore: false,
      }),
    ),
  );
});

test("direct Rule and prompt links select the editor and guard dirty navigation", async () => {
  const view = mount("/app/alerts/rules/arl_test?action=trg_second");
  expect(
    await screen.findByText("Configuration: Price crossing"),
  ).toBeVisible();
  expect(screen.getByText("Prompt: trg_second")).toBeVisible();
  expect(view.feed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Change draft" }));
  fireEvent.click(screen.getByRole("link", { name: "Feed" }));
  expect(
    await screen.findByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(view.router.state.location.pathname).toBe(
    "/app/alerts/rules/arl_test",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
  await waitFor(() =>
    expect(view.router.state.location.pathname).toBe("/app/feed"),
  );
  expect(
    screen.queryByRole("dialog", { name: "Discard unsaved changes?" }),
  ).not.toBeInTheDocument();
  expect(view.readContext()).toContain('"view":"feed"');

  await act(() => view.router.navigate("/app/alerts/rules/arl_test"));
  expect(
    await screen.findByText("Configuration: Price crossing"),
  ).toBeVisible();
  view.ruleGet.mockResolvedValue({
    ...rule,
    id: "arl_second",
    name: "Second rule",
  });
  await act(() => view.router.navigate("/app/alerts/rules/arl_second"));
  expect(await screen.findByText("Configuration: Second rule")).toBeVisible();
  await act(() => view.router.navigate("/app/alerts/new"));
  expect(await screen.findByText("Configuration: New rule")).toBeVisible();
});

test("a deleted Rule retains its published title without a broken Rule link", async () => {
  const view = mount();
  view.ruleGet.mockRejectedValue(
    Object.assign(new Error("gone"), { data: { code: "NOT_FOUND" } }),
  );
  await act(async () => {
    await view.client.invalidateQueries({
      queryKey: [["resources", "alert_rule", "get"]],
    });
  });
  await waitFor(() => expect(view.ruleGet).toHaveBeenCalled());
  const articles = await screen.findAllByRole("article");
  expect(articles).toHaveLength(2);
  for (const article of articles) {
    expect(within(article).getByText(rule.name)).toBeVisible();
    expect(
      within(article).queryByRole("link", { name: rule.name }),
    ).not.toBeInTheDocument();
  }
});

test("accepting Cancel discard leaves the editor after one confirmation", async () => {
  const view = mount("/app/alerts/rules/arl_test");
  await screen.findByText("Configuration: Price crossing");
  fireEvent.click(screen.getByRole("button", { name: "Change draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    await screen.findByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(view.router.state.location.pathname).toBe("/app/feed"),
  );
  expect(
    screen.queryByRole("dialog", { name: "Discard unsaved changes?" }),
  ).not.toBeInTheDocument();
});

test("a Rule Post shows its running Agent as the shared Spinner, without status text", async () => {
  const view = mount();
  const run = {
    runId: "agr_test",
    sessionId: "ses_test",
    title: "Analysis",
    providerId: "codex",
    triggerId: "trg_second",
    canEditPrompt: true,
    hasPublished: false,
  };
  view.executions.mockResolvedValue([
    { eventId: origin.eventId, runs: [{ ...run, status: "running" }] },
  ]);
  await act(() => view.client.invalidateQueries());
  const rulePost = await screen.findByRole("article", {
    name: `Post by ${rule.name}`,
  });
  expect(await within(rulePost).findByText("Working")).toBeInTheDocument();
  expect(
    within(rulePost).queryByRole("button", { name: "New instruction" }),
  ).not.toBeInTheDocument();
  expect(within(rulePost).queryByText(/Analyzing/)).not.toBeInTheDocument();
  expect(
    within(rulePost).queryByRole("button", { name: "Open session" }),
  ).not.toBeInTheDocument();

  // Once the run ends, the Post offers New instruction again.
  view.executions.mockResolvedValue([
    { eventId: origin.eventId, runs: [{ ...run, status: "failed" }] },
  ]);
  await act(() => view.client.invalidateQueries());
  expect(
    await within(rulePost).findByRole("button", { name: "New instruction" }),
  ).toBeInTheDocument();
  expect(within(rulePost).queryByText("Working")).not.toBeInTheDocument();
  expect(within(rulePost).queryByText(/failed/)).not.toBeInTheDocument();
});

test("a deleted Trigger hides prompt editing while retaining Rule and Session navigation", async () => {
  const view = mount("/app/feed", false);
  await waitFor(() => expect(view.executions).toHaveBeenCalled());
  for (const article of screen.getAllByRole("article")) {
    expect(
      await within(article).findByRole("link", { name: rule.name }),
    ).toBeVisible();
  }
  expect(screen.getAllByRole("button", { name: "Open session" })).toHaveLength(
    1,
  );
  expect(
    screen.queryByRole("link", { name: "Edit prompt" }),
  ).not.toBeInTheDocument();
});

test("search replaces the rule filter and starts a new result set", async () => {
  const view = mount();
  await screen.findByText("Observed a breakout");
  expect(screen.getAllByRole("heading", { name: "Feed" })).toHaveLength(1);
  const rail = screen.getByRole("group", { name: "Alerts" });
  expect(within(rail).getByText("Alerts")).toBeVisible();
  expect(
    screen.queryByRole("navigation", { name: "Feed" }),
  ).not.toBeInTheDocument();
  expect(
    within(rail).queryByRole("heading", { name: "Feed" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Filter posts by rule" }),
  ).not.toBeInTheDocument();
  view.feed.mockResolvedValue({ items: [], nextCursor: null });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search feed" }), {
    target: { value: "  missing symbol  " },
  });
  await waitFor(() =>
    expect(view.feed).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "missing symbol", cursor: undefined }),
      expect.anything(),
    ),
  );
  expect(await screen.findByText("No matching posts")).toBeVisible();
  expect(view.readContext()).toBe(
    JSON.stringify({
      view: "feed",
      filter: "all",
      search: "missing symbol",
      loadedPostIds: [],
      hasMore: false,
    }),
  );
  await act(() => view.router.navigate("/app/sessions/ses_test"));
  expect(view.readContext()).toBeUndefined();
});

test.each(["empty", "individually read", "all read"])(
  "Mark all read is hidden when the feed is %s",
  async (state) => {
    if (state === "individually read")
      usePostReadState.getState().markRead(eventPost.id);
    if (state === "all read")
      usePostReadState.getState().markAllRead(Date.now());
    const view = mount(
      "/app/feed",
      true,
      [],
      state === "empty" ? [] : [{ post: eventPost, quotedPost: null }],
    );
    await act(() => view.client.invalidateQueries());
    expect(
      screen.queryByRole("button", { name: "Mark all read" }),
    ).not.toBeInTheDocument();
  },
);

test("Mark all read finds unread posts beyond the visible page and reappears for new posts", async () => {
  usePostReadState.getState().markRead(eventPost.id);
  const view = mount(
    "/app/feed",
    true,
    [],
    [{ post: eventPost, quotedPost: null }],
  );
  await screen.findByText("AAPL crossed 200");
  let hiddenPost = { ...agentPost, id: "pst_older", createdAt: 1 };
  view.feed.mockImplementation(({ unread, search, cursor }) =>
    Promise.resolve({
      items: unread
        ? hiddenPost.createdAt > unread.after &&
          !unread.excludeIds.includes(hiddenPost.id)
          ? [{ post: hiddenPost, quotedPost: null }]
          : []
        : search || cursor
          ? []
          : [{ post: eventPost, quotedPost: null }],
      nextCursor: unread || search || cursor ? null : "older",
    }),
  );
  await act(() => view.client.invalidateQueries());
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.queryByText("Observed a breakout")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark all read" })).toBeVisible();

  fireEvent.change(screen.getByRole("searchbox", { name: "Search feed" }), {
    target: { value: "no match" },
  });
  await screen.findByText("No matching posts");
  fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
  expect(
    screen.queryByRole("button", { name: "Mark all read" }),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
  hiddenPost = {
    ...agentPost,
    id: "pst_new",
    createdAt: usePostReadState.getState().lastReadAt + 1,
  };
  await act(() => view.client.invalidateQueries());
  expect(
    await screen.findByRole("button", { name: "Mark all read" }),
  ).toBeVisible();
});

test("a Rule title opens configuration and marks only its post read", async () => {
  const view = mount();
  const article = await screen.findByRole("article", {
    name: `Post by ${rule.name}`,
  });
  expect(
    within(article).queryByRole("link", { name: "Open rule" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    await within(article).findByRole("link", { name: rule.name }),
  );
  await waitFor(() =>
    expect(view.router.state.location.pathname).toBe(
      `/app/alerts/rules/${rule.id}`,
    ),
  );
  expect(usePostReadState.getState().readIds).toEqual([eventPost.id]);
  expect(
    screen.getAllByRole("heading", { name: /Price crossing/ }),
  ).toHaveLength(1);
  expect(
    within(screen.getByRole("group", { name: "Alerts" })).queryByRole(
      "heading",
      { name: /Price crossing/ },
    ),
  ).not.toBeInTheDocument();
});

test("external Rule deletion keeps the mounted draft and its unsaved-navigation guard", async () => {
  const view = mount("/app/alerts/rules/arl_test");
  const draft = await screen.findByRole("textbox", { name: "Draft" });
  fireEvent.change(draft, {
    target: { value: "Keep this unsaved analysis prompt" },
  });
  view.ruleGet.mockRejectedValue(
    Object.assign(new Error("gone"), { data: { code: "NOT_FOUND" } }),
  );
  await act(async () => {
    await view.client.invalidateQueries({
      queryKey: [["resources", "alert_rule", "get"]],
    });
  });
  expect(
    await screen.findByText("This rule was deleted. Your draft is preserved."),
  ).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft).toHaveValue("Keep this unsaved analysis prompt");
  expect(screen.getByRole("button", { name: "Save rule" })).toBeDisabled();
  fireEvent.click(screen.getByRole("link", { name: "Feed" }));
  expect(
    await screen.findByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(draft).toHaveValue("Keep this unsaved analysis prompt");
});

test("ordinary and scheduled posts share Feed navigation without alert execution requests", async () => {
  const standalone = {
    ...agentPost,
    id: "pst_chat",
    origin: { ...agentPost.origin, alert: null },
    quotedPostId: null,
    content: [{ type: "text", text: "Project update" }],
  };
  const scheduled = {
    ...standalone,
    id: "pst_scheduled",
    origin: {
      ...standalone.origin,
      sessionId: "ses_schedule",
      runId: "agr_schedule",
    },
    content: [{ type: "text", text: "Morning digest" }],
  };
  const view = mount(
    "/app/feed",
    false,
    [],
    [
      { post: standalone, quotedPost: null },
      { post: scheduled, quotedPost: null },
    ],
  );
  expect(await screen.findByText("Morning digest")).toBeVisible();
  expect(screen.getByText("Project update")).toBeVisible();
  expect(view.executions).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("link", { name: "Edit prompt" }),
  ).not.toBeInTheDocument();
  const post = screen
    .getAllByRole("article")
    .find((article) => within(article).queryByText("Morning digest"))!;
  await userEvent.click(
    within(post).getByRole("button", { name: "Open session" }),
  );
  expect(view.selectSession).toHaveBeenCalledWith("ses_schedule");
  expect(screen.getByRole("link", { name: "New Alert" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Feed" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    screen.queryByRole("link", { name: "Alerts" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New schedule" })).toBeVisible();
});

test("a pending sidebar mutation cannot navigate away from a newer page", async () => {
  const view = mount(`/app/alerts/rules/${rule.id}`);
  await screen.findByText("Configuration: Price crossing");
  let finish!: () => void;
  view.patchRule.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: `Options for ${rule.name}` }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Pause" }));
  await waitFor(() => expect(view.patchRule).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("link", { name: "Feed" }));
  await act(async () => finish());
  expect(view.router.state.location.pathname).toBe("/app/feed");
});

test("Alerts header sorts without replacing a draft, and its Add reuses guarded manual creation", async () => {
  const view = mount(`/app/alerts/rules/${rule.id}`);
  const draft = await screen.findByRole("textbox", { name: "Draft" });
  fireEvent.change(draft, { target: { value: "Keep this draft" } });
  const group = within(screen.getByRole("group", { name: "Alerts" }));
  await userEvent.click(group.getByRole("button", { name: "Sort alerts" }));
  expect(
    screen.getByRole("menuitemradio", { name: "Last updated" }),
  ).toBeChecked();
  await userEvent.click(
    screen.getByRole("menuitemradio", { name: "Last created" }),
  );
  await waitFor(() =>
    expect(view.listRules).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: "createdAt",
        order: "desc",
        cursor: undefined,
      }),
      expect.anything(),
    ),
  );
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft).toHaveValue("Keep this draft");
  expect(view.patchRule).not.toHaveBeenCalled();
  await userEvent.click(group.getByRole("button", { name: "New alert" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Keep editing" }),
  );
  expect(draft).toHaveValue("Keep this draft");
  await userEvent.click(group.getByRole("button", { name: "New alert" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  expect(await screen.findByText("Configuration: New rule")).toBeVisible();
  expect(view.router.state.location.pathname).toBe("/app/alerts/new");
});

test("a monitored rule's rail icon pauses it through the same guarded action", async () => {
  const view = mount();
  await screen.findByText("Observed a breakout");
  const rail = screen.getByRole("group", { name: "Alerts" });
  const icon = await within(rail).findByRole("button", {
    name: `Pause ${rule.name}: Monitoring`,
  });
  expect(
    within(rail).getByRole("link", { name: /Price crossing/ }),
  ).not.toContainElement(icon);
  view.listRules.mockResolvedValue({
    items: [{ ...rule, enabled: false, revision: 2 }],
    nextCursor: null,
  });
  await userEvent.click(icon);
  await waitFor(() =>
    expect(view.patchRule).toHaveBeenCalledWith({
      id: rule.id,
      expectedRevision: 1,
      operations: [{ op: "replace", path: "/enabled", value: false }],
    }),
  );
  await within(rail).findByRole("button", {
    name: `Enable ${rule.name}: Paused`,
  });
  expect(view.router.state.location.pathname).toBe("/app/feed");
});

test("a failing rule's rail icon explains why and opens a persistent banner", async () => {
  const failure = {
    state: "failed",
    reason: {
      code: "tea.upstream",
      message: "Binance stream disconnected.",
    },
  };
  mount("/app/feed", true, [rule], undefined, [
    {
      key: `alert/${rule.id}`,
      label: rule.name,
      health: failure,
      since: 0,
      checks: [
        { label: "Alert evaluation", health: failure, since: 0, lastOkAt: 0 },
      ],
    },
  ]);
  const rail = await screen.findByRole("group", { name: "Alerts" });
  const icon = await within(rail).findByRole("link", {
    name: `Open ${rule.name}: Not monitoring: Binance stream disconnected.`,
  });
  await userEvent.click(icon);
  const line = await screen.findByRole("button", {
    name: /^This alert isn't monitoring · Binance stream disconnected · since .+ · retrying$/,
  });
  // A polite status region: persistent problems never interrupt a screen reader.
  expect(
    screen.getAllByRole("status").some((region) => region.contains(line)),
  ).toBe(true);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  // Details open on click or tap, not only hover.
  await userEvent.click(line);
  const details = await screen.findByRole("dialog");
  expect(details).toHaveTextContent(
    "Alert evaluation: Binance stream disconnected.",
  );
  expect(details).toHaveTextContent("Retrying automatically");
  expect(screen.getByRole("button", { name: "Pause alert" })).toBeEnabled();
});
