import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import { findErrorToast, testAppHost } from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
/// <reference types="vitest/jsdom" />
// Purpose: Verify Workspace creation and local draft protection across route/window exits.
import { createRef, useEffect } from "react";
import {
  AuiConfig,
  AuiProvider,
  ModelContextClient,
  type AssistantClient,
} from "@assistant-ui/react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DockviewReadyEvent } from "dockview-react";
import { createTransport } from "@openchart/app/lib/transport/transport";
import { UnsavedChangesProvider } from "@openchart/app/lib/unsaved-changes/unsaved-changes";
import { AppHostProvider } from "@openchart/app/lib/host/host";
import { workspacesQueryOptions } from "@openchart/app/lib/workspace/workspace";
import { useSidebar } from "@openchart/app/components/ui/sidebar";
import { WorkspaceView } from "@openchart/app/features/workspace/components/workspace-view";

const rpc = vi.hoisted(() => ({
  resources: {
    workspace: {
      list: { query: vi.fn() },
      getDefault: { query: vi.fn() },
      forget: { mutate: vi.fn() },
    },
  },
  workspace: {
    listDirectory: { query: vi.fn() },
    listTree: { query: vi.fn() },
    write: { mutate: vi.fn() },
    mkdir: { mutate: vi.fn() },
    read: { query: vi.fn() },
    remove: { mutate: vi.fn() },
  },
}));
const api = vi.hoisted(() => ({
  panels: [] as Array<{
    params: {
      workspaceId?: string;
      path?: string;
      dirty?: boolean;
      saving?: boolean;
    };
    api?: { close: () => void };
  }>,
  getPanel: vi.fn(),
  addPanel: vi.fn(),
  activePanel: undefined as
    | { params: { workspaceId: string; path: string; dirty?: boolean } }
    | undefined,
  activeListeners: new Set<() => void>(),
  onDidActivePanelChange: (listener: () => void) => {
    api.activeListeners.add(listener);
    return { dispose: () => api.activeListeners.delete(listener) };
  },
}));
vi.mock("@trpc/client", async (original) => ({
  ...(await original<typeof import("@trpc/client")>()),
  createTRPCClient: () => rpc,
}));
vi.mock("dockview-react", async (original) => ({
  ...(await original<typeof import("dockview-react")>()),
  DockviewReact: ({
    onReady,
  }: {
    onReady: (event: DockviewReadyEvent) => void;
  }) => {
    useEffect(
      () => onReady({ api } as unknown as DockviewReadyEvent),
      [onReady],
    );
    return <div />;
  },
}));

