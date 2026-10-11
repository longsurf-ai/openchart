import {
  renderWithToaster as render,
  testAppHost,
} from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
// Purpose: Verify each panel's toolbar actions follow its live params, save through the editor's registry and contribute app actions only for Tea files.
import { useState } from "react";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import type { IDockviewPanelProps } from "dockview-react";
import { createTransport } from "@openchart/app/lib/transport/transport";
import { AppHostProvider } from "@openchart/app/lib/host/host";
import { WorkspaceFileActions } from "@openchart/app/lib/workspace/workspace";
import { WorkspaceContext } from "@openchart/app/features/workspace/components/context";
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
beforeEach(() => {
  // Image previews create Blob URLs, which jsdom does not implement.
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:preview";
      static revokeObjectURL = () => {};
    },
  );
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

const disk = (
  text: string,
  path: string,
  readOnly = false,
  mediaType = "text/plain",
) => ({
  entry: { path, hash: text },
  mediaType,
  readOnly,
  base64: Buffer.from(text, "utf8").toString("base64"),
});
/** Re-renders the panel with merged params on every update, like Dockview. */
function Panel({
  initial,
  containerApi,
}: {
  initial: FilePanelParams;
  containerApi: unknown;
}) {
  const [params, setParams] = useState(initial);
  const [api] = useState(() => ({
    id: `${initial.workspaceId}/${initial.path}`,
    setTitle: vi.fn(),
    updateParameters: (next: Partial<FilePanelParams>) =>
      setParams((current) => ({ ...current, ...next })),
  }));
  return (
    <FilePanel
      {...({
        api,
        params,
        containerApi,
      } as unknown as IDockviewPanelProps<FilePanelParams>)}
    />
  );
}
function setup(
  path: string,
  {
    readOnly = false,
    extraActions,
    mediaType,
  }: {
    readOnly?: boolean;
    mediaType?: string;
    extraActions?: Parameters<typeof WorkspaceFileActions.Provider>[0]["value"];
  } = {},
) {
  rpc.resources.workspace.get.query.mockResolvedValue({ root: "/workspace" });
  rpc.workspace.read.query.mockResolvedValue(
    disk("original", path, readOnly, mediaType),
  );
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const transport = createTransport({ origin: "http://127.0.0.1:41000" });
  const containerApi = { getPanel: vi.fn(), addPanel: vi.fn() };
  const openReference = vi.fn();
  const host = testAppHost({
    openPath: vi.fn(async () => {}),
    revealPath: vi.fn(async () => {}),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AppHostProvider value={host}>
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
            <Panel
              initial={{ workspaceId: "wsp_test", path }}
              containerApi={containerApi}
            />
          </WorkspaceFileActions.Provider>
        </WorkspaceContext.Provider>
      </AppHostProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    containerApi,
    host,
    openReference,
    user: userEvent.setup(),
    cleanup: () => {
      view.unmount();
      client.clear();
    },
  };
}
async function menuItems(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "More file actions" }),
  );
  return (await screen.findAllByRole("menuitem")).map((item) =>
    item.textContent?.trim(),
  );
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
  const { user, cleanup } = setup("indicators/rsi.tea");
  const copy = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  await menuItems(user);
  await user.click(screen.getByRole("menuitem", { name: "Copy path" }));
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
  const { user, containerApi, cleanup } = setup("indicators/rsi.tea");
  await screen.findByRole("textbox", { name: "Code" });
  await menuItems(user);
  await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
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
  const { user, cleanup } = setup("indicators/builtin/sma.tea", {
    readOnly: true,
  });
  await screen.findByRole("textbox", { name: "Code" });
  expect(await menuItems(user)).toContain("Duplicate to edit");
  cleanup();
});

test.each([
  [
    "notes.md",
    "text/plain",
    ["Copy path", "Duplicate", "Reveal in Finder", "Open in default app"],
  ],
  [
    "data.bin",
    "application/octet-stream",
    ["Copy path", "Reveal in Finder", "Open in default app"],
  ],
  [
    "chart.png",
    "image/png",
    ["Copy path", "Reveal in Finder", "Open in default app"],
  ],
])(
  "%s offers only the menu actions its type supports and no app action",
  async (path, mediaType, names) => {
    const extraActions = vi.fn(() => (
      <button type="button">Add to chart</button>
    ));
    const { user, client, cleanup } = setup(path, { extraActions, mediaType });
    // Duplicate depends on the read's MIME, so assert once every read settles.
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(await menuItems(user)).toEqual(names);
    expect(extraActions).not.toHaveBeenCalled();
    cleanup();
  },
);

test("library tabs have no file actions", async () => {
  const { cleanup } = setup("tea-lib:/std/ta.tea");
  expect(
    screen.queryByRole("button", { name: "More file actions" }),
  ).not.toBeInTheDocument();
  cleanup();
});

test("Finder and default-app actions use the file's absolute path", async () => {
  const { user, host, cleanup } = setup("indicators/rsi.tea");
  await screen.findByRole("textbox", { name: "Code" });
  await menuItems(user);
  await user.click(screen.getByRole("menuitem", { name: "Reveal in Finder" }));
  expect(host.revealPath).toHaveBeenCalledExactlyOnceWith(
    "/workspace/indicators/rsi.tea",
  );
  await menuItems(user);
  await user.click(
    screen.getByRole("menuitem", { name: "Open in default app" }),
  );
  expect(host.openPath).toHaveBeenCalledExactlyOnceWith(
    "/workspace/indicators/rsi.tea",
  );
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
  const { openReference, cleanup } = setup("main.tea");
  fireEvent.click(await screen.findByRole("button", { name: "Tea reference" }));
  expect(openReference).toHaveBeenCalledExactlyOnceWith();
  cleanup();
});

test("only a .tea tab offers the Tea reference", async () => {
  const { cleanup } = setup("notes.md");
  await screen.findByRole("button", { name: "More file actions" });
  expect(
    screen.queryByRole("button", { name: "Tea reference" }),
  ).not.toBeInTheDocument();
  cleanup();
});
