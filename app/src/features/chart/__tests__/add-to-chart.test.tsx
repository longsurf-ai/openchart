// Purpose: A Workspace tab's Add to chart saves first, decides on the saved content, asks for required inputs, and targets the Dashboard's cell.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Field, Float64, Schema, Utf8 } from "apache-arrow";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { AddToChartAction } from "@openchart/app/features/chart/components/add-to-chart";
import {
  chartDetail,
  createCell,
  type ChartResource,
} from "@openchart/app/features/chart/api/queries";
import { useTeaSource } from "@openchart/app/hooks/use-tea";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { workspaceQueryKeys } from "@openchart/app/lib/workspace/workspace";
import {
  act,
  findErrorToast,
  fireEvent,
  renderWithToaster as render,
  screen,
  waitFor,
} from "@openchart/app/testing/test-utils";

const tea = vi.hoisted(() => ({
  url: "test",
  compile: vi.fn(),
  snapshot: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("@openchart/app/hooks/use-tea-client", () => ({
  useTeaClient: () => tea,
}));
afterEach(() => vi.unstubAllGlobals());

const file = { workspaceId: "wsp_test", path: "indicators/band.tea" };
const content = (text: string) => ({
  entry: file.path,
  sources: { [file.path]: text },
});
const outputs = new Schema([
  new Field("value", new Float64(), true, new Map([["tea:write", "set"]])),
]);
// `length` has no default, so adding asks for it.
const band = (id: string, required: boolean, columns = outputs) => ({
  id,
  declaration: {
    kind: "indicator",
    title: "Band",
    overlay: true,
    timeframe: "",
  },
  definition: {
    parameters: required
      ? [{ name: "length", title: "Length", type: "int" }]
      : [],
    inputs: new Schema([]),
    outputs: columns,
    requests: {},
  },
});
const cell = () =>
  createCell(
    {
      provider: "test",
      listing: { symbol: "AAA", currency: "USD" },
    } as Parameters<typeof createCell>[0],
    { resolution: "1d", session: "regular", adjustment: "raw" },
  );

function setup(prepare: () => Promise<void>, beside?: ReactNode) {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const [first, second] = [cell(), cell()];
  const chart = {
    id: "cht_test",
    revision: 4,
    cells: [first, second],
    links: [],
    preset: "1x2",
  } as unknown as ChartResource;
  const add = vi.fn().mockResolvedValue({ chart: { ...chart, revision: 5 } });
  const transport = {
    url: "test",
    rpc: {
      resources: {
        macro: { addIndicator: { mutate: add } },
        indicator: {
          list: {
            query: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
          },
        },
      },
    },
  } as unknown as AppTransport;
  // The app's defaults: reads stay fresh for a minute unless the hook re-reads.
  const client = createQueryClient();
  client.setQueryData(chartDetail(transport, chart.id).queryKey, chart);
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AddToChartAction
          transport={transport}
          chartId={chart.id}
          file={file}
          prepare={prepare}
        />
        {beside}
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return {
    add,
    first,
    // What `workspace.changed` or a Workspace write does.
    refresh: () =>
      act(() => client.invalidateQueries({ queryKey: workspaceQueryKeys.all })),
    unmount: () => view.unmount(),
    cleanup: () => (view.unmount(), client.clear()),
  };
}

it("saves the file, asks for required inputs, then adds it to the target cell", async () => {
  tea.snapshot.mockResolvedValue(content("band"));
  tea.compile.mockResolvedValue(band("node", true));
  tea.dispose.mockResolvedValue(undefined);
  const prepare = vi.fn().mockResolvedValue(undefined);
  const { add, first, cleanup } = setup(prepare);
  try {
    const button = await screen.findByRole("button", { name: "Add to chart" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const length = await screen.findByRole("spinbutton", { name: "Length" });
    expect(tea.compile).toHaveBeenCalledExactlyOnceWith(content("band"));
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      tea.snapshot.mock.invocationCallOrder[0]!,
    );
    expect(add).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    fireEvent.change(length, { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // No focused cell: the first visible cell, as the Dashboard header targets.
    await waitFor(() =>
      expect(add).toHaveBeenCalledExactlyOnceWith({
        chartId: "cht_test",
        expectedRevision: 4,
        cellId: first.id,
        source: file,
        parameterOverrides: { length: 14 },
      }),
    );
    await waitFor(() =>
      expect(tea.dispose).toHaveBeenCalledWith({ id: "node" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  } finally {
    cleanup();
  }
});

it("adds a script without required inputs once, without a dialog, and releases its compilation", async () => {
  tea.snapshot.mockResolvedValue(content("band"));
  tea.compile.mockResolvedValue(band("node", false));
  tea.dispose.mockResolvedValue(undefined);
  const { add, first, cleanup } = setup(vi.fn().mockResolvedValue(undefined));
  try {
    const button = await screen.findByRole("button", { name: "Add to chart" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(add).toHaveBeenCalledExactlyOnceWith({
        chartId: "cht_test",
        expectedRevision: 4,
        cellId: first.id,
        source: file,
        parameterOverrides: {},
      }),
    );
    await waitFor(() =>
      expect(tea.dispose).toHaveBeenCalledExactlyOnceWith({ id: "node" }),
    );
    await waitFor(() => expect(button).toBeEnabled());
    expect(add).toHaveBeenCalledOnce();
    expect(tea.compile).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  } finally {
    cleanup();
  }
});

it("decides on the saved content even when an older read of the file is cached", async () => {
  // The chart already follows this file (as a Reload marker does), so its read is cached.
  function Live() {
    const live = useTeaSource(file);
    return (
      <output aria-label="Live">{live.program?.sources[file.path]}</output>
    );
  }
  tea.snapshot.mockResolvedValue(content("needs length"));
  tea.compile.mockImplementation(
    async ({ sources }: { sources: Record<string, string> }) =>
      sources[file.path] === "needs length"
        ? band("old", true)
        : band("saved", false),
  );
  tea.dispose.mockResolvedValue(undefined);
  // The save changes the disk; nothing has invalidated the cached read yet.
  const prepare = vi.fn(async () => {
    tea.snapshot.mockResolvedValue(content("has defaults"));
  });
  const { add, cleanup } = setup(prepare, <Live />);
  try {
    expect(await screen.findByText("needs length")).toBeInTheDocument();
    const button = await screen.findByRole("button", { name: "Add to chart" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(add.mock.calls[0]![0].parameterOverrides).toEqual({});
    expect(tea.compile).toHaveBeenCalledExactlyOnceWith(
      content("has defaults"),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("has defaults")).toBeInTheDocument();
  } finally {
    cleanup();
  }
});

it("unmounting mid-add releases the late compilation and adds nothing", async () => {
  tea.snapshot.mockResolvedValue(content("band"));
  let finish!: () => void;
  tea.compile.mockReturnValue(
    new Promise((resolve) => {
      finish = () => resolve(band("late", false));
    }),
  );
  tea.dispose.mockResolvedValue(undefined);
  const { add, unmount, cleanup } = setup(vi.fn().mockResolvedValue(undefined));
  try {
    const button = await screen.findByRole("button", { name: "Add to chart" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(tea.compile).toHaveBeenCalledOnce());
    unmount();
    await act(async () => finish());
    await waitFor(() =>
      expect(tea.dispose).toHaveBeenCalledExactlyOnceWith({ id: "late" }),
    );
    expect(add).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

it("stops before reading the file when saving it fails", async () => {
  const prepare = vi.fn().mockRejectedValue(new Error("Disk full"));
  const { add, cleanup } = setup(prepare);
  try {
    const button = await screen.findByRole("button", { name: "Add to chart" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    await waitFor(() => expect(button).toBeEnabled());
    expect(tea.snapshot).not.toHaveBeenCalled();
    expect(tea.compile).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

it("keeps the inputs dialog and its typed value while the file changes or a re-read fails, and adds only on Save", async () => {
  tea.snapshot.mockResolvedValue(content("band"));
  tea.compile.mockImplementation(
    async ({ sources }: { sources: Record<string, string> }) =>
      sources[file.path] === "band"
        ? band("node", true)
        : band("edited", false),
  );
  tea.dispose.mockResolvedValue(undefined);
  const { add, first, refresh, cleanup } = setup(
    vi.fn().mockResolvedValue(undefined),
  );
  try {
    const button = await screen.findByRole("button", { name: "Add to chart" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const length = await screen.findByRole("spinbutton", { name: "Length" });
    fireEvent.change(length, { target: { value: "14" } });
    // An outside edit gives `length` a default, then a re-read fails.
    tea.snapshot.mockResolvedValue(content("band with a default length"));
    await refresh();
    await waitFor(() => expect(tea.compile).toHaveBeenCalledTimes(2));
    tea.snapshot.mockRejectedValue(new Error("Tea source is unavailable"));
    await refresh();
    expect(screen.getByRole("spinbutton", { name: "Length" })).toBe(length);
    expect(length).toHaveValue(14);
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledExactlyOnceWith({
        chartId: "cht_test",
        expectedRevision: 4,
        cellId: first.id,
        source: file,
        parameterOverrides: { length: 14 },
      }),
    );
  } finally {
    cleanup();
  }
});

const unshowable = band(
  "text",
  false,
  new Schema([
    new Field("label", new Utf8(), true, new Map([["tea:write", "set"]])),
  ]),
);
it.each([
  [
    "cannot be read",
    () =>
      tea.snapshot.mockRejectedValue(new Error("Tea source is unavailable")),
    "Tea source is unavailable",
  ],
  [
    "does not compile",
    () => tea.compile.mockRejectedValue(new Error("Unexpected token")),
    "Unexpected token",
  ],
  [
    "declares outputs the chart cannot show",
    () => tea.compile.mockResolvedValue(unshowable),
    "is not a supported",
  ],
])(
  "a file that %s ends the add once with a toast, adding nothing",
  async (_, arrange, message) => {
    tea.snapshot.mockResolvedValue(content("band"));
    tea.dispose.mockResolvedValue(undefined);
    arrange();
    const { add, cleanup } = setup(vi.fn().mockResolvedValue(undefined));
    try {
      const button = await screen.findByRole("button", {
        name: "Add to chart",
      });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      expect(await findErrorToast(message)).toHaveTextContent(
        "Couldn’t add indicator",
      );
      await waitFor(() => expect(button).toBeEnabled());
      expect(tea.snapshot).toHaveBeenCalledOnce();
      expect(add).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      cleanup();
    }
  },
);

it("a failed chart save toasts, and the add can be retried", async () => {
  tea.snapshot.mockResolvedValue(content("band"));
  tea.compile.mockResolvedValue(band("node", false));
  tea.dispose.mockResolvedValue(undefined);
  const { add, cleanup } = setup(vi.fn().mockResolvedValue(undefined));
  add.mockRejectedValueOnce(new Error("Chart is busy"));
  try {
    const button = await screen.findByRole("button", { name: "Add to chart" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await findErrorToast("Chart is busy");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
  } finally {
    cleanup();
  }
});