const cleanups: Array<() => void> = [];
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
function PanelState() {
  return <span data-testid="panel-state">{useSidebar().state}</span>;
}
// Only the DOM event needs jsdom's signal; router navigation must retain Node's.
function openContextMenu(element: HTMLElement) {
  const nativeAbortController = globalThis.AbortController;
  vi.stubGlobal("AbortController", jsdom.window.AbortController);
  try {
    fireEvent.contextMenu(element);
  } finally {
    vi.stubGlobal("AbortController", nativeAbortController);
  }
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  api.panels.length = 0;
  api.activePanel = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
const defaultWorkspace = { id: "wsp_test", root: "/workspaces/default" };
const researchWorkspace = { id: "wsp_research", root: "/workspaces/research" };
function setup(
  directories: string[] = [],
  workspaces = [defaultWorkspace],
  paths: string[] = [],
  collapsible = false,
  file?: { workspaceId: string; path: string },
) {
  rpc.resources.workspace.getDefault.query.mockResolvedValue(
    defaultWorkspace.id,
  );
  rpc.resources.workspace.list.query.mockResolvedValue({
    items: workspaces,
    nextCursor: null,
  });
  rpc.workspace.listDirectory.query.mockImplementation(
    async ({ path: directory }: { path: string }) => ({
      status: "ready",
      entries: paths
        .filter((path) => path.split("/").slice(0, -1).join("/") === directory)
        .map((path) => ({ path })),
      directories: directories.filter(
        (path) => path.split("/").slice(0, -1).join("/") === directory,
      ),
    }),
  );
  rpc.workspace.listTree.query.mockResolvedValue({
    status: "ready",
    entries: paths.map((path) => ({ path })),
    directories,
  });
  rpc.workspace.read.query.mockImplementation(
    async ({ path }: { path: string }) => ({
      entry: { path, hash: "a".repeat(64) },
      mediaType: "text/plain",
      base64: btoa("content"),
      readOnly: false,
    }),
  );
  const client = createQueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const transport = createTransport({ origin: "http://127.0.0.1:41000" });
  const router = createMemoryRouter([
    {
      element: (
        <>
          <Link to="/next">Leave workspace</Link>
          <UnsavedChangesProvider>
            <Outlet />
          </UnsavedChangesProvider>
        </>
      ),
      children: [
        {
          path: "/",
          element: (
            <WorkspaceView
              transport={transport}
              title={collapsible ? undefined : "Workspace"}
              file={file}
              collapsible={collapsible}
              navigation={<PanelState />}
            />
          ),
        },
        { path: "/next", element: <p>Next page</p> },
      ],
    },
  ]);
  const aui = createRef<AssistantClient>();
  const context = AuiConfig({ modelContext: ModelContextClient() });
  const view = render(
    <QueryClientProvider client={client}>
      <AppHostProvider value={testAppHost()}>
        <AuiProvider config={context} ref={aui}>
          <RouterProvider router={router} />
        </AuiProvider>
      </AppHostProvider>
    </QueryClientProvider>,
  );
  cleanups.push(
    () => client.clear(),
    () => router.dispose(),
    view.unmount,
  );
  return {
    user: userEvent.setup(),
    router,
    client,
    transport,
    readContext: () => aui.current!.modelContext.getModelContext().system,
  };
}

test("publishes only the active file and clears its context on close and route exit", async () => {
  const { readContext, router } = setup();
  expect(readContext()).toBe(JSON.stringify({ view: "workspace", file: null }));
  for (const workspaceId of ["wsp_test", "wsp_research"]) {
    act(() => {
      api.activePanel = {
        params: { workspaceId, path: "main.tea", dirty: true },
      };
      api.activeListeners.forEach((listener) => listener());
    });
    expect(readContext()).toBe(
      JSON.stringify({
        view: "workspace",
        file: { workspaceId, path: "main.tea" },
      }),
    );
  }
  act(() => {
    api.activePanel = undefined;
    api.activeListeners.forEach((listener) => listener());
  });
  expect(readContext()).toBe(JSON.stringify({ view: "workspace", file: null }));
  await act(() => router.navigate("/next"));
  expect(readContext()).toBeUndefined();
  expect(api.activeListeners.size).toBe(0);
});

test.each([false, true])(
  "offers file search before the folder action in a collapsible=%s workspace",
  async (collapsible) => {
    const { user } = setup([], [defaultWorkspace], [], collapsible);
    await screen.findByRole("button", { name: "default" });
    const search = screen.getByRole("button", { name: "Find file" });
    const create = screen.getByRole("button", { name: "Create workspace" });
    const buttons = screen.getAllByRole("button");
    expect(buttons.indexOf(search)).toBeLessThan(buttons.indexOf(create));
    await user.hover(create);
    expect(
      await screen.findByRole("tooltip", { name: "Create workspace" }),
    ).toBeVisible();
    await user.click(search);
    expect(
      screen.getByRole("combobox", { name: "Search files" }),
    ).toHaveFocus();
  },
);

test("searches unopened folders locally and opens the exact workspace file with the keyboard", async () => {
  const { user } = setup(
    ["indicators"],
    [defaultWorkspace, researchWorkspace],
    ["indicators/semis.tea", "unrelated.md"],
  );
  await screen.findByRole("button", { name: "default" });
  expect(rpc.workspace.listTree.query).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Find file" }));
  const search = screen.getByRole("combobox", { name: "Search files" });
  expect(search).toHaveFocus();
  await user.type(search, "semis");
  expect(await screen.findAllByRole("option")).toHaveLength(2);
  expect(screen.queryByText("unrelated.md")).not.toBeInTheDocument();
  expect(rpc.workspace.listDirectory.query).not.toHaveBeenCalled();
  expect(rpc.workspace.read.query).not.toHaveBeenCalled();
  expect(rpc.workspace.listTree.query).toHaveBeenCalledTimes(2);

  await user.type(search, ".tea");
  expect(rpc.workspace.listTree.query).toHaveBeenCalledTimes(2);
  await user.keyboard("{ArrowDown}{Enter}");
  expect(api.addPanel).toHaveBeenCalledWith(
    expect.objectContaining({
      params: { workspaceId: "wsp_research", path: "indicators/semis.tea" },
    }),
  );
  await user.clear(search);
  await user.type(search, "wsp_research");
  expect(await screen.findByText("No matching files.")).toBeVisible();
});

test("clearing search restores expanded folders and Escape clears an empty result", async () => {
  const { user } = setup(
    ["indicators"],
    [defaultWorkspace],
    ["indicators/semis.tea"],
  );
  await user.click(await screen.findByRole("button", { name: "default" }));
  await user.click(await screen.findByRole("button", { name: "indicators" }));
  const file = await screen.findByRole("button", { name: "semis.tea" });
  await user.click(screen.getByRole("button", { name: "Find file" }));
  const search = screen.getByRole("combobox", { name: "Search files" });
  await user.type(search, "indicators");
  expect(await screen.findByRole("option")).toHaveTextContent("semis.tea");
  expect(file).not.toBeVisible();
  await user.tab();
  expect(
    screen.getByRole("button", { name: "Clear file search" }),
  ).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(api.addPanel).not.toHaveBeenCalled();
  expect(file).toBeVisible();
  expect(search).toHaveFocus();
  await user.type(search, "no-such-file");
  expect(await screen.findByText("No matching files.")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(search).toHaveValue("");
  expect(file).toBeVisible();
  expect(rpc.workspace.listDirectory.query).toHaveBeenCalledTimes(2);
});

test("distinguishes unavailable workspaces from no matches and retries their file listing", async () => {
  const { user } = setup();
  rpc.workspace.listTree.query.mockResolvedValue({ status: "missing" });
  await screen.findByRole("button", { name: "default" });
  await user.click(screen.getByRole("button", { name: "Find file" }));
  await user.type(
    screen.getByRole("combobox", { name: "Search files" }),
    "semis",
  );
  expect(await screen.findByText("Couldn’t search default.")).toBeVisible();
  expect(screen.queryByText("No matching files.")).not.toBeInTheDocument();
  rpc.workspace.listTree.query.mockResolvedValue({
    status: "ready",
    entries: [{ path: "semis.tea" }],
    directories: [],
  });
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("option")).toHaveTextContent("semis.tea");
});

test("opens a requested file after Dockview is ready and publishes its exact workspace identity", async () => {
  const file = { workspaceId: "wsp_research", path: "indicators/My study.tea" };
  api.addPanel.mockImplementation(({ params }) => {
    api.activePanel = { params };
    api.activeListeners.forEach((listener) => listener());
  });
  const { readContext } = setup(
    [],
    [defaultWorkspace, researchWorkspace],
    [],
    false,
    file,
  );
  await waitFor(() =>
    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "wsp_research/indicators/My study.tea",
        params: file,
      }),
    ),
  );
  expect(readContext()).toBe(JSON.stringify({ view: "workspace", file }));
});

