import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import { findErrorToast } from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
// Purpose: Verify draft preservation, disk-hash saves and the path breadcrumb independently of Monaco's browser runtime.
import { QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  screen,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { createTransport } from "@openchart/app/lib/transport/transport";
import {
  workspaceFileQueryOptions,
  WorkspaceFileMerge,
} from "@openchart/app/lib/workspace/workspace";
import { WorkspaceContext } from "@openchart/app/features/workspace/components/context";
import {
  FilePanel,
  type FilePanelParams,
} from "@openchart/app/features/workspace/components/file-panel/file-panel";

const rpc = vi.hoisted(() => ({
  resources: { workspace: { get: { query: vi.fn() } } },
  workspace: { read: { query: vi.fn() }, write: { mutate: vi.fn() } },
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
      readOnly,
      wordWrap,
    }: {
      value: string;
      readOnly?: boolean;
      wordWrap?: boolean;
      onChange: (value: string) => void;
    }) => (
      <textarea
        aria-label="Code"
        readOnly={readOnly}
        wrap={wordWrap ? "soft" : "off"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
      />
    ),
  }),
);
vi.mock(
  "@openchart/app/features/workspace/components/file-panel/markdown-editor",
  () =>
    import("@openchart/app/features/workspace/components/file-panel/code-editor"),
);
vi.mock(
  "@openchart/app/features/workspace/components/file-panel/pdf-preview",
  () => ({
    default: ({ url }: { url: string }) => <iframe title="PDF" src={url} />,
  }),
);
const disk = (text: string, path = "main.tea") => ({
  entry: { path, hash: text },
  mediaType: "text/plain",
  readOnly: false,
  base64: Buffer.from(text, "utf8").toString("base64"),
});
const submitMerge =
  vi.fn<(workspaceId: string, prompt: string) => Promise<void>>();
function setup(
  file = disk("original"),
  workspaceId = "wsp_test",
  teaSessions = new Map(),
) {
  rpc.resources.workspace.get.query.mockResolvedValue({ root: "/workspace" });
  rpc.workspace.read.query.mockResolvedValue(file);
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const transport = createTransport({ origin: "http://127.0.0.1:41000" });
  const api = {
    id: `${workspaceId}/${file.entry.path}`,
    updateParameters: vi.fn(),
    setTitle: vi.fn(),
  };
  const props = {
    api,
    params: { workspaceId, path: file.entry.path },
  } as unknown as IDockviewPanelProps<FilePanelParams>;
  const saves = new Map<string, () => Promise<void>>();
  const view = render(
    <QueryClientProvider client={client}>
      <WorkspaceContext.Provider
        value={{
          transport,
          languageError: undefined,
          onLanguageError: vi.fn(),
          teaSessions: { current: teaSessions },
          openReference: vi.fn(),
          saves: { current: saves },
          instanceId: "test",
          collapsible: false,
          dark: false,
        }}
      >
        <WorkspaceFileMerge.Provider value={submitMerge}>
          <FilePanel {...props} />
        </WorkspaceFileMerge.Provider>
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  );
  return {
    client,
    transport,
    api,
    saves,
    cleanup: () => {
      view.unmount();
      client.clear();
    },
  };
}
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

