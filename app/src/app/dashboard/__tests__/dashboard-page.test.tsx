import { renderWithToaster as render } from "@openchart/app/testing/test-utils";
import {
  findErrorToast,
  getErrorToast,
} from "@openchart/app/testing/test-utils";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
// Purpose: Exercise Dashboard gesture persistence and generic widget ownership without chart runtimes.
import { defineId } from "@openchart/identifier";
import {
  AuiConfig,
  AuiProvider,
  ModelContextClient,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { GridLayoutProps, Layout } from "react-grid-layout";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DashboardPage } from "@openchart/app/app/dashboard/dashboard-page";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import {
  dashboardQueryOptions,
  type Dashboard,
} from "@openchart/app/features/dashboard/api/queries";
import { useWidget, useWidgetControls } from "@openchart/app/hooks/use-widget";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@openchart/app/lib/unsaved-changes/unsaved-changes";

const harness = vi.hoisted(() => ({
  width: 1200,
  resizeHeight: (() => {}) as (height: number) => void,
  actualGrid: false,
  grid: undefined as GridLayoutProps | undefined,
  transport: undefined as AppTransport | undefined,
  mounted: vi.fn(),
}));

vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useParams: () => ({ dashboardId: "dsh_test" }),
  useOutletContext: () => ({ transport: harness.transport }),
}));
vi.mock("react-grid-layout", async (original) => {
  const library = await original<typeof import("react-grid-layout")>();
  return {
    ...library,
    default: (props: GridLayoutProps) => {
      harness.grid = props;
      return harness.actualGrid ? (
        <library.GridLayout {...props} />
      ) : (
        <div>{props.children}</div>
      );
    },
    useContainerWidth: () => ({
      width: harness.width,
      mounted: true,
      containerRef: useRef<HTMLDivElement>(null),
    }),
  };
});
vi.mock("@openchart/app/app/page-header", () => ({
  PageHeader: ({ children }: PropsWithChildren) => <header>{children}</header>,
}));
vi.mock("@openchart/app/features/chart/components/symbol-control", () => ({
  SymbolControl: () => null,
}));
vi.mock("@openchart/app/app/widgets/widget-gallery", () => ({
  WidgetGallery: ({
    disabled,
    onAddWorkspace,
    onAddChart,
  }: {
    disabled: boolean;
    onAddWorkspace: () => void;
    onAddChart: () => void;
  }) => (
    <>
      <button disabled={disabled} onClick={onAddWorkspace}>
        Widgets
      </button>
      <button disabled={disabled} onClick={onAddChart}>
        Chart fixture
      </button>
    </>
  ),
}));
vi.mock("@openchart/app/app/widgets/widget-registry", async (original) => {
  const actual =
    await original<
      typeof import("@openchart/app/app/widgets/widget-registry")
    >();
  const fixture = {
    kind: "fixture",
    title: "Fixture",
    Icon: () => null,
    defaultSize: { w: 6, h: 8 },
    minSize: { w: 2, h: 2 },
    Content: FixtureContent,
    Controls: FixtureControls,
  };
  return {
    ...actual,
    widgetRegistry: { chart: fixture, fixture, workspace: fixture },
  };
});