test.each([
  { collapsible: false, rail: "Resize files", state: "expanded" },
  { collapsible: true, rail: "Toggle Sidebar", state: "collapsed" },
])(
  "Cmd+B leaves the file panel $state when collapsible is $collapsible",
  async ({ collapsible, rail, state }) => {
    const { user } = setup([], [defaultWorkspace], [], collapsible);
    expect(screen.getByTestId("panel-state")).toHaveTextContent("expanded");
    screen.getByRole("button", { name: rail }).focus();
    await user.keyboard("{Meta>}b{/Meta}");
    expect(screen.getByTestId("panel-state")).toHaveTextContent(state);
  },
);

test("creates an empty folder from the workspace root and refreshes it from disk", async () => {
  const { user } = setup();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "New file in default" }),
    ).toBeEnabled(),
  );
  openContextMenu(await screen.findByRole("button", { name: "default" }));
  expect(await screen.findAllByRole("menuitem")).toHaveLength(2);
  await user.click(screen.getByRole("menuitem", { name: "Create folder" }));
  const dialog = await screen.findByRole("dialog", { name: "Create folder" });
  const input = within(dialog).getByRole("textbox", { name: "Folder path" });
  await user.clear(input);
  await user.type(input, "empty");
  rpc.workspace.mkdir.mutate.mockImplementation(async () => {
    rpc.workspace.listDirectory.query.mockResolvedValue({
      status: "ready",
      entries: [],
      directories: ["empty"],
    });
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Create folder" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(rpc.workspace.mkdir.mutate).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "wsp_test",
    path: "empty",
  });
  expect(screen.getByRole("button", { name: "default" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await user.click(screen.getByRole("button", { name: "default" }));
  expect(await screen.findByRole("button", { name: "empty" })).toBeVisible();
  expect(rpc.workspace.write.mutate).not.toHaveBeenCalled();
});

test("creates a file in the right-clicked empty folder and opens its tab", async () => {
  const { user } = setup(["src"]);
  await user.click(await screen.findByRole("button", { name: "default" }));
  openContextMenu(await screen.findByRole("button", { name: "src" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Create file" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Create file" });
  expect(
    within(dialog).getByRole("textbox", { name: "File path" }),
  ).toHaveValue("src/untitled.workflow.ts");
  rpc.workspace.write.mutate.mockResolvedValue({
    path: "src/untitled.workflow.ts",
    hash: "a".repeat(64),
  });
  await user.click(within(dialog).getByRole("button", { name: "Create file" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(rpc.workspace.write.mutate).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "wsp_test",
    path: "src/untitled.workflow.ts",
    text: expect.stringContaining("export default defineWorkflow({"),
    expected: null,
  });
  expect(api.addPanel).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "wsp_test/src/untitled.workflow.ts",
      params: { workspaceId: "wsp_test", path: "src/untitled.workflow.ts" },
    }),
  );
});

