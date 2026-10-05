// Purpose: Verify library search creates and opens ordinary Sessions only on Send.
import {
  AuiConfig,
  AuiProvider,
  ModelContextClient,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext, useState, type ComponentProps } from "react";

import { IndicatorLibraryProvider } from "@openchart/app/app/indicator-library/indicator-library";
import { IndicatorLibraryNavigation } from "@openchart/app/lib/indicator-library/indicator-library";
import { WorkspaceFileNavigation } from "@openchart/app/lib/workspace/workspace";
import type { IndicatorLibraryContent } from "@openchart/app/features/chart/components/indicator-picker";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import type { ModelSelection } from "@openchart/app/lib/agent/client";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  create: vi.fn(),
  submit: vi.fn(),
  openFile: vi.fn(),
  defaultWorkspace: vi.fn(),
  defaultModel: { providerID: "codex", modelID: "tier4" } as
    ModelSelection | undefined,
}));

vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));

vi.mock("@openchart/app/lib/agent/provider", () => ({
  useAgentContext: () => ({
    agent: {
      defaultModel: mocks.defaultModel,
      createSession: { mutateAsync: mocks.create },
      submitPrompt: { mutateAsync: mocks.submit },
    },
  }),
}));

vi.mock("@openchart/app/features/chart/components/indicator-picker", () => ({
  IndicatorLibraryContent: (
    props: ComponentProps<typeof IndicatorLibraryContent>,
  ) => {
    const openFile = useContext(WorkspaceFileNavigation)!;
    const file = { workspaceId: "wsp_research", path: "studies/my-rsi.tea" };
    return (
      <div>
        <nav aria-label="Library navigation">
          <button type="button">Library section</button>
        </nav>
        <h1>What are you looking for?</h1>
        {props.composer}
        <output aria-label="Filtered query">{props.query}</output>
        <button onClick={() => props.onModifyScript(file)}>
          Modify my script
        </button>
        <button onClick={() => openFile(file)}>Open my script</button>
      </div>
    );
  },
}));

function OpenLibrary() {
  const show = useContext(IndicatorLibraryNavigation)!;
  const [clicks, setClicks] = useState(0);
  return (
    <>
      <button
        onClick={() =>
          show({
            chartId: "cht_first",
            cellId: "ccl_first",
            openFile: mocks.openFile,
          })
        }
      >
        Open library
      </button>
      <button onClick={() => setClicks((count) => count + 1)}>
        Outside action {clicks}
      </button>
    </>
  );
}

function mount() {
  const transport = {
    url: "http://library.test",
    rpc: {
      resources: {
        workspace: { getDefault: { query: mocks.defaultWorkspace } },
      },
    },
  } as unknown as AppTransport;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const context = AuiConfig({ modelContext: ModelContextClient() });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuiProvider config={context}>
        <IndicatorLibraryProvider transport={transport}>
          <OpenLibrary />
        </IndicatorLibraryProvider>
      </AuiProvider>
    </QueryClientProvider>,
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open library" }));
  const input = screen.getByRole("textbox", {
    name: "Search studies or create your own",
  });
  await waitFor(() => expect(input).toBeEnabled());
  return input;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.defaultModel = { providerID: "codex", modelID: "tier4" };
  mocks.create.mockResolvedValue({ id: "ses_library" });
  mocks.submit.mockResolvedValue(undefined);
  mocks.defaultWorkspace.mockResolvedValue("wsp_default");
});

test("typing searches without execution; IME Enter does nothing and Enter sends the original draft", async () => {
  const user = userEvent.setup();
  mount();
  const input = await open(user);
  expect(input).toHaveFocus();
  await user.type(input, "Make a faster EMA");
  expect(screen.getByLabelText("Filtered query")).toHaveTextContent(
    "Make a faster EMA",
  );
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(mocks.create).not.toHaveBeenCalled();
  await user.type(input, "{Enter}");
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(mocks.create).toHaveBeenCalledWith({});
  expect(mocks.submit).toHaveBeenCalledWith({
    sessionID: "ses_library",
    draft: { text: "Make a faster EMA", attachments: [], quote: undefined },
    model: { providerID: "codex", modelID: "tier4" },
    workspaceId: "wsp_default",
    viewContext: expect.stringContaining("chart cht_first, cell ccl_first"),
  });
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
    "/app/sessions/ses_library",
  );
  expect(mocks.navigate.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.submit.mock.invocationCallOrder[0]!,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "What are you looking for?" }),
  ).not.toBeInTheDocument();
});

