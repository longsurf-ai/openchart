import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
// Purpose: Verify tab-header file actions follow the live tab, save through the editor's registry and contribute app actions only for Tea files.
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import type {
  DockviewApi,
  IDockviewPanel,
  IDockviewPanelProps,
} from "dockview-react";
import { createTransport } from "@openchart/app/lib/transport/transport";
import { WorkspaceFileActions } from "@openchart/app/lib/workspace/workspace";
import { WorkspaceContext } from "@openchart/app/features/workspace/components/context";
import { FileActions } from "@openchart/app/features/workspace/components/file-actions";
import {
  FilePanel,
  type FilePanelParams,
} from "@openchart/app/features/workspace/components/file-panel/file-panel";

const rpc = vi.hoisted(() => ({
  resources: { workspace: { get: { query: vi.fn() } } },
  workspace: {
    read: { query: vi.fn() },
    write: { mutate: vi.fn() },
    listDirectory: { query: vi.fn() },
  },
}));
vi.mock("@trpc/client", async (original) => ({
  ...(await original<typeof import("@trpc/client")>()),
  createTRPCClient: () => rpc,
}));
vi.mock(
  "@openchart/app/features/workspace/components/file-panel/code-editor",
  () => ({
    default: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (value: string) => void;
    }) => (
      <textarea
        aria-label="Code"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  }),
);
vi.mock(
  "@openchart/app/features/workspace/components/file-panel/markdown-editor",
  () =>
    import("@openchart/app/features/workspace/components/file-panel/code-editor"),
);
afterEach(() => {
  vi.resetAllMocks();
});

const disk = (text: string, path: string, readOnly = false) => ({
  entry: { path, hash: text },
  mediaType: "text/plain",
  readOnly,
  base64: Buffer.from(text, "utf8").toString("base64"),
});
/** A Dockview panel whose params change like Dockview's: merged, then announced. */
function fakePanel(params: FilePanelParams) {
  const listeners = new Set<() => void>();
  const id = `${params.workspaceId}/${params.path}`;
  const panel = {
    id,
    params,
    api: {
      id,
      setTitle: vi.fn(),
      updateParameters: (next: Partial<FilePanelParams>) => {
        panel.params = { ...panel.params, ...next };
        listeners.forEach((listener) => listener());
      },
      onDidParametersChange: (listener: () => void) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
  };
  return panel;
}
function setup(
  path: string,
  {
    readOnly = false,
    editor = true,
    extraActions,
  }: {
    readOnly?: boolean;
    editor?: boolean;
    extraActions?: Parameters<typeof WorkspaceFileActions.Provider>[0]["value"];
  } = {},
) {
  rpc.resources.workspace.get.query.mockResolvedValue({ root: "/workspace" });
  rpc.workspace.read.query.mockResolvedValue(disk("original", path, readOnly));
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const transport = createTransport({ origin: "http://127.0.0.1:41000" });
  const panel = fakePanel({ workspaceId: "wsp_test", path });
  const containerApi = { getPanel: vi.fn(), addPanel: vi.fn() };
  const openReference = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <WorkspaceContext.Provider
        value={{
          transport,
          languageError: undefined,
          onLanguageError: vi.fn(),
          teaSessions: { current: new Map() },
          openReference,
          saves: { current: new Map() },
          instanceId: "test",
          collapsible: false,
          dark: false,
        }}
      >
        <WorkspaceFileActions.Provider value={extraActions ?? null}>
          <FileActions
            panel={panel as unknown as IDockviewPanel}
            containerApi={containerApi as unknown as DockviewApi}
          />
          {editor ? (
            <FilePanel
              {...({
                api: panel.api,
                params: panel.params,
                containerApi,
              } as unknown as IDockviewPanelProps<FilePanelParams>)}
            />
          ) : null}
        </WorkspaceFileActions.Provider>
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  );
  return {
    containerApi,
    openReference,
    cleanup: () => {
      view.unmount();
      client.clear();
    },
  };
}

test("Save shows only while the tab is dirty and writes the draft with its CAS hash", async () => {
  const { cleanup } = setup("main.tea");
  const editor = await screen.findByRole("textbox", { name: "Code" });
  expect(
    screen.queryByRole("button", { name: "Save" }),
  ).not.toBeInTheDocument();
  fireEvent.change(editor, { target: { value: "draft" } });
  rpc.workspace.write.mutate.mockResolvedValue(disk("draft", "main.tea").entry);
  rpc.workspace.read.query.mockResolvedValue(disk("draft", "main.tea"));
  // One size with the tab bar's 32px Toggle files and view actions.
  for (const name of ["Save", "Copy path", "Duplicate"])
    expect(await screen.findByRole("button", { name })).toHaveClass("size-8");
  fireEvent.click(await screen.findByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument(),
  );
  expect(rpc.workspace.write.mutate).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "wsp_test",
    path: "main.tea",
    text: "draft",
    expected: "original",
  });
  cleanup();
});

test("Copy path copies the Workspace-relative path", async () => {
  const user = userEvent.setup();
  const { cleanup } = setup("indicators/rsi.tea", { editor: false });
  const copy = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  await user.click(screen.getByRole("button", { name: "Copy path" }));
  expect(copy).toHaveBeenCalledExactlyOnceWith("indicators/rsi.tea");
  cleanup();
});