test("opens identical relative paths from different workspaces in separate tabs", async () => {
  const { user } = setup(
    [],
    [defaultWorkspace, researchWorkspace],
    ["main.tea"],
  );
  const panels = new Map<
    string,
    { api: { setActive: ReturnType<typeof vi.fn> } }
  >();
  api.getPanel.mockImplementation((id: string) => panels.get(id));
  api.addPanel.mockImplementation(({ id }: { id: string }) => {
    panels.set(id, { api: { setActive: vi.fn() } });
  });
  await user.click(await screen.findByRole("button", { name: "default" }));
  await user.click(await screen.findByRole("button", { name: "research" }));
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "main.tea" })).toHaveLength(2),
  );
  const files = screen.getAllByRole("button", { name: "main.tea" });
  await user.click(files[0]!);
  await user.click(files[1]!);
  expect(api.addPanel).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      id: "wsp_test/main.tea",
      params: { workspaceId: "wsp_test", path: "main.tea" },
    }),
  );
  expect(api.addPanel).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      id: "wsp_research/main.tea",
      params: { workspaceId: "wsp_research", path: "main.tea" },
    }),
  );
  await user.click(files[0]!);
  expect(api.addPanel).toHaveBeenCalledTimes(2);
  expect(panels.get("wsp_test/main.tea")?.api.setActive).toHaveBeenCalledOnce();
});

