/// <reference types="vitest/jsdom" />
// Purpose: Verify the tree's identity, lazy listings, badges and row actions without a view around it.
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  FileTree,
  type FileTreeActions,
  type TreeEntry,
} from "@openchart/app/features/workspace/components/file-tree";
import { WorkspaceContext } from "@openchart/app/features/workspace/components/context";
import { createTransport } from "@openchart/app/lib/transport/transport";

const rpc = vi.hoisted(() => ({
  workspace: { listDirectory: { query: vi.fn() } },
}));
vi.mock("@trpc/client", async (original) => ({
  ...(await original<typeof import("@trpc/client")>()),
  createTRPCClient: () => rpc,
}));

function Harness(props: Partial<FileTreeActions>) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [focused, setFocused] = useState<TreeEntry | null>(null);
  return (
    <FileTree
      workspace={{ id: "wsp_test", root: "/workspaces/default" }}
      dirty={new Set()}
      search=""
      focused={focused}
      onFocus={setFocused}
      expanded={expanded}
      onExpandedChange={setExpanded}
      onOpen={vi.fn()}
      onCreate={vi.fn()}
      onDelete={vi.fn()}
      onMove={vi.fn()}
      onReveal={vi.fn()}
      onCopyPath={vi.fn()}
      canMove={() => true}
      {...props}
    />
  );
}

function setup(
  paths: string[],
  directories: string[],
  actions: Partial<FileTreeActions> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const transport = createTransport({ origin: "http://localhost:41000" });
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
  render(
    <QueryClientProvider client={client}>
      <WorkspaceContext.Provider
        value={{
          transport,
          languageError: undefined,
          onLanguageError: vi.fn(),
          teaSessions: { current: new Map() },
          openReference: vi.fn(),
          saves: { current: new Map() },
          instanceId: "test",
          collapsible: false,
          dark: false,
        }}
      >
        <Harness {...actions} />
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}
const row = (name: string) => screen.findByRole("treeitem", { name });

// Context Menu attaches DOM listeners with a signal from the browser realm.
beforeEach(() =>
  vi.stubGlobal("AbortController", jsdom.window.AbortController),
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("sorts folders first, keeps duplicate basenames distinct and opens exact paths", async () => {
  const open = vi.fn();
  const { user } = setup(
    ["z.pdf", "Makefile", "one/same.tea", "two/same.tea"],
    ["empty", "empty/nested", "one", "two"],
    { onOpen: open },
  );
  await row("z.pdf");
  expect(
    screen
      .getAllByRole("treeitem")
      .map((item) => item.getAttribute("aria-label")),
  ).toEqual(["empty", "one", "two", "z.pdf", "Makefile"]);
  expect(await row("z.pdf")).toHaveAttribute("title", "z.pdf");
  expect(within(await row("z.pdf")).getByText("pdf")).toBeVisible();
  // A name without an extension keeps a plain icon instead of a badge.
  expect(await row("Makefile")).toHaveTextContent(/^Makefile$/);
  await user.click(await row("one"));
  await user.click(await row("two"));
  const copies = await screen.findAllByRole("treeitem", { name: "same.tea" });
  expect(copies.map((item) => item.getAttribute("title"))).toEqual([
    "one/same.tea",
    "two/same.tea",
  ]);
  expect(copies.map((item) => item.getAttribute("aria-level"))).toEqual([
    "2",
    "2",
  ]);
  await user.click(copies[1]!);
  expect(open).toHaveBeenCalledExactlyOnceWith("two/same.tea");
});

test("lists a folder only once it is expanded", async () => {
  const { user } = setup(["empty/nested/deep.md"], ["empty", "empty/nested"]);
  const folder = await row("empty");
  expect(folder).toHaveAttribute("aria-expanded", "false");
  expect(rpc.workspace.listDirectory.query).toHaveBeenCalledExactlyOnceWith(
    { workspaceId: "wsp_test", path: "" },
    expect.anything(),
  );
  await user.click(folder);
  expect(await row("nested")).toHaveAttribute("title", "empty/nested");
  expect(rpc.workspace.listDirectory.query).toHaveBeenLastCalledWith(
    { workspaceId: "wsp_test", path: "empty" },
    expect.anything(),
  );
  expect(folder).toHaveAttribute("aria-expanded", "true");
});

test("folder rows add files without toggling, and menus target their own row", async () => {
  const create = vi.fn();
  const open = vi.fn();
  const { user } = setup(["src/main.tea"], ["src"], {
    onCreate: create,
    onOpen: open,
  });
  const folder = await row("src");
  await user.click(screen.getByRole("button", { name: "New file in src" }));
  expect(create).toHaveBeenCalledExactlyOnceWith("file", "src");
  expect(folder).toHaveAttribute("aria-expanded", "false");
  fireEvent.contextMenu(folder);
  await user.click(await screen.findByRole("menuitem", { name: "New folder" }));
  expect(create).toHaveBeenLastCalledWith("folder", "src");
  await user.click(folder);
  const file = await row("main.tea");
  fireEvent.contextMenu(file);
  expect(
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
  ).toEqual(["Rename", "Copy path", "Reveal in Finder", "Delete"]);
  expect(open).not.toHaveBeenCalled();
});