test.each([
  ["main.tea", "ctrlKey", "wsp_test"],
  ["main.tea", "ctrlKey", "wsp_research"],
  ["notes.md", "metaKey", "wsp_test"],
  ["NOTES.MD", "ctrlKey", "wsp_test"],
  ["notes.markdown", "metaKey", "wsp_test"],
])(
  "decodes UTF-8 and saves %s via %s+S in %s",
  async (path, modifier, workspaceId) => {
    const original = "// Unicode € 🌍\r\nclose";
    const { cleanup } = setup(disk(original, path), workspaceId);
    await waitFor(() =>
      expect(rpc.workspace.read.query).toHaveBeenCalledWith(
        { workspaceId, path },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    const editor = await screen.findByRole("textbox", { name: "Code" });
    expect(editor).toHaveValue(original.replaceAll("\r\n", "\n"));
    const edited = "// Edited ✅\nopen";
    rpc.workspace.write.mutate.mockResolvedValue(disk(edited, path).entry);
    rpc.workspace.read.query.mockResolvedValue(disk(edited, path));
    fireEvent.change(editor, { target: { value: edited } });
    expect(fireEvent.keyDown(editor, { key: "s", [modifier]: true })).toBe(
      false,
    );
    await waitFor(() =>
      expect(rpc.workspace.write.mutate).toHaveBeenCalledWith({
        workspaceId,
        path,
        text: edited,
        expected: original,
      }),
    );
    cleanup();
  },
);

test("invalid UTF-8 fails visibly instead of opening lossy editable text", async () => {
  const { cleanup } = setup({ ...disk(""), base64: "/w==" });
  await findErrorToast();
  expect(
    screen.queryByRole("textbox", { name: "Code" }),
  ).not.toBeInTheDocument();
  expect(rpc.workspace.write.mutate).not.toHaveBeenCalled();
  cleanup();
});

test.each([
  ["chart.PNG", "image/png"],
  ["report.pdf", "application/pdf"],
])(
  "previews %s through the shared read API and releases its Blob URL",
  async (path, mediaType) => {
    const createObjectURL = vi.fn(() => "blob:workspace-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const { cleanup } = setup({
      entry: { path, hash: "binary-hash" },
      mediaType,
      readOnly: false,
      base64: "AP8=",
    });
    const preview =
      mediaType === "application/pdf"
        ? await screen.findByTitle("PDF")
        : await screen.findByRole("img", { name: path });
    expect(preview).toHaveAttribute("src", "blob:workspace-preview");
    expect(rpc.workspace.read.query).toHaveBeenCalledWith(
      { workspaceId: "wsp_test", path },
      { signal: expect.any(AbortSignal) },
    );
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: mediaType, size: 2 }),
    );
    cleanup();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:workspace-preview");
  },
);

test.each(["main.tea", "notes.md"])(
  "external changes preserve %s draft; Save focuses the banner and discard loads disk",
  async (path) => {
    const { client, transport, api, cleanup } = setup(disk("original", path));
    const editor = await screen.findByRole("textbox", { name: "Code" });
    fireEvent.change(editor, { target: { value: "draft" } });
    await waitFor(() =>
      expect(api.updateParameters).toHaveBeenLastCalledWith({
        dirty: true,
        saving: false,
      }),
    );
    rpc.workspace.read.query.mockResolvedValue(disk("external", path));
    await act(() =>
      client.invalidateQueries({
        queryKey: workspaceFileQueryOptions(transport, "wsp_test", path)
          .queryKey,
      }),
    );
    expect(editor).toHaveValue("draft");
    const discard = await screen.findByRole("button", {
      name: "Discard edits and reload",
    });
    fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
    expect(discard).toHaveFocus();
    expect(rpc.workspace.write.mutate).not.toHaveBeenCalled();
    expect(editor).toHaveValue("draft");
    fireEvent.click(discard);
    await waitFor(() => expect(editor).toHaveValue("external"));
    expect(
      screen.queryByRole("button", { name: "Discard edits and reload" }),
    ).not.toBeInTheDocument();
    expect(rpc.workspace.write.mutate).not.toHaveBeenCalled();
    cleanup();
  },
);

test("clean files follow disk updates without a conflict banner", async () => {
  const { client, transport, cleanup } = setup();
  const editor = await screen.findByRole("textbox", { name: "Code" });
  rpc.workspace.read.query.mockResolvedValue(disk("external"));
  await act(() =>
    client.invalidateQueries({
      queryKey: workspaceFileQueryOptions(transport, "wsp_test", "main.tea")
        .queryKey,
    }),
  );
  await waitFor(() => expect(editor).toHaveValue("external"));
  expect(
    screen.queryByRole("button", { name: "Merge with AI" }),
  ).not.toBeInTheDocument();
  cleanup();
});

test("existing failed-save refresh reveals the conflict and preserves the original draft", async () => {
  const { cleanup } = setup();
  const editor = await screen.findByRole("textbox", { name: "Code" });
  fireEvent.change(editor, { target: { value: "draft" } });
  rpc.workspace.write.mutate.mockRejectedValue(
    new Error("File changed on disk"),
  );
  rpc.workspace.read.query.mockResolvedValue(disk("external"));
  fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
  await screen.findByRole("button", { name: "Merge with AI" });
  expect(rpc.workspace.write.mutate).toHaveBeenCalledWith({
    workspaceId: "wsp_test",
    path: "main.tea",
    text: "draft",
    expected: "original",
  });
  expect(editor).toHaveValue("draft");
  cleanup();
});