test("new-file actions target their own workspace", async () => {
  const { user } = setup([], [defaultWorkspace, researchWorkspace]);
  await user.click(
    await screen.findByRole("button", { name: "New file in research" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Create file" });
  rpc.workspace.write.mutate.mockResolvedValue({
    path: "untitled.workflow.ts",
    hash: "a".repeat(64),
  });
  await user.click(within(dialog).getByRole("button", { name: "Create file" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(rpc.workspace.write.mutate).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "wsp_research",
    path: "untitled.workflow.ts",
    text: expect.stringContaining("export default defineWorkflow({"),
    expected: null,
  });
  expect(api.addPanel).toHaveBeenCalledWith(
    expect.objectContaining({
      params: { workspaceId: "wsp_research", path: "untitled.workflow.ts" },
    }),
  );
});

test("mounts newly registered workspaces without navigating or losing dirty tabs", async () => {
  const { user, client, transport, router } = setup(
    [],
    [defaultWorkspace],
    ["main.tea"],
  );
  await user.click(await screen.findByRole("button", { name: "default" }));
  await user.click(await screen.findByRole("button", { name: "main.tea" }));
  const dirtyPanel = { params: { dirty: true } };
  api.panels.push(dirtyPanel);
  rpc.resources.workspace.list.query.mockResolvedValue({
    items: [defaultWorkspace, researchWorkspace],
    nextCursor: null,
  });
  await act(() => client.invalidateQueries(workspacesQueryOptions(transport)));
  expect(await screen.findByRole("button", { name: "research" })).toBeVisible();
  expect(screen.getByRole("button", { name: "default" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/");
  expect(api.panels).toContain(dirtyPanel);
  expect(api.addPanel).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("failed creation keeps its draft until closing, then reopening starts a fresh form", async () => {
  const { user } = setup(["src"]);
  await user.click(await screen.findByRole("button", { name: "default" }));
  openContextMenu(await screen.findByRole("button", { name: "src" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Create folder" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Create folder" });
  const input = within(dialog).getByRole("textbox", { name: "Folder path" });
  await user.clear(input);
  await user.type(input, "src/custom");
  rpc.workspace.mkdir.mutate.mockRejectedValue(
    new Error("Couldn’t create this folder."),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Create folder" }),
  );
  expect(
    await findErrorToast("Couldn’t create this folder."),
  ).toHaveTextContent("Couldn’t create this folder.");
  expect(
    within(dialog).getByRole("textbox", { name: "Folder path" }),
  ).toHaveValue("src/custom");
  expect(rpc.workspace.mkdir.mutate).toHaveBeenCalledTimes(1);
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(rpc.workspace.mkdir.mutate).toHaveBeenCalledTimes(1);

  openContextMenu(screen.getByRole("button", { name: "src" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Create folder" }),
  );
  const reopened = await screen.findByRole("dialog", { name: "Create folder" });
  expect(
    within(reopened).getByRole("textbox", { name: "Folder path" }),
  ).toHaveValue("src/untitled");
  expect(within(reopened).queryByRole("alert")).not.toBeInTheDocument();
  await user.click(within(reopened).getByRole("button", { name: "Cancel" }));
  expect(rpc.workspace.mkdir.mutate).toHaveBeenCalledTimes(1);
});

function openPanel(workspaceId: string, path: string) {
  const panel = {
    params: { workspaceId, path, dirty: true },
    api: {
      close: vi.fn(() => {
        api.panels.splice(api.panels.indexOf(panel), 1);
      }),
    },
  };
  api.panels.push(panel);
  return panel;
}

test("deleting confirms the exact file, retains dirty tabs on failure, and closes only its tab after success", async () => {
  const { user } = setup(["src"], [defaultWorkspace], ["src/main.tea"]);
  const target = openPanel(defaultWorkspace.id, "src/main.tea");
  const sibling = openPanel(defaultWorkspace.id, "other.tea");
  const otherWorkspace = openPanel(researchWorkspace.id, "src/main.tea");
  await user.click(await screen.findByRole("button", { name: "default" }));
  await user.click(await screen.findByRole("button", { name: "src" }));
  expect(rpc.workspace.read.query).not.toHaveBeenCalled();
  openContextMenu(await screen.findByRole("button", { name: "main.tea" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Delete file" }),
  );
  let dialog = await screen.findByRole("dialog", { name: "Delete file?" });
  expect(dialog).toHaveTextContent("src/main.tea");
  expect(rpc.workspace.remove.mutate).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(target.api.close).not.toHaveBeenCalled();

  openContextMenu(screen.getByRole("button", { name: "main.tea" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Delete file" }),
  );
  dialog = await screen.findByRole("dialog", { name: "Delete file?" });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Delete file" }),
    ).toBeEnabled(),
  );
  rpc.workspace.remove.mutate.mockRejectedValueOnce(
    new Error("File changed on disk"),
  );
  await user.click(within(dialog).getByRole("button", { name: "Delete file" }));
  await findErrorToast("Couldn’t delete file");
  expect(dialog).toBeInTheDocument();
  expect(target.api.close).not.toHaveBeenCalled();
  expect(target.params.dirty).toBe(true);
  expect(rpc.workspace.remove.mutate).toHaveBeenCalledExactlyOnceWith({
    workspaceId: defaultWorkspace.id,
    path: "src/main.tea",
    expected: "a".repeat(64),
  });

  let complete!: () => void;
  rpc.workspace.remove.mutate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Delete file" }),
    ).toBeEnabled(),
  );
  await user.click(within(dialog).getByRole("button", { name: "Delete file" }));
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(dialog).toBeInTheDocument();
  expect(target.api.close).not.toHaveBeenCalled();
  rpc.workspace.listDirectory.query.mockResolvedValue({
    status: "ready",
    entries: [],
    directories: [],
  });
  await act(async () => complete());
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "main.tea" }),
    ).not.toBeInTheDocument(),
  );
  expect(target.api.close).toHaveBeenCalledOnce();
  expect(sibling.api.close).not.toHaveBeenCalled();
  expect(otherWorkspace.api.close).not.toHaveBeenCalled();
  expect(api.addPanel).not.toHaveBeenCalled();
});

test("read-only files cannot be deleted", async () => {
  const { user } = setup([], [defaultWorkspace], ["builtin.tea"]);
  rpc.workspace.read.query.mockResolvedValue({
    entry: { path: "builtin.tea", hash: "a".repeat(64) },
    mediaType: "text/plain",
    base64: btoa("builtin"),
    readOnly: true,
  });
  await user.click(await screen.findByRole("button", { name: "default" }));
  openContextMenu(await screen.findByRole("button", { name: "builtin.tea" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Delete file" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Delete file?" });
  expect(
    await within(dialog).findByText("Built-in files are read-only."),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("button", { name: "Delete file" }),
  ).toBeDisabled();
  expect(rpc.workspace.remove.mutate).not.toHaveBeenCalled();
});

test("forget protects the default identity, works for missing folders, and closes only that workspace after success", async () => {
  const workspaces = [
    { ...defaultWorkspace, root: "/workspaces/protected" },
    { ...researchWorkspace, root: "/another/default" },
  ];
  const { user } = setup([], workspaces);
  rpc.workspace.listDirectory.query.mockResolvedValue({ status: "missing" });
  const first = openPanel(researchWorkspace.id, "main.tea");
  const second = openPanel(researchWorkspace.id, "other.tea");
  const kept = openPanel(defaultWorkspace.id, "main.tea");
  openContextMenu(await screen.findByRole("button", { name: "protected" }));
  await screen.findByRole("menuitem", { name: "Create file" });
  expect(
    screen.queryByRole("menuitem", { name: "Forget workspace" }),
  ).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "New file in default" }),
    ).toBeEnabled(),
  );
  openContextMenu(screen.getByRole("button", { name: "default" }));
  expect(
    await screen.findByRole("menuitem", { name: "Create file" }),
  ).not.toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByRole("menuitem", { name: "Forget workspace" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Forget workspace?",
  });
  expect(dialog).toHaveTextContent("/another/default");
  expect(dialog).toHaveTextContent("Files on disk will be kept.");
  rpc.resources.workspace.forget.mutate.mockRejectedValueOnce(
    new Error("Forget failed"),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Forget workspace" }),
  );
  await findErrorToast("Couldn’t forget workspace");
  expect(first.api.close).not.toHaveBeenCalled();
  expect(dialog).toBeInTheDocument();
  rpc.resources.workspace.forget.mutate.mockImplementationOnce(async () => {
    rpc.resources.workspace.list.query.mockResolvedValue({
      items: [workspaces[0]],
      nextCursor: null,
    });
  });
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Forget workspace" }),
    ).toBeEnabled(),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Forget workspace" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "default" }),
    ).not.toBeInTheDocument(),
  );
  expect(rpc.resources.workspace.forget.mutate).toHaveBeenLastCalledWith({
    id: researchWorkspace.id,
  });
  expect(first.api.close).toHaveBeenCalledOnce();
  expect(second.api.close).toHaveBeenCalledOnce();
  expect(kept.api.close).not.toHaveBeenCalled();
  expect(rpc.workspace.remove.mutate).not.toHaveBeenCalled();
});

test.each(["dirty", "saving"] as const)(
  "protects %s tabs from outer navigation and window exits, then cleans up on unmount",
  async (flag) => {
    const { user, router } = setup();
    await screen.findByRole("button", { name: "default" });
    api.panels.push({ params: { [flag]: true } });

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    await user.click(screen.getByRole("link", { name: "Leave workspace" }));
    await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    expect(router.state.location.pathname).toBe("/");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");

    await user.click(screen.getByRole("link", { name: "Leave workspace" }));
    await user.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    expect(await screen.findByText("Next page")).toBeVisible();
    expect(router.state.location.pathname).toBe("/next");

    const afterUnmount = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  },
);

test("reads current tab flags so completed saves allow navigation and window exits", async () => {
  const { user, router } = setup();
  await screen.findByRole("button", { name: "default" });
  const panel = { params: { dirty: true, saving: true } };
  api.panels.push(panel);
  const beforeSave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(beforeSave);
  expect(beforeSave.defaultPrevented).toBe(true);

  panel.params.dirty = false;
  panel.params.saving = false;
  const afterSave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(afterSave);
  expect(afterSave.defaultPrevented).toBe(false);
  await user.click(screen.getByRole("link", { name: "Leave workspace" }));
  expect(await screen.findByText("Next page")).toBeVisible();
  expect(router.state.location.pathname).toBe("/next");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
