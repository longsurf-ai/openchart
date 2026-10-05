/// <reference types="vitest/jsdom" />
// Purpose: Verify file identity and real sidebar folder activation without a second tree store.
import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@openchart/app/components/ui/sidebar";
import { FileTree } from "@openchart/app/features/workspace/components/file-tree";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTransport } from "@openchart/app/lib/transport/transport";
const rpc = vi.hoisted(() => ({
  workspace: { listDirectory: { query: vi.fn() } },
}));
vi.mock("@trpc/client", async (original) => ({
  ...(await original<typeof import("@trpc/client")>()),
  createTRPCClient: () => rpc,
}));
function setup(
  paths: string[],
  directories: string[],
  actions: {
    onOpen?: (path: string) => void;
    onCreate?: (kind: "file" | "folder", directory: string) => void;
  } = {},
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
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <FileTree
          transport={transport}
          workspaceId="wsp_test"
          directory=""
          onOpen={actions.onOpen ?? vi.fn()}
          onCreate={actions.onCreate ?? vi.fn()}
          onDelete={vi.fn()}
        />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

// Context Menu attaches DOM listeners with a signal from the browser realm.
beforeEach(() =>
  vi.stubGlobal("AbortController", jsdom.window.AbortController),
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("keeps duplicate basenames distinct and sorts folders before files", async () => {
  const open = vi.fn();
  setup(
    ["z.pdf", "two/same.tea", "one/same.tea"],
    ["empty", "empty/nested", "one", "two"],
    { onOpen: open },
  );
  await screen.findByRole("button", { name: "z.pdf" });
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["empty", "one", "two", "z.pdf"]);
  expect(rpc.workspace.listDirectory.query).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "one" }));
  fireEvent.click(await screen.findByRole("button", { name: "same.tea" }));
  expect(open).toHaveBeenCalledWith("one/same.tea");
});
test("starts folders collapsed and opens the full relative path after expanding", async () => {
  const open = vi.fn();
  setup(["src/main.workflow.ts"], ["src"], { onOpen: open });
  await screen.findByRole("button", { name: "src" });
  expect(screen.getByRole("button", { name: "src" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "src" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "main.workflow.ts" }),
  );
  expect(open).toHaveBeenCalledWith("src/main.workflow.ts");
  fireEvent.click(screen.getByRole("button", { name: "src" }));
  expect(screen.getByRole("button", { name: "src" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test.each([
  ["nested", "src/nested"],
  ["main.workflow.ts", "src/nested/main.workflow.ts"],
])("shows the full path when %s receives focus", async (name, path) => {
  setup(["src/nested/main.workflow.ts"], ["src", "src/nested"]);
  fireEvent.click(await screen.findByRole("button", { name: "src" }));
  await screen.findByRole("button", { name: "nested" });
  if (name === "main.workflow.ts") {
    fireEvent.click(screen.getByRole("button", { name: "nested" }));
    await screen.findByRole("button", { name });
  }
  act(() => screen.getByRole("button", { name }).focus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent(path);
});

test.each(["src", "main.workflow.ts"])(
  "right-clicking %s creates inside its directory without opening the file",
  async (target) => {
    const onOpen = vi.fn();
    const onCreate = vi.fn();
    const { click } = userEvent.setup();
    setup(["src/main.workflow.ts"], ["src"], { onOpen, onCreate });
    await screen.findByRole("button", { name: "src" });
    if (target === "main.workflow.ts") {
      await click(screen.getByRole("button", { name: "src" }));
      await screen.findByRole("button", { name: target });
    }
    fireEvent.contextMenu(screen.getByRole("button", { name: target }));
    expect(await screen.findAllByRole("menuitem")).toHaveLength(
      target === "src" ? 2 : 3,
    );
    await click(screen.getByRole("menuitem", { name: "Create file" }));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith("file", "src");
    expect(onOpen).not.toHaveBeenCalled();
  },
);