test.each(["accepted", "failed", "edited during admission"])(
  "AI merge %s preserves unsaved input until admission",
  async (outcome) => {
    const { client, transport, api, saves, cleanup } = setup();
    const editor = await screen.findByRole("textbox", { name: "Code" });
    fireEvent.change(editor, { target: { value: "draft" } });
    rpc.workspace.read.query.mockResolvedValue(disk("external"));
    await act(() =>
      client.invalidateQueries({
        queryKey: workspaceFileQueryOptions(transport, "wsp_test", "main.tea")
          .queryKey,
      }),
    );
    const button = await screen.findByRole("button", { name: "Merge with AI" });
    // Toolbar Save and prepare() use this same registered command.
    await expect(saves.get(api.id)!()).rejects.toThrow("external changes");
    expect(rpc.workspace.write.mutate).not.toHaveBeenCalled();
    let accept!: () => void;
    let reject!: (error: Error) => void;
    submitMerge.mockReturnValue(
      new Promise<void>((resolve, fail) => {
        accept = resolve;
        reject = fail;
      }),
    );
    fireEvent.click(button);
    await waitFor(() => expect(submitMerge).toHaveBeenCalledOnce());
    const [workspaceId, prompt] = submitMerge.mock.calls[0]!;
    expect(workspaceId).toBe("wsp_test");
    expect(JSON.parse(prompt.split("\n\n").at(-1)!)).toEqual({
      path: "main.tea",
      original: "original",
      local: "draft",
      disk: "external",
    });
    expect(editor).toHaveValue("draft");
    expect(button).toBeDisabled();
    if (outcome === "edited during admission")
      fireEvent.change(editor, { target: { value: "newer draft" } });
    await act(async () => {
      if (outcome === "failed") reject(new Error("Admission unavailable"));
      else accept();
    });
    if (outcome === "accepted") {
      await waitFor(() => expect(editor).toHaveValue("external"));
      expect(
        screen.queryByRole("button", { name: "Merge with AI" }),
      ).not.toBeInTheDocument();
    } else {
      await waitFor(() => expect(button).toBeEnabled());
      expect(editor).toHaveValue(
        outcome === "failed" ? "draft" : "newer draft",
      );
      if (outcome === "failed")
        await findErrorToast("Couldn’t start file merge");
    }
    expect(rpc.workspace.write.mutate).not.toHaveBeenCalled();
    cleanup();
  },
);

test("a committed save retains displayed text when disk refresh fails", async () => {
  const { api, cleanup } = setup();
  const editor = await screen.findByRole("textbox", { name: "Code" });
  fireEvent.change(editor, { target: { value: "saved content" } });
  rpc.workspace.write.mutate.mockResolvedValue(disk("saved content").entry);
  rpc.workspace.read.query.mockRejectedValue(new Error("Refresh unavailable"));
  fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
  await findErrorToast();
  await waitFor(() =>
    expect(api.updateParameters).toHaveBeenLastCalledWith({
      dirty: false,
      saving: false,
    }),
  );
  expect(editor).toHaveValue("saved content");
  cleanup();
});

test("editing during save stays dirty and the next save uses the committed hash", async () => {
  const { cleanup } = setup();
  const editor = await screen.findByRole("textbox", { name: "Code" });
  let commit!: (entry: { path: string; hash: string }) => void;
  rpc.workspace.write.mutate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        commit = resolve;
      }),
  );
  fireEvent.change(editor, { target: { value: "first" } });
  fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
  await waitFor(() =>
    expect(rpc.workspace.write.mutate).toHaveBeenCalledTimes(1),
  );
  fireEvent.change(editor, { target: { value: "second" } });
  rpc.workspace.read.query.mockResolvedValue(disk("first"));
  await act(async () => commit(disk("first").entry));
  expect(editor).toHaveValue("second");
  rpc.workspace.write.mutate.mockResolvedValue(disk("second").entry);
  rpc.workspace.read.query.mockResolvedValue(disk("second"));
  fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
  await waitFor(() =>
    expect(rpc.workspace.write.mutate).toHaveBeenLastCalledWith({
      workspaceId: "wsp_test",
      path: "main.tea",
      text: "second",
      expected: "first",
    }),
  );
  cleanup();
});