test("modification only prefills; sending keeps the exact source and its workspace", async () => {
  const user = userEvent.setup();
  mount();
  const input = await open(user);
  await user.click(screen.getByRole("button", { name: "Open my script" }));
  expect(mocks.openFile).toHaveBeenCalledWith({
    workspaceId: "wsp_research",
    path: "studies/my-rsi.tea",
  });
  await user.click(screen.getByRole("button", { name: "Modify my script" }));
  expect(input).toHaveValue("Modify the indicator in @studies/my-rsi.tea: ");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  await user.type(input, "Use a shorter length");
  await user.click(
    screen.getByRole("button", { name: "Start a conversation" }),
  );
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  const request = mocks.submit.mock.calls[0]![0];
  expect(request.workspaceId).toBe("wsp_research");
  expect(request.viewContext).toContain(
    "workspace wsp_research, exact path studies/my-rsi.tea",
  );
  expect(request.draft.text).toBe(
    "Modify the indicator in @studies/my-rsi.tea: Use a shorter length",
  );
});

test("closing releases focus and pointer locks while reopening retains the unsent search draft", async () => {
  const user = userEvent.setup();
  mount();
  const input = await open(user);
  await user.type(input, "Create an EMA");
  await user.click(screen.getByRole("button", { name: /^Close$/ }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(document.body).not.toHaveStyle({ pointerEvents: "none" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Open library" })).toHaveFocus(),
  );
  await user.click(screen.getByRole("button", { name: "Outside action 0" }));
  expect(
    screen.getByRole("button", { name: "Outside action 1" }),
  ).toBeInTheDocument();
  expect(await open(user)).toHaveValue("Create an EMA");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

test("failed Session creation preserves the editable search draft for explicit retry", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Session creation unavailable"));
  const user = userEvent.setup();
  mount();
  const input = await open(user);
  await user.type(input, "Mark a reversal{Enter}");
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  await waitFor(() => expect(input).toHaveValue("Mark a reversal"));
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Start a conversation" }),
  );
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(mocks.create).toHaveBeenCalledTimes(2);
});

test("search stays editable without an available model, while both Enter and Send remain disabled", async () => {
  mocks.defaultModel = undefined;
  const user = userEvent.setup();
  mount();
  const input = await open(user);
  await user.type(input, "RSI{Enter}");
  expect(input).toHaveValue("RSI");
  expect(screen.getByLabelText("Filtered query")).toHaveTextContent("RSI");
  expect(
    screen.getByRole("button", { name: "Start a conversation" }),
  ).toBeDisabled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

test("a failed default Workspace read keeps search available and offers retry before admitting work", async () => {
  mocks.defaultWorkspace.mockRejectedValueOnce(
    new Error("Workspace unavailable"),
  );
  const user = userEvent.setup();
  mount();
  const input = await open(user);
  await user.type(input, "EMA");
  expect(
    screen.getByRole("button", { name: "Start a conversation" }),
  ).toBeDisabled();
  expect(mocks.create).not.toHaveBeenCalled();
  await user.click(
    await screen.findByRole("button", { name: "Retry workspace" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Start a conversation" }),
    ).toBeEnabled(),
  );
  await user.type(input, "{Enter}");
  await waitFor(() =>
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "wsp_default" }),
    ),
  );
});

test("a failed submission stays on the new Session with its source context handed to the shared Agent", async () => {
  mocks.submit.mockRejectedValueOnce(new Error("Prompt admission unavailable"));
  const user = userEvent.setup();
  mount();
  await open(user);
  await user.click(screen.getByRole("button", { name: "Modify my script" }));
  await user.click(
    screen.getByRole("button", { name: "Start a conversation" }),
  );
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
    "/app/sessions/ses_library",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionID: "ses_library",
      workspaceId: "wsp_research",
      viewContext: expect.stringContaining(
        "workspace wsp_research, exact path studies/my-rsi.tea",
      ),
    }),
  );
  expect(await open(user)).toHaveValue("");
});