test("Duplicate creates the copy under a free name without overwriting, then opens it", async () => {
  rpc.workspace.listDirectory.query.mockResolvedValue({
    status: "ready",
    entries: [
      { path: "indicators/rsi.tea" },
      { path: "indicators/rsi-copy.tea" },
    ],
    directories: ["indicators/rsi-copy-2.tea"],
  });
  rpc.workspace.write.mutate.mockResolvedValue({});
  const { containerApi, cleanup } = setup("indicators/rsi.tea", {
    editor: false,
  });
  fireEvent.click(await screen.findByRole("button", { name: "Duplicate" }));
  await waitFor(() => expect(containerApi.addPanel).toHaveBeenCalledOnce());
  expect(rpc.workspace.write.mutate).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "wsp_test",
    path: "indicators/rsi-copy-3.tea",
    text: "original",
    expected: null,
  });
  expect(containerApi.addPanel).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "wsp_test/indicators/rsi-copy-3.tea",
      params: { workspaceId: "wsp_test", path: "indicators/rsi-copy-3.tea" },
    }),
  );
  cleanup();
});

test("a read-only built-in offers Duplicate to edit", async () => {
  const { cleanup } = setup("indicators/builtin/sma.tea", {
    readOnly: true,
    editor: false,
  });
  expect(
    await screen.findByRole("button", { name: "Duplicate to edit" }),
  ).toBeInTheDocument();
  cleanup();
});

test.each([
  ["notes.md", ["Copy path", "Duplicate"]],
  ["chart.png", ["Copy path"]],
  ["tea-lib:/std/ta.tea", []],
])("%s gets no app-provided action", (path, names) => {
  const extraActions = vi.fn(() => <button type="button">Add to chart</button>);
  const { cleanup } = setup(path, { editor: false, extraActions });
  expect(
    screen.queryAllByRole("button").map((button) => button.textContent),
  ).toEqual(names);
  expect(extraActions).not.toHaveBeenCalled();
  cleanup();
});

test("a .tea tab renders the app-provided action, whose prepare() saves the dirty draft first", async () => {
  const steps: string[] = [];
  const { cleanup } = setup("rsi.tea", {
    extraActions: (file, prepare) => (
      <button
        type="button"
        onClick={async () => {
          await prepare();
          steps.push(`add ${file.workspaceId}/${file.path}`);
        }}
      >
        Add to chart
      </button>
    ),
  });
  const editor = await screen.findByRole("textbox", { name: "Code" });
  fireEvent.click(screen.getByRole("button", { name: "Add to chart" }));
  await waitFor(() => expect(steps).toEqual(["add wsp_test/rsi.tea"]));
  expect(rpc.workspace.write.mutate).not.toHaveBeenCalled();
  fireEvent.change(editor, { target: { value: "draft" } });
  rpc.workspace.write.mutate.mockImplementation(async () => {
    steps.push("save");
    return disk("draft", "rsi.tea").entry;
  });
  rpc.workspace.read.query.mockResolvedValue(disk("draft", "rsi.tea"));
  fireEvent.click(screen.getByRole("button", { name: "Add to chart" }));
  await waitFor(() =>
    expect(steps).toEqual([
      "add wsp_test/rsi.tea",
      "save",
      "add wsp_test/rsi.tea",
    ]),
  );
  expect(rpc.workspace.write.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ text: "draft", expected: "original" }),
  );
  cleanup();
});

test("a failed save rejects prepare(), so the app action stops and the save's toast is the only one", async () => {
  const steps: string[] = [];
  function AddAction({ prepare }: { prepare: () => Promise<void> }) {
    const add = useMutation({
      meta: { errorTitle: "Couldn’t add indicator" },
      mutationFn: async () => {
        await prepare();
        steps.push("add");
      },
      onError: () => steps.push("stopped"),
    });
    return (
      <button type="button" onClick={() => add.mutate()}>
        Add to chart
      </button>
    );
  }
  const { cleanup } = setup("rsi.tea", {
    extraActions: (_file, prepare) => <AddAction prepare={prepare} />,
  });
  const editor = await screen.findByRole("textbox", { name: "Code" });
  fireEvent.change(editor, { target: { value: "draft" } });
  rpc.workspace.write.mutate.mockRejectedValue(new Error("conflict"));
  fireEvent.click(screen.getByRole("button", { name: "Add to chart" }));
  await waitFor(() => expect(steps).toEqual(["stopped"]));
  expect(
    toast
      .getToasts()
      .filter(
        (item) => "description" in item && item.description === "conflict",
      ),
  ).toHaveLength(1);
  expect(editor).toHaveValue("draft");
  cleanup();
});

test("a .tea tab opens the view's Tea reference", async () => {
  const { openReference, cleanup } = setup("main.tea", { editor: false });
  fireEvent.click(await screen.findByRole("button", { name: "Tea reference" }));
  expect(openReference).toHaveBeenCalledExactlyOnceWith();
  cleanup();
});

test("only a .tea tab offers the Tea reference", async () => {
  const { cleanup } = setup("notes.md", { editor: false });
  await screen.findByRole("button", { name: "Copy path" });
  expect(
    screen.queryByRole("button", { name: "Tea reference" }),
  ).not.toBeInTheDocument();
  cleanup();
});
