// Purpose: Research columns round-trip shared Composer prompts and render cell answers from their bound Sessions.
import { useState } from "react";
import {
  QueryClientProvider,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BehaviorSubject } from "rxjs";
import fastJsonPatch from "fast-json-patch";
import { defineId } from "@openchart/identifier";

import { WatchlistAgent } from "../watchlist-agent";
import { CopilotControlsProvider } from "@openchart/app/app/agent/copilot-controls";
import { SemanticColumnDialog } from "@openchart/app/features/watchlist/components/semantic-column-dialog";
import { SemanticProvider } from "@openchart/app/features/watchlist/components/semantic-context";
import { SemanticCell } from "@openchart/app/features/watchlist/components/semantic-cell";
import {
  WatchlistPlacementContext,
  type SemanticValues,
} from "@openchart/app/features/watchlist/components/context";
import {
  watchlistMutation,
  watchlistDetail,
  type Watchlist,
} from "@openchart/app/features/watchlist/api/queries";
import { createWatchlistViewStore } from "@openchart/app/features/watchlist/stores/view";
import { columnTitle } from "@openchart/app/features/watchlist/utils/columns";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import type {
  AgentInputs,
  AppTransport,
} from "@openchart/app/lib/transport/transport";
import {
  renderWithToaster as render,
  findErrorToast,
} from "@openchart/app/testing/test-utils";