test("built-in source opens read-only and cannot create a draft or save", async () => {
  const { api, cleanup } = setup({
    ...disk("original", "indicators/builtin/sma.tea"),
    readOnly: true,
  });
  const editor = await screen.findByRole("textbox", { name: "Code" });
  expect(editor).toHaveAttribute("readonly");
  fireEvent.change(editor, { target: { value: "attempted edit" } });
  fireEvent.keyDown(editor, { key: "s", metaKey: true });
  fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
  expect(editor).toHaveValue("original");
  expect(rpc.workspace.write.mutate).not.toHaveBeenCalled();
  expect(api.updateParameters).toHaveBeenLastCalledWith({
    dirty: false,
    saving: false,
  });
  cleanup();
});

const crumbs = async () =>
  within(await screen.findByRole("navigation", { name: "breadcrumb" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

test("word wrap updates the code view while preserving its draft and save state", async () => {
  const { api, cleanup } = setup();
  const editor = await screen.findByRole("textbox", { name: "Code" });
  const wrap = screen.getByRole("button", { name: "Word wrap" });
  expect(wrap).toHaveAttribute("aria-pressed", "false");
  expect(editor).toHaveAttribute("wrap", "off");
  fireEvent.click(wrap);
  expect(wrap).toHaveAttribute("aria-pressed", "true");
  expect(editor).toHaveAttribute("wrap", "soft");
  expect(api.updateParameters).toHaveBeenLastCalledWith({
    dirty: false,
    saving: false,
  });
  fireEvent.change(editor, { target: { value: "unsaved draft" } });
  fireEvent.click(wrap);
  expect(screen.getByRole("textbox", { name: "Code" })).toBe(editor);
  expect(editor).toHaveValue("unsaved draft");
  expect(editor).toHaveAttribute("wrap", "off");
  expect(api.updateParameters).toHaveBeenLastCalledWith({
    dirty: true,
    saving: false,
  });
  expect(rpc.workspace.write.mutate).not.toHaveBeenCalled();
  cleanup();
});

test("Markdown's visual editor does not offer a code-only wrap control", async () => {
  const { cleanup } = setup(disk("# Notes", "notes.md"));
  expect(await screen.findByRole("textbox", { name: "Code" })).toHaveValue(
    "# Notes",
  );
  expect(
    screen.queryByRole("button", { name: "Word wrap" }),
  ).not.toBeInTheDocument();
  cleanup();
});

test("the breadcrumb shows the workspace folder, then each path segment", async () => {
  const { cleanup } = setup(disk("original", "indicators/momentum/rsi.tea"));
  await waitFor(async () =>
    expect(await crumbs()).toEqual([
      "workspace",
      "indicators",
      "momentum",
      "rsi.tea",
    ]),
  );
  expect(screen.getByRole("link", { name: "rsi.tea" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  cleanup();
});

test("a library tab's breadcrumb shows the library and its file name", async () => {
  const readLibrary = vi.fn().mockResolvedValue("export fn ta() {}");
  const { cleanup } = setup(
    disk("", "tea-lib:/std/ta.tea"),
    "wsp_test",
    new Map([["wsp_test", { readLibrary }]]),
  );
  expect(await crumbs()).toEqual(["Tea library", "ta.tea"]);
  expect(await screen.findByRole("textbox", { name: "Code" })).toHaveValue(
    "export fn ta() {}",
  );
  expect(readLibrary).toHaveBeenCalledWith("tea-lib:/std/ta.tea");
  fireEvent.click(screen.getByRole("button", { name: "Word wrap" }));
  expect(screen.getByRole("textbox", { name: "Code" })).toHaveAttribute(
    "wrap",
    "soft",
  );
  expect(rpc.workspace.write.mutate).not.toHaveBeenCalled();
  cleanup();
});