function FixtureContent() {
  const { placementId } = useWidget();
  const changes = useUnsavedChanges();
  const [draft, setDraft] = useState("");
  useEffect(
    () => changes?.register(placementId, () => draft.length > 0),
    [changes, placementId, draft],
  );
  useEffect(() => {
    harness.mounted(placementId);
  }, [placementId]);
  return (
    <>
      <p>Content {placementId}</p>
      <textarea
        aria-label={`Draft ${placementId}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <canvas aria-label={`Canvas ${placementId}`} role="img" />
    </>
  );
}

// Docks like a Workspace: its own kind and minimum size, independent of the fixture registry.
const besideDefinition = {
  kind: "workspace",
  title: "Workspace",
  Icon: () => null,
  defaultSize: { w: 12, h: 14 },
  minSize: { w: 3, h: 6 },
  Content: () => null,
};

function FixtureControls() {
  const { placementId, placeBeside } = useWidget();
  const [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState<string>();
  useWidgetControls(open);
  return (
    <>
      <button
        onClick={() => {
          try {
            setPlaced(placeBeside(besideDefinition, "wsp_research"));
          } catch (error) {
            setPlaced((error as Error).message);
          }
        }}
      >
        Place beside {placementId}
      </button>
      {placed ? <p>Placed {placed}</p> : null}
      <button onClick={() => setOpen(true)}>Inspect {placementId}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Fixture details</DialogTitle>
          <DialogDescription>A portaled widget control.</DialogDescription>
          <button onClick={() => setOpen(false)}>Finish inspection</button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
const placementId = defineId("wdg", "WidgetPlacement.ID");
beforeEach(() => {
  harness.width = 1200;
  harness.actualGrid = false;
  harness.grid = undefined;
  harness.mounted.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe(element: Element) {
        if (element.getAttribute("aria-label") !== "Dashboard grid") return;
        harness.resizeHeight = (height) =>
          this.callback([{ contentRect: { width: harness.width, height } }]);
        harness.resizeHeight(760);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  routers.splice(0).forEach((router) => router.dispose());
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(protectDrafts = false) {
  const resource: Dashboard = {
    id: defineId("dsh", "Dashboard.ID").make("dsh_test"),
    name: "Research",
    favorite: false,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    widgets: [
      {
        id: placementId.make("wdg_one"),
        kind: "fixture",
        layout: { x: 0, y: 0, w: 6, h: 8 },
      },
      {
        id: placementId.make("wdg_two"),
        kind: "fixture",
        layout: { x: 6, y: 0, w: 6, h: 8 },
      },
      {
        id: placementId.make("wdg_unknown"),
        kind: "future",
        layout: { x: 0, y: 8, w: 6, h: 8 },
      },
    ],
  };
  const get = vi.fn().mockResolvedValue(resource);
  const patch = vi.fn();
  const createChart = vi.fn();
  const transport = {
    url: "http://dashboard.test",
    rpc: {
      resources: {
        macro: { createChartWidget: { mutate: createChart } },
        dashboard: { get: { query: get }, patch: { mutate: patch } },
      },
    },
  } as unknown as AppTransport;
  harness.transport = transport;
  const client = createQueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  const key = dashboardQueryOptions(transport, resource.id).queryKey;
  client.setQueryData(key, resource);
  const router = protectDrafts
    ? createMemoryRouter([
        {
          path: "/",
          element: (
            <UnsavedChangesProvider>
              <DashboardPage />
            </UnsavedChangesProvider>
          ),
        },
      ])
    : undefined;
  if (router) routers.push(router);
  const context = AuiConfig({ modelContext: ModelContextClient() });
  const element = () => (
    <QueryClientProvider client={client}>
      <AuiProvider config={context}>
        <TooltipProvider delayDuration={0}>
          {router ? <RouterProvider router={router} /> : <DashboardPage />}
        </TooltipProvider>
      </AuiProvider>
    </QueryClientProvider>
  );
  const view = render(element());
  return {
    resource,
    get,
    patch,
    createChart,
    client,
    key,
    user: userEvent.setup(),
    resize: (width: number) => {
      harness.width = width;
      view.rerender(element());
    },
  };
}

function gesture(
  kind: "Drag" | "Resize",
  phase: "Start" | "Stop",
  layout = harness.grid!.layout!,
) {
  act(() => {
    harness.grid![`on${kind}${phase}`]?.(
      layout,
      null,
      null,
      null,
      new Event("pointerup"),
      null,
    );
  });
}

function reposition(): Layout {
  return harness.grid!.layout!.map((item) =>
    item.i === "wdg_one" ? { ...item, y: 16 } : item,
  );
}

it("resizes a fixed row budget with its container without saving or remounting widgets", async () => {
  harness.actualGrid = true;
  const { resource, patch, resize, user } = setup();
  const draft = screen.getByRole("textbox", { name: "Draft wdg_one" });
  await user.type(draft, "Unsaved work");
  const layout = harness.grid!.layout;
  expect(harness.grid!.gridConfig).toMatchObject({
    rowHeight: 24,
    maxRows: 24,
  });
  expect(harness.grid!.autoSize).toBe(false);
  expect(harness.grid!.style).toEqual({ height: 760 });
  expect(harness.grid!.dragConfig?.bounded).toBe(true);

  act(() => harness.resizeHeight(1000));
  expect(harness.grid!.gridConfig?.rowHeight).toBe(34);
  expect(harness.grid!.style).toEqual({ height: 1000 });
  act(() => harness.resizeHeight(520));
  expect(harness.grid!.gridConfig?.rowHeight).toBe(14);
  expect(harness.grid!.layout).toBe(layout);
  expect(resource.widgets[0]!.layout.h).toBe(8);
  expect(draft).toHaveValue("Unsaved work");
  act(() => harness.resizeHeight(0));
  expect(harness.grid!.style).toEqual({ height: 520 });
  expect(draft).toHaveValue("Unsaved work");

  resize(480);
  expect(harness.grid!.autoSize).toBe(true);
  expect(harness.grid!.gridConfig).toMatchObject({
    rowHeight: 24,
    maxRows: Infinity,
  });
  resize(1200);
  expect(harness.grid!.autoSize).toBe(false);
  expect(harness.grid!.gridConfig?.rowHeight).toBe(14);
  expect(harness.mounted).toHaveBeenCalledTimes(2);
  expect(patch).not.toHaveBeenCalled();
});

it("renders every placement, keeps unknown kinds removable, and does not write during layout observation", async () => {
  const { patch } = setup();
  const grid = screen.getByRole("region", { name: "Dashboard grid" });
  expect(grid).toHaveClass("px-3", "pb-3");
  expect(grid).not.toHaveClass("p-3");
  for (const card of screen.getAllByRole("region", { name: "Fixture" })) {
    expect(card).toHaveClass("relative", "size-full");
    expect(card).not.toHaveClass("grid");
    expect(
      within(card).getByRole("toolbar", { name: "Widget controls" }),
    ).toHaveClass("absolute", "top-0", "-translate-y-1/2");
  }
  expect(screen.getByRole("heading", { name: "Research" })).toHaveClass(
    "sr-only",
  );
  expect(
    screen.queryByRole("button", { name: "Arrange" }),
  ).not.toBeInTheDocument();
  expect(harness.grid!.dragConfig?.enabled).toBe(true);
  expect(harness.grid!.resizeConfig?.enabled).toBe(true);
  expect(screen.getByText("Content wdg_one")).toBeInTheDocument();
  expect(screen.getByText("Content wdg_two")).toBeInTheDocument();
  const unknown = screen.getByRole("region", {
    name: "Unsupported widget: future",
  });
  expect(unknown).toHaveTextContent(
    "This widget type isn’t available: future.",
  );
  act(() => {
    harness.grid!.onLayoutChange?.(reposition());
    harness.grid!.onDrag?.(
      reposition(),
      null,
      null,
      null,
      new Event("pointermove"),
      null,
    );
  });
  expect(patch).not.toHaveBeenCalled();
  expect(
    within(unknown).getByRole("button", { name: "Remove from dashboard" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "Widget options" }),
  ).not.toBeInTheDocument();
});

it("uses shared tooltips for the widget move and remove buttons", async () => {
  const { user, patch } = setup();
  const card = screen.getAllByRole("region", { name: "Fixture" })[0]!;
  for (const [name, label] of [
    ["Move Fixture", "Drag to move. Arrow keys move."],
    ["Remove from dashboard", "Remove from dashboard"],
  ]) {
    const button = within(card).getByRole("button", { name });
    expect(button).not.toHaveAttribute("title");
    await user.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(label!);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  }
  expect(patch).not.toHaveBeenCalled();
});

it("saves once on stop against the gesture-start revision and locks until Query confirms the commit", async () => {
  const { resource, patch, get, client, key } = setup();
  const mutation = deferred<Dashboard>();
  const refresh = deferred<Dashboard>();
  patch.mockReturnValue(mutation.promise);
  get.mockReturnValue(refresh.promise);
  expect(harness.grid!.dragConfig).toMatchObject({
    enabled: true,
    handle: "[data-widget-drag-handle]",
  });
  gesture("Drag", "Start");
  const incoming = { ...resource, revision: 2, name: "Renamed remotely" };
  act(() => {
    client.setQueryData(key, incoming);
  });
  await screen.findByText("Renamed remotely");
  gesture("Drag", "Stop", reposition());
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(patch).toHaveBeenCalledWith({
    id: resource.id,
    expectedRevision: 1,
    operations: [
      {
        op: "replace",
        path: "/widgets",
        value: resource.widgets.map((widget) =>
          widget.id === "wdg_one"
            ? { ...widget, layout: { ...widget.layout, y: 16 } }
            : widget,
        ),
      },
    ],
  });
  expect(client.getQueryData(key)).toEqual(incoming);
  expect(harness.grid!.dragConfig?.enabled).toBe(false);
  expect(harness.grid!.resizeConfig?.enabled).toBe(false);
  const committed: Dashboard = {
    ...incoming,
    revision: 3,
    widgets: patch.mock.calls[0]![0].operations[0].value,
  };
  await act(async () => {
    mutation.resolve(committed);
  });
  await screen.findByText("Refreshing dashboard…");
  expect(client.getQueryData(key)).toEqual(incoming);
  expect(harness.grid!.dragConfig?.enabled).toBe(false);
  await act(async () => {
    refresh.resolve(committed);
  });
  await waitFor(() => expect(harness.grid!.dragConfig?.enabled).toBe(true));
  expect(client.getQueryData(key)).toEqual(committed);
  expect(harness.mounted).toHaveBeenCalledTimes(2);
});

it("submits resize once and keeps content mounted across width changes", async () => {
  const { resource, patch, resize } = setup();
  patch.mockReturnValue(new Promise(() => undefined));
  resize(480);
  expect(harness.grid!.gridConfig?.cols).toBe(1);
  expect(harness.grid!.dragConfig?.enabled).toBe(false);
  expect(harness.grid!.resizeConfig?.enabled).toBe(false);
  expect(harness.grid!.layout!.map(({ i, x, w }) => ({ i, x, w }))).toEqual(
    resource.widgets.map(({ id }) => ({ i: id, x: 0, w: 1 })),
  );
  expect(patch).not.toHaveBeenCalled();
  resize(1200);
  expect(harness.grid!.gridConfig?.cols).toBe(12);
  gesture("Resize", "Start");
  gesture(
    "Resize",
    "Stop",
    harness.grid!.layout!.map((item) =>
      item.i === "wdg_two" ? { ...item, w: 4 } : item,
    ),
  );
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(patch.mock.calls[0]![0].operations[0].value[1].layout.w).toBe(4);
  expect(harness.mounted).toHaveBeenCalledTimes(2);
});

it("keeps failed mutation variables for retry even after a newer revision arrives", async () => {
  const { resource, patch, client, key, user } = setup();
  patch
    .mockRejectedValueOnce(new Error("Connection unavailable"))
    .mockReturnValue(new Promise(() => undefined));
  gesture("Drag", "Start");
  gesture("Drag", "Stop", reposition());
  await findErrorToast();
  expect(getErrorToast()).toHaveTextContent(
    "Dashboard changes haven’t been saved",
  );
  expect(harness.grid!.dragConfig?.enabled).toBe(false);
  act(() => {
    client.setQueryData(key, { ...resource, revision: 2 });
  });
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  expect(patch.mock.calls[1]![0]).toEqual(patch.mock.calls[0]![0]);
  expect(patch.mock.calls[1]![0].expectedRevision).toBe(1);
});

it("discards failed changes only after an authoritative reload and resets the grid boundary", async () => {
  const { resource, patch, get, user } = setup();
  patch.mockRejectedValue(new Error("Save unavailable"));
  const refresh = deferred<Dashboard>();
  get.mockReturnValue(refresh.promise);
  gesture("Drag", "Start");
  gesture("Drag", "Stop", reposition());
  await user.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  expect(harness.mounted).toHaveBeenCalledTimes(2);
  expect(harness.grid!.dragConfig?.enabled).toBe(false);
  await act(async () => {
    refresh.resolve(resource);
  });
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(harness.mounted).toHaveBeenCalledTimes(4);
  expect(harness.grid!.dragConfig?.enabled).toBe(true);
});

it("protects dirty editor drafts before discarding failed layout changes", async () => {
  const { resource, patch, get, user } = setup(true);
  await user.type(
    screen.getByRole("textbox", { name: "Draft wdg_one" }),
    "unsaved Tea code",
  );
  patch.mockRejectedValue(new Error("Save unavailable"));
  const refresh = deferred<Dashboard>();
  get.mockReturnValue(refresh.promise);
  gesture("Drag", "Start");
  gesture("Drag", "Stop", reposition());
  await user.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Discard unsaved changes?",
  });
  expect(harness.mounted).toHaveBeenCalledTimes(2);
  await user.click(
    within(dialog).getByRole("button", { name: "Keep editing" }),
  );
  expect(screen.getByRole("textbox", { name: "Draft wdg_one" })).toHaveValue(
    "unsaved Tea code",
  );
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Discard changes",
    }),
  );
  await act(async () => refresh.resolve(resource));
  await waitFor(() => expect(harness.mounted).toHaveBeenCalledTimes(4));
  expect(screen.getByRole("textbox", { name: "Draft wdg_one" })).toHaveValue(
    "",
  );
});

it("adds workspace placements through the shared save state until Query confirms the revision", async () => {
  const { resource, patch, get, user, client, key } = setup();
  const response = deferred<Dashboard>();
  const refresh = deferred<Dashboard>();
  patch.mockReturnValue(response.promise);
  get.mockReturnValue(refresh.promise);
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  const input = patch.mock.calls[0]![0];
  const widgets = input.operations[0].value as Dashboard["widgets"];
  expect(input.expectedRevision).toBe(resource.revision);
  expect(widgets).toEqual([
    ...resource.widgets,
    {
      id: expect.stringMatching(/^wdg_/),
      kind: "workspace",
      layout: { x: 0, y: 16, w: 12, h: 14 },
    },
  ]);
  expect(harness.grid!.dragConfig?.enabled).toBe(false);
  expect(harness.grid!.resizeConfig?.enabled).toBe(false);
  expect(screen.getByRole("button", { name: "Widgets" })).toBeDisabled();
  expect(
    screen
      .getAllByRole("button", { name: "Remove from dashboard" })
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
  const saved = { ...resource, widgets, revision: 2 };
  await act(async () => response.resolve(saved));
  expect(client.getQueryData(key)).toEqual(resource);
  expect(harness.grid!.dragConfig?.enabled).toBe(false);
  await act(async () => refresh.resolve(saved));
  await waitFor(() => expect(harness.grid!.dragConfig?.enabled).toBe(true));
  expect(client.getQueryData(key)).toEqual(saved);
});

it("shares placement locking and authoritative refresh with chart creation", async () => {
  const { resource, createChart, get, user } = setup();
  const response = deferred<{ dashboard: Dashboard; chart: unknown }>();
  const refresh = deferred<Dashboard>();
  createChart.mockReturnValue(response.promise);
  get.mockReturnValue(refresh.promise);
  await user.click(screen.getByRole("button", { name: "Chart fixture" }));
  expect(createChart).toHaveBeenCalledExactlyOnceWith({
    dashboardId: resource.id,
    expectedRevision: resource.revision,
    layout: { x: 0, y: 16, w: 12, h: 12 },
    widgets: resource.widgets,
  });
  expect(harness.grid!.dragConfig?.enabled).toBe(false);
  expect(screen.getByRole("button", { name: "Widgets" })).toBeDisabled();
  const saved = { ...resource, revision: 2 };
  await act(async () => response.resolve({ dashboard: saved, chart: {} }));
  expect(harness.grid!.dragConfig?.enabled).toBe(false);
  await act(async () => refresh.resolve(saved));
  await waitFor(() => expect(harness.grid!.dragConfig?.enabled).toBe(true));
});

it.each(["Widgets", "Chart fixture"])(
  "fills the viewport when adding the first widget through %s",
  async (button) => {
    const { resource, patch, createChart, user, client, key } = setup();
    await act(async () => {
      client.setQueryData(key, { ...resource, widgets: [] });
    });
    const mutation = button === "Widgets" ? patch : createChart;
    mutation.mockReturnValue(deferred<never>().promise);
    await user.click(screen.getByRole("button", { name: button }));
    expect(mutation).toHaveBeenCalledTimes(1);
    const input = mutation.mock.calls[0]![0];
    const layout =
      button === "Widgets" ? input.operations[0].value[0].layout : input.layout;
    expect(input.expectedRevision).toBe(resource.revision);
    expect(layout).toEqual({ x: 0, y: 0, w: 12, h: 24 });
  },
);

it.each(["Widgets", "Chart fixture"])(
  "saves the second widget and the first widget's split geometry together through %s",
  async (button) => {
    const { resource, patch, createChart, user, client, key } = setup();
    const first = resource.widgets[0]!;
    await act(async () => {
      client.setQueryData(key, { ...resource, widgets: [first] });
    });
    const mutation = button === "Widgets" ? patch : createChart;
    mutation.mockReturnValue(deferred<never>().promise);
    await user.click(screen.getByRole("button", { name: button }));
    expect(mutation).toHaveBeenCalledTimes(1);
    const input = mutation.mock.calls[0]![0];
    const widgets =
      button === "Widgets" ? input.operations[0].value : input.widgets;
    expect(widgets[0]).toEqual({
      ...first,
      layout: { x: 0, y: 0, w: 6, h: 24 },
    });
    const layout = button === "Widgets" ? widgets[1].layout : input.layout;
    expect(layout).toEqual({ x: 6, y: 0, w: 6, h: 24 });
    expect(input.expectedRevision).toBe(resource.revision);
  },
);

it("retains the workspace placement request on failure and retries it without generating another ID", async () => {
  const { resource, patch, get, user } = setup();
  patch.mockRejectedValueOnce(new Error("Save unavailable"));
  await user.click(screen.getByRole("button", { name: "Widgets" }));
  await findErrorToast();
  expect(screen.getByRole("button", { name: "Widgets" })).toBeDisabled();
  const input = patch.mock.calls[0]![0];
  const saved = {
    ...resource,
    revision: 2,
    widgets: input.operations[0].value,
  };
  patch.mockResolvedValue(saved);
  get.mockResolvedValue(saved);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  expect(patch.mock.calls[1]![0]).toEqual(input);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Widgets" })).toBeEnabled(),
  );
});

it("docks a new placement beside the calling widget with one save, and repeats reuse it while it saves", async () => {
  const { resource, patch, get, user } = setup();
  const response = deferred<Dashboard>();
  patch.mockReturnValue(response.promise);
  const place = screen.getByRole("button", { name: "Place beside wdg_two" });
  await user.click(place);
  expect(patch).toHaveBeenCalledTimes(1);
  const input = patch.mock.calls[0]![0];
  const widgets = input.operations[0].value as Dashboard["widgets"];
  expect(input.expectedRevision).toBe(resource.revision);
  // The 6-wide caller keeps its row and splits with the new widget on its right; others stay.
  expect(widgets).toEqual([
    resource.widgets[0],
    { ...resource.widgets[1], layout: { x: 6, y: 0, w: 3, h: 8 } },
    resource.widgets[2],
    {
      id: expect.stringMatching(/^wdg_/),
      kind: "workspace",
      resourceId: "wsp_research",
      layout: { x: 9, y: 0, w: 3, h: 8 },
    },
  ]);
  const placed = `Placed ${widgets[3]!.id}`;
  expect(screen.getByText(placed)).toBeInTheDocument();
  // While saving, and while Query refreshes afterwards, a repeat finds the same placement.
  await user.click(place);
  expect(screen.getByText(placed)).toBeInTheDocument();
  const saved = { ...resource, widgets, revision: 2 };
  const refresh = deferred<Dashboard>();
  get.mockReturnValue(refresh.promise);
  await act(async () => response.resolve(saved));
  expect(await screen.findByText("Refreshing dashboard…")).toBeInTheDocument();
  await user.click(place);
  expect(screen.getByText(placed)).toBeInTheDocument();
  await act(async () => refresh.resolve(saved));
  await user.click(place);
  expect(screen.getByText(placed)).toBeInTheDocument();
  expect(patch).toHaveBeenCalledTimes(1);
});

it("reuses a placement already showing the Resource without saving", async () => {
  const { resource, patch, user, client, key } = setup();
  const existing = {
    id: placementId.make("wdg_workspace"),
    kind: "workspace",
    resourceId: "wsp_research",
    layout: { x: 6, y: 8, w: 6, h: 8 },
  };
  await act(async () => {
    client.setQueryData(key, {
      ...resource,
      widgets: [...resource.widgets, existing],
    });
  });
  await user.click(
    screen.getByRole("button", { name: "Place beside wdg_one" }),
  );
  expect(await screen.findByText("Placed wdg_workspace")).toBeInTheDocument();
  expect(patch).not.toHaveBeenCalled();
});

it("a failed dock keeps the Dashboard's Retry, which saves the same placement", async () => {
  const { resource, patch, get, user } = setup();
  patch
    .mockRejectedValueOnce(new Error("Save unavailable"))
    .mockImplementation(async ({ operations }) => {
      const saved = { ...resource, revision: 2, widgets: operations[0].value };
      get.mockResolvedValue(saved);
      return saved;
    });
  const place = screen.getByRole("button", { name: "Place beside wdg_one" });
  await user.click(place);
  const widgets = patch.mock.calls[0]![0].operations[0].value;
  expect(screen.getByText(`Placed ${widgets[3].id}`)).toBeInTheDocument();
  await findErrorToast("Save unavailable");
  // Another dock can't start over the unsaved one.
  await user.click(place);
  expect(
    screen.getByText("Placed Another dashboard change hasn’t been saved yet."),
  ).toBeInTheDocument();
  expect(patch).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  expect(patch.mock.calls[1]![0]).toEqual(patch.mock.calls[0]![0]);
  expect(
    await screen.findByText(`Content ${widgets[3].id}`),
  ).toBeInTheDocument();
});

it("holds generic widget controls while a fixture popup is portaled outside its card", async () => {
  const { user } = setup();
  const card = screen.getAllByRole("region", { name: "Fixture" })[0]!;
  expect(card).not.toHaveAttribute("data-controls-held");
  await user.click(
    within(card).getByRole("button", { name: "Inspect wdg_one" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Fixture details" }),
  ).toBeInTheDocument();
  expect(within(card).queryByRole("dialog")).not.toBeInTheDocument();
  expect(card).toHaveAttribute("data-controls-held", "true");
  await user.click(screen.getByRole("button", { name: "Finish inspection" }));
  await waitFor(() => expect(card).not.toHaveAttribute("data-controls-held"));
  expect(harness.mounted).toHaveBeenCalledTimes(2);
});

it("removes a widget directly with the X button and saves the remaining placements", async () => {
  const { resource, patch, user } = setup();
  patch.mockReturnValue(new Promise(() => undefined));
  const first = screen.getAllByRole("region", { name: "Fixture" })[0]!;
  await user.click(
    within(first).getByRole("button", { name: "Remove from dashboard" }),
  );
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(patch).toHaveBeenCalledWith({
    id: resource.id,
    expectedRevision: resource.revision,
    operations: [
      { op: "replace", path: "/widgets", value: resource.widgets.slice(1) },
    ],
  });
  expect(
    within(first).getByRole("button", { name: "Remove from dashboard" }),
  ).toBeDisabled();
});

it("moves from the grip with arrow keys without opening a position dialog", async () => {
  const { patch, user } = setup();
  patch.mockReturnValue(new Promise(() => undefined));
  const first = screen.getAllByRole("region", { name: "Fixture" })[0]!;
  act(() =>
    within(first).getByRole("button", { name: "Move Fixture" }).focus(),
  );
  await user.keyboard("{ArrowRight}");
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(patch.mock.calls[0]![0].operations[0].value[0].layout.x).toBe(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("moves an overflowing placement back into view without changing its height", async () => {
  const { resource, patch, client, key, user } = setup();
  patch.mockReturnValue(new Promise(() => undefined));
  act(() => {
    client.setQueryData(key, {
      ...resource,
      widgets: [
        { ...resource.widgets[0]!, layout: { x: 1, y: 30, w: 6, h: 8 } },
      ],
    });
  });
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: "Move Fixture" }),
    ).toHaveLength(1),
  );
  act(() => screen.getByRole("button", { name: "Move Fixture" }).focus());
  await user.keyboard("{ArrowLeft}");
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(patch.mock.calls[0]![0].operations[0].value[0].layout).toEqual({
    x: 0,
    y: 0,
    w: 6,
    h: 8,
  });
});

it.each([
  ["{ArrowLeft}", { x: 0, y: 0, w: 6, h: 8 }],
  ["{ArrowRight}", { x: 6, y: 0, w: 6, h: 8 }],
  ["{ArrowUp}", { x: 0, y: 0, w: 6, h: 8 }],
  ["{ArrowDown}", { x: 0, y: 16, w: 6, h: 8 }],
  ["{Shift>}{ArrowRight}{/Shift}", { x: 0, y: 0, w: 6, h: 8 }],
])(
  "keeps keyboard layout edits within grid and minimum-size bounds: %s",
  async (keys, layout) => {
    const { resource, patch, client, key, user } = setup();
    act(() => {
      client.setQueryData(key, {
        ...resource,
        widgets: [{ ...resource.widgets[0]!, layout }],
      });
    });
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Move Fixture" }),
      ).toHaveLength(1),
    );
    act(() => screen.getByRole("button", { name: "Move Fixture" }).focus());
    await user.keyboard(keys);
    expect(patch).not.toHaveBeenCalled();
  },
);

it("commits a real RGL mouse drag once from its grip and leaves canvas gestures inside the widget", async () => {
  harness.actualGrid = true;
  // jsdom has no layout engine; RGL still receives actual mouse events and owns all gesture state.
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
    function (this: HTMLElement) {
      // eslint-disable-next-line testing-library/no-node-access
      return this.parentElement;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const offset = this.style.transform.match(
        /translate\(([-.\d]+)px,\s*([-.\d]+)px\)/,
      );
      return new DOMRect(
        Number(offset?.[1] ?? 0),
        Number(offset?.[2] ?? 0),
        parseFloat(this.style.width) || 1200,
        parseFloat(this.style.height) || 800,
      );
    },
  );
  const { resource, patch, client, key } = setup();
  patch.mockReturnValue(new Promise(() => undefined));

  const canvas = screen.getByRole("img", { name: "Canvas wdg_one" });
  fireEvent.mouseDown(canvas, {
    clientX: 20,
    clientY: 40,
    button: 0,
    buttons: 1,
  });
  fireEvent.mouseMove(document, { clientX: 624, clientY: 40, buttons: 1 });
  fireEvent.mouseUp(document, { clientX: 624, clientY: 40, button: 0 });
  expect(patch).not.toHaveBeenCalled();

  const card = screen.getAllByRole("region", { name: "Fixture" })[0]!;
  const grip = within(card).getByRole("button", { name: "Move Fixture" });
  expect(grip).toHaveAttribute("data-widget-drag-handle");
  fireEvent.mouseDown(grip, {
    clientX: 20,
    clientY: 20,
    button: 0,
    buttons: 1,
  });
  fireEvent.mouseMove(document, { clientX: 30, clientY: 20, buttons: 1 });
  act(() => {
    client.setQueryData(key, {
      ...resource,
      revision: 2,
      name: "Remote rename",
    });
  });
  await screen.findByText("Remote rename");
  fireEvent.mouseMove(document, { clientX: 624, clientY: 20, buttons: 1 });
  expect(patch).not.toHaveBeenCalled();
  fireEvent.mouseUp(document, { clientX: 624, clientY: 20, button: 0 });

  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(patch.mock.calls[0]![0]).toMatchObject({
    id: resource.id,
    expectedRevision: 1,
  });
  const saved = patch.mock.calls[0]![0].operations[0]
    .value as Dashboard["widgets"];
  expect(saved.map(({ id, layout }) => ({ id, layout }))).toEqual([
    { id: "wdg_one", layout: { x: 6, y: 0, w: 6, h: 8 } },
    { id: "wdg_two", layout: { x: 6, y: 8, w: 6, h: 8 } },
    { id: "wdg_unknown", layout: { x: 0, y: 0, w: 6, h: 8 } },
  ]);
  expect(client.getQueryData(key)).toMatchObject({
    revision: 2,
    widgets: resource.widgets,
  });
  expect(harness.mounted).toHaveBeenCalledTimes(2);
});