const mocks = vi.hoisted(() => ({
  widget: vi.fn(),
  submit: vi.fn(),
  bind: vi.fn(),
  select: vi.fn(),
  patch: vi.fn(),
  bound: vi.fn(),
  getSession: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@openchart/app/hooks/use-widget", () => ({ useWidget: mocks.widget }));
vi.mock("@openchart/app/lib/agent/provider", () => ({
  useAgentContext: () => ({
    agent: {
      getSession: mocks.getSession,
      defaultModel: { providerID: "codex", modelID: "tier1" },
      modelProviders: {
        data: [
          {
            id: "codex",
            name: "Codex",
            models: [
              {
                id: "tier1",
                tier: 1,
                providerID: "codex",
                name: "Fast model",
                availableVariants: ["high"],
              },
            ],
          },
        ],
        isPending: false,
        isError: false,
      },
      providerSetup: [],
      commands: { data: [], isPending: false, isError: false },
      submitPrompt: { mutateAsync: mocks.submit },
      getOrCreateBoundSession: { mutateAsync: mocks.bind },
    },
  }),
}));
vi.mock("@openchart/app/lib/agent/use-bound-session", () => ({
  useBoundSession: mocks.bound,
}));

const answer =
  "# Product launch\n\nA product launch is expected. [Company announcement](https://example.com/launch).";
beforeEach(() => {
  mocks.getSession.mockReturnValue({ cancel: mocks.cancel });
  mocks.bound.mockReturnValue({
    session: { id: "ses_research" },
    loading: false,
    snapshot: {
      messages: [
        { id: "msg_question", role: "user", content: "Summarize Q3 catalysts" },
        {
          id: "msg_answer",
          role: "assistant",
          content: answer,
        },
        { id: "msg_follow_up", role: "user", content: "Why?" },
        { id: "msg_chat", role: "assistant", content: "Because of demand." },
      ],
    },
  });
});

const prompt: AgentInputs["prompt"]["input"] = {
  agent: "analyst",
  workspaceId: "wsp_research",
  model: { providerID: "codex", modelID: "tier1", selectedVariant: "high" },
  parts: [
    {
      type: "context",
      context: { kind: "quote", text: "Focus on the next quarter." },
    },
    { type: "text", text: "Summarize catalysts" },
  ],
};
const column: Watchlist["columns"][number] = {
  id: defineId("wcl", "WatchlistColumn.ID").make("wcl_research"),
  title: "Catalysts",
  visible: true,
  metric: { kind: "semantic", prompt: JSON.parse(JSON.stringify(prompt)) },
};
const client = createQueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
afterEach(() => {
  client.clear();
  vi.resetAllMocks();
});

function setup(editingInitially = true, creating = false) {
  let saved: Watchlist = {
    id: defineId("wtl", "Watchlist.ID").make("wtl_research"),
    name: "Research",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    columns: creating ? [] : [column],
    sections: [],
  };
  const semanticValues = new BehaviorSubject<SemanticValues>({});
  const transport = {
    url: "watchlist-composer-test",
    rpc: {
      resources: {
        watchlist: {
          get: { query: async () => saved },
          patch: { mutate: mocks.patch },
        },
        workspace: {
          get: {
            query: async () => ({ id: "wsp_research", root: "/research" }),
          },
          list: { query: async () => ({ items: [], nextCursor: null }) },
        },
      },
    },
  } as unknown as AppTransport;
  mocks.widget.mockReturnValue({ transport });
  mocks.bind.mockResolvedValue({ id: "ses_column" });
  mocks.submit.mockResolvedValue({
    id: "agr_research",
    status: "queued",
    createdAt: 100,
  });
  mocks.patch.mockImplementation(async ({ operations }) => {
    saved = {
      ...fastJsonPatch.applyPatch(JSON.parse(JSON.stringify(saved)), operations)
        .newDocument,
      revision: saved.revision + 1,
    };
    return saved;
  });
  function Host() {
    const [editing, setEditing] = useState(editingInitially);
    const queryClient = useQueryClient();
    const save = useMutation(
      watchlistMutation(transport, queryClient, saved.id),
    );
    return (
      <WatchlistPlacementContext.Provider
        value={{
          watchlistId: saved.id,
          save,
          view: createWatchlistViewStore("test-research"),
          quotes: new BehaviorSubject({}),
          crosshair: new BehaviorSubject<number | null>(null),
          formulaValues: new BehaviorSubject({}),
          semanticValues,
          addFormula: vi.fn(),
          configureFormula: vi.fn(),
          addSymbol: vi.fn(),
          openDialog: vi.fn(),
          switchTo: vi.fn(),
        }}
      >
        <SemanticProvider watchlist={saved}>
          <button onClick={() => setEditing(true)}>Edit column</button>
          {editing ? (
            <SemanticColumnDialog
              column={creating ? undefined : saved.columns[0]}
              onClose={() => setEditing(false)}
            />
          ) : null}
          {saved.columns[0]?.metric.kind === "semantic" ? (
            <SemanticCell
              columnId={saved.columns[0].id}
              itemId="wit_apple"
              title={columnTitle(saved.columns[0])}
            />
          ) : null}
        </SemanticProvider>
      </WatchlistPlacementContext.Provider>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <CopilotControlsProvider
        value={{
          open: false,
          toggle: vi.fn(),
          prefill: vi.fn(),
          selectSession: mocks.select,
        }}
      >
        <WatchlistAgent>
          <Host />
        </WatchlistAgent>
      </CopilotControlsProvider>
    </QueryClientProvider>,
  );
  return {
    saved: () => saved,
    semanticValues,
    updateColumn: (title: string) => {
      saved = {
        ...saved,
        revision: saved.revision + 1,
        columns: [{ ...column, title }],
      };
      client.setQueryData(watchlistDetail(transport, saved.id).queryKey, saved);
    },
  };
}

test("creating the first research column saves once and submits one full-column workflow", async () => {
  const fixture = setup(true, true);
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("textbox", { name: "Prompt" }),
    "Say hello",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Column name" }),
    "Greeting",
  );
  await user.click(screen.getByRole("button", { name: "Save column" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.patch).toHaveBeenCalledOnce();
  const created = fixture.saved().columns[0]!;
  expect(created.metric.kind).toBe("semantic");
  if (created.metric.kind !== "semantic")
    throw new Error("Expected saved prompt");
  expect(mocks.submit).toHaveBeenCalledWith({
    ...created.metric.prompt,
    sessionID: "ses_column",
    parts: [
      {
        type: "workflow",
        workflow: "default:workflows/watchlist-semantic-column.workflow.ts",
        args: {
          watchlistId: "wtl_research",
          columnId: created.id,
          prompt: created.metric.prompt,
        },
      },
    ],
  });
});

test("a failed new-column save retains the draft and submits nothing", async () => {
  setup(true, true);
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("textbox", { name: "Prompt" }),
    "Say hello",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Column name" }),
    "Greeting",
  );
  mocks.patch.mockRejectedValueOnce(new Error("Offline"));
  await user.click(screen.getByRole("button", { name: "Save column" }));
  await findErrorToast("Offline");
  expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveTextContent(
    "Say hello",
  );
  expect(mocks.bind).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

test("failed batch admission keeps the saved column available for retry", async () => {
  const fixture = setup(true, true);
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("textbox", { name: "Prompt" }),
    "Say hello",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Column name" }),
    "Greeting",
  );
  mocks.submit.mockRejectedValueOnce(new Error("Agent unavailable"));
  await user.click(screen.getByRole("button", { name: "Save column" }));
  await findErrorToast("Agent unavailable");
  expect(fixture.saved().columns).toHaveLength(1);
  expect(mocks.patch).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Refresh Greeting" }),
  ).toBeEnabled();
});

test("an accepted row stays queued before streamed state arrives and cannot be submitted twice", async () => {
  mocks.bound.mockReturnValue({ loading: false, snapshot: { messages: [] } });
  setup(false);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(
    screen.getByRole("status", { name: "Catalysts research progress" }),
  ).toHaveTextContent("Queued…");
  expect(
    screen.queryByRole("button", { name: "Generate" }),
  ).not.toBeInTheDocument();
});

test.each(["completed", "failed", "cancelled"])(
  "a streamed %s run releases the admission receipt",
  async (status) => {
    mocks.bound.mockReturnValue({
      loading: false,
      snapshot: {
        messages: [],
        state: { runs: [], questions: [], permissions: [] },
      },
    });
    setup(false);
    mocks.submit.mockImplementation(async () => {
      mocks.bound.mockReturnValue({
        loading: false,
        snapshot: {
          messages: [],
          state: {
            runs: [{ id: "agr_research", status }],
            questions: [],
            permissions: [],
          },
        },
      });
      return { id: "agr_research", status: "queued", createdAt: 100 };
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled(),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  },
);

test.each([undefined, ["wit_apple"], ["wit_other"]])(
  "restores waiting rows from the running workflow's targets: %j",
  (itemIds) => {
    mocks.bound.mockImplementation((_transport, binding: string) =>
      binding.endsWith(":item:wit_apple")
        ? { loading: false, snapshot: { messages: [] } }
        : {
            session: { id: "ses_column" },
            loading: false,
            progress: { status: "running", lines: [] },
            snapshot: {
              state: {
                runs: [
                  { id: "agr_research", status: "running", createdAt: 100 },
                ],
              },
              messages: [
                {
                  role: "user",
                  metadata: {
                    openchart: { createdAt: 101 },
                    parts: [
                      {
                        type: "workflow",
                        workflow:
                          "default:workflows/watchlist-semantic-column.workflow.ts",
                        args: {
                          watchlistId: "wtl_research",
                          columnId: column.id,
                          itemIds,
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
    );
    setup(false);
    if (itemIds?.includes("wit_other")) {
      expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } else {
      expect(
        screen.getByRole("status", { name: "Catalysts research progress" }),
      ).toHaveTextContent("Queued…");
      expect(
        screen.queryByRole("button", { name: "Generate" }),
      ).not.toBeInTheDocument();
    }
  },
);

test("saves and restores the complete shared Composer prompt without starting research", async () => {
  const fixture = setup();
  const user = userEvent.setup();
  expect(
    await screen.findByRole("textbox", { name: "Prompt" }),
  ).toHaveTextContent("Summarize catalysts");
  expect(screen.getByText("Focus on the next quarter.")).toBeInTheDocument();
  const name = screen.getByRole("textbox", { name: "Column name" });
  await user.clear(name);
  await user.type(name, "Next catalysts");
  await user.click(screen.getByRole("button", { name: "Save column" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(fixture.saved().columns[0]).toEqual({
    ...column,
    title: "Next catalysts",
  });
  expect(mocks.patch).toHaveBeenCalledWith(
    expect.objectContaining({ expectedRevision: 1 }),
  );
  expect(mocks.bind).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Edit column" }));
  expect(
    await screen.findByRole("textbox", { name: "Prompt" }),
  ).toHaveTextContent("Summarize catalysts");
  expect(screen.getByRole("textbox", { name: "Column name" })).toHaveValue(
    "Next catalysts",
  );
});

test("retains a failed Composer draft, opens the bound Session's transcript, and refreshes with the saved prompt", async () => {
  const fixture = setup();
  const user = userEvent.setup();
  const input = await screen.findByRole("textbox", { name: "Prompt" });
  await user.clear(input);
  await user.type(input, "Summarize risks");
  mocks.patch.mockRejectedValueOnce(new Error("Offline"));
  await user.click(screen.getByRole("button", { name: "Save column" }));
  await findErrorToast("Offline");
  expect(input).toHaveTextContent("Summarize risks");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Product launch" }));
  expect(mocks.select).toHaveBeenCalledExactlyOnceWith("ses_research");
  expect(mocks.bound().snapshot.messages[1].content).toBe(answer);
  expect(fixture.semanticValues.value).toEqual({
    wit_apple: { [column.id]: "Product launch" },
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Refresh Catalysts" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(mocks.submit).toHaveBeenCalledWith({
    ...prompt,
    sessionID: "ses_column",
    parts: [
      {
        type: "workflow",
        workflow: "default:workflows/watchlist-semantic-column.workflow.ts",
        args: {
          watchlistId: "wtl_research",
          columnId: column.id,
          itemIds: ["wit_apple"],
          prompt,
        },
      },
    ],
  });
});

test("shows live progress without opening a result dialog or navigating to a thread", async () => {
  mocks.bound.mockReturnValue({
    session: { id: "ses_refresh" },
    loading: false,
    snapshot: {
      messages: [
        { id: "partial", role: "assistant", content: "Checking the filing." },
      ],
    },
    progress: {
      lines: ["Searching company announcements", "Reading the filing"],
    },
  });
  const fixture = setup(false);
  const user = userEvent.setup();
  const progress = screen.getByRole("status", {
    name: "Catalysts research progress",
  });
  expect(progress).toHaveTextContent("Reading the filing");
  expect(
    screen.queryByRole("button", { name: "Product launch" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Open .*research|Refresh Catalysts/ }),
  ).not.toBeInTheDocument();
  await user.click(progress);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(fixture.semanticValues.value).toEqual({});
});

test.each(["failed", "cancelled"])(
  "a %s workflow span offers a retry instead of showing partial prose",
  async (execution) => {
    mocks.bound.mockReturnValue({
      session: { id: "ses_incomplete" },
      loading: false,
      execution,
      snapshot: {
        messages: [
          {
            id: "msg_answer",
            role: "assistant",
            content: "I will check the company's filings.",
          },
        ],
      },
    });
    const fixture = setup(false);
    expect(
      await screen.findByRole("button", {
        name: execution === "failed" ? "Failed · retry" : "Stopped · retry",
      }),
    ).toBeInTheDocument();
    expect(fixture.semanticValues.value).toEqual({});
  },
);

test("a completed empty answer stays inspectable without publishing a sort value", async () => {
  mocks.bound.mockReturnValue({
    session: { id: "ses_empty" },
    loading: false,
    execution: "completed",
    snapshot: { messages: [] },
  });
  const fixture = setup(false);
  await userEvent.setup().click(screen.getByRole("button", { name: "—" }));
  expect(mocks.select).toHaveBeenCalledExactlyOnceWith("ses_empty");
  expect(fixture.semanticValues.value).toEqual({});
});

test("a concurrent column edit cannot overwrite the saved prompt", async () => {
  const fixture = setup();
  const user = userEvent.setup();
  const composer = await screen.findByRole("textbox", { name: "Prompt" });
  await user.clear(composer);
  await user.type(composer, "My updated research question");
  const input = screen.getByRole("textbox", { name: "Column name" });
  await user.clear(input);
  await user.type(input, "My draft");
  await screen.findByRole("textbox", { name: "Prompt" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save column" })).toBeEnabled(),
  );
  fixture.updateColumn("Another editor");
  await user.click(screen.getByRole("button", { name: "Save column" }));
  await findErrorToast(
    "This column changed while you were editing. Reopen it to load the saved settings.",
  );
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(input).toHaveValue("My draft");
  expect(fixture.saved().columns[0]?.title).toBe("Another editor");
});

test.each(["ses_child_followup", "ses_external_parent"])(
  "Stop cancels the active execution owner %s",
  async (executionSessionId) => {
    mocks.bound.mockImplementation((_transport, binding: string) =>
      binding.endsWith(":item:wit_apple")
        ? {
            session: { id: "ses_cell", parentId: "ses_external_parent" },
            executionSessionId,
            loading: false,
            snapshot: { messages: [] },
            progress: { status: "running", lines: ["Researching"] },
          }
        : {
            session: { id: "ses_column" },
            snapshot: { messages: [] },
            loading: false,
          },
    );
    setup(false);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Stop Catalysts research" }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce());
    expect(mocks.getSession).toHaveBeenCalledWith(executionSessionId);
  },
);
