// Purpose: Sources read fresh per mount, definitions compile once per content, and a declarative Node re-observes everything else; stale observations cannot paint.
// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { Field, Float64, Schema } from "apache-arrow";
import type { ReactNode } from "react";
import { ProviderId } from "@openchart/market";
import * as Tea from "@openchart/tea";
import { fromPoints, fromRows } from "@openchart/timeseries";
import { Observable, Subject, type Subscriber } from "rxjs";
import { beforeEach, expect, it, vi } from "vitest";
import {
  useTea,
  useTeaDefinition,
  useTeaSource,
  type Node,
} from "@openchart/app/hooks/use-tea";
import { createQueryClient } from "@openchart/app/lib/react-query/react-query";
import type {
  AppEventFrame,
  AppTransport,
} from "@openchart/app/lib/transport/transport";
import {
  subscribeWorkspaceInvalidation,
  workspaceQueryKeys,
} from "@openchart/app/lib/workspace/workspace";
import { toast } from "sonner";
const mocks = vi.hoisted(() => ({
  url: "http://tea.test",
  compile: vi.fn(),
  snapshot: vi.fn(),
  observe: vi.fn(),
  dispose: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@openchart/app/hooks/use-tea-client", () => ({
  useTeaClient: () => mocks,
}));
const compilation: Tea.CompileResponse = {
  id: "compiled",
  declaration: {
    kind: "indicator",
    title: "Test",
    overlay: false,
    timeframe: "",
  },
  definition: {
    parameters: [],
    inputs: new Schema([]),
    outputs: new Schema([
      new Field("value", new Float64(), true, new Map([["tea:write", "set"]])),
    ]),
    requests: {},
  },
};
const series = {
  provider: ProviderId.make("test"),
  listing: { symbol: "AAA", currency: "USD" },
  resolution: "1d",
  session: "regular",
  adjustment: "raw",
} as const;
const program = (text: string) => ({
  entry: "study.tea",
  sources: { "study.tea": text },
});
let queryClient: QueryClient;
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  // The app's defaults: reads stay fresh for a minute unless the hook re-reads.
  queryClient = createQueryClient();
  mocks.compile.mockResolvedValue(compilation);
  mocks.dispose.mockResolvedValue(undefined);
});
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
function setup() {
  const node: Node = {
    source: program('emit "value" close'),
    parameters: {},
    ...Tea.barsInputs(series),
    requests: {},
    from: 0,
    to: "now",
    countBack: 10,
    warmupBars: Tea.standardWarmupBars,
  };
  const calls: {
    request: Tea.ObserveRequest;
    sink: Subscriber<Tea.Message>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  mocks.observe.mockImplementation(
    (request: Tea.ObserveRequest) =>
      new Observable((sink: Subscriber<Tea.Message>) => {
        const stop = vi.fn();
        calls.push({ request, sink, stop });
        return stop;
      }),
  );
  return { node, calls };
}
function render(node: Node) {
  return renderHook(({ node }) => useTea(node), {
    initialProps: { node },
    wrapper,
  });
}

it("observes on supplied history only when given it", async () => {
  const { node, calls } = setup();
  const samples: Tea.Samples[] = [
    {
      _tag: "Samples",
      ...series,
      resolution: "1W",
      schema: Tea.barsSchema,
      rows: [{ time: 0, open: 1, high: 2, low: 1, close: 2, volume: 10 }],
    },
  ];
  const view = renderHook(
    ({ samples }: { samples?: Tea.Samples[] }) => useTea(node, { samples }),
    {
      initialProps: { samples } as { samples?: Tea.Samples[] },
      wrapper,
    },
  );
  await waitFor(() => expect(calls).toHaveLength(1));
  // The service, not the app, keeps such a run from reading Feed.
  expect(calls[0]!.request.samples).toBe(samples);
  view.rerender({ samples: undefined });
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]!.request).not.toHaveProperty("samples");
});
/** The app's Workspace invalidation: committed writes arrive as events, disk edits through `workspace.watch`. */
function observeWorkspace() {
  const events = new Subject<AppEventFrame>();
  const watch = vi.fn<
    (input: unknown, handlers: unknown) => { unsubscribe(): void }
  >(() => ({ unsubscribe: vi.fn() }));
  const subscription = subscribeWorkspaceInvalidation(
    {
      url: mocks.url,
      events,
      rpc: { workspace: { watch: { subscribe: watch } } },
    } as unknown as AppTransport,
    queryClient,
  );
  const latest = () =>
    watch.mock.lastCall as
      | [
          { interests: { target: { path: string } }[] },
          { onData(interest: unknown): void },
        ]
      | undefined;
  return {
    subscription,
    /** Paths the latest watch subscription follows. */
    watched: () =>
      latest()?.[0].interests.map((interest) => interest.target.path),
    /** Some tool edited this file on disk. */
    edited: (path: string) =>
      act(() =>
        latest()![1].onData({
          workspaceId: "wsp_test",
          target: { kind: "file", path },
        }),
      ),
    /** The app committed a write. */
    written: () =>
      act(() =>
        events.next({
          kind: "event",
          event: { type: "workspace.changed", data: {} },
        } as AppEventFrame),
      ),
  };
}

it("compiles equal content once across renders; different content recompiles and releases the old compilation", async () => {
  const f = setup();
  const view = render(f.node);
  await waitFor(() => expect(f.calls).toHaveLength(1));
  expect(mocks.compile).toHaveBeenCalledExactlyOnceWith(f.node.source);
  expect(view.result.current.compiled?.declaration?.title).toBe("Test");
  // The request is the node's config itself, with complete parameters and no other nodes.
  expect(f.calls[0]!.request).toEqual({
    id: "compiled",
    ...Tea.barsInputs(series),
    parameters: {},
    requests: {},
    nodes: {},
    from: 0,
    to: "now",
    countBack: 10,
    warmupBars: Tea.standardWarmupBars,
  });
  expect(f.calls[0]!.request.inputs).toBe(f.node.inputs);
  // Effects run within rerender, so an equal source would have recompiled by now.
  view.rerender({ node: { ...f.node, source: program('emit "value" close') } });
  expect(mocks.compile).toHaveBeenCalledOnce();
  expect(f.calls).toHaveLength(1);
  mocks.compile.mockResolvedValue({ ...compilation, id: "edited" });
  const edited = { ...f.node, source: program('emit "value" open') };
  view.rerender({ node: edited });
  await waitFor(() => expect(f.calls).toHaveLength(2));
  expect(mocks.compile).toHaveBeenLastCalledWith(edited.source);
  expect(mocks.dispose).toHaveBeenCalledWith({ id: "compiled" });
  expect(f.calls[0]!.stop).toHaveBeenCalledOnce();
  expect(f.calls[1]!.request.id).toBe("edited");
  view.unmount();
  await waitFor(() =>
    expect(mocks.dispose).toHaveBeenCalledWith({ id: "edited" }),
  );
});

it("follows a Workspace file and its imports: changed content recompiles, an equal refetch changes nothing", async () => {
  const f = setup();
  const workspace = observeWorkspace();
  const file = { workspaceId: "wsp_test", path: "study.tea" };
  const imports = (text: string) => ({
    entry: "study.tea",
    sources: { "study.tea": 'import "./lib.tea"', "lib.tea": text },
  });
  mocks.snapshot.mockResolvedValue(imports("close"));
  const view = render({ ...f.node, source: file });
  await waitFor(() => expect(f.calls).toHaveLength(1));
  expect(mocks.snapshot).toHaveBeenCalledWith(file, expect.anything());
  expect(mocks.compile).toHaveBeenCalledExactlyOnceWith(imports("close"));
  await waitFor(() =>
    expect(workspace.watched()).toEqual(["study.tea", "lib.tea"]),
  );
  // A sibling changed on disk: the refetched snapshot is equal.
  workspace.edited("study.tea");
  await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  expect(mocks.compile).toHaveBeenCalledOnce();
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.stop).not.toHaveBeenCalled();
  mocks.compile.mockResolvedValue({ ...compilation, id: "saved" });
  mocks.snapshot.mockResolvedValue(imports("open"));
  workspace.edited("lib.tea");
  await waitFor(() => expect(f.calls).toHaveLength(2));
  expect(mocks.compile).toHaveBeenLastCalledWith(imports("open"));
  expect(mocks.dispose).toHaveBeenCalledWith({ id: "compiled" });
  expect(f.calls[1]!.request.id).toBe("saved");
  view.unmount();
  workspace.subscription.unsubscribe();
});

it("a broken save of a followed file reports it, releases the running program, and the next good save recompiles", async () => {
  const f = setup();
  const workspace = observeWorkspace();
  mocks.snapshot.mockResolvedValue(program('emit "value" close'));
  const view = render({
    ...f.node,
    source: { workspaceId: "wsp_test", path: "study.tea" },
  });
  await waitFor(() => expect(f.calls).toHaveLength(1));
  // Query keeps the last good snapshot after a failed refetch; the hook must not run it.
  mocks.snapshot.mockRejectedValue(new Error("expected expression"));
  workspace.written();
  await waitFor(() => expect(view.result.current.status).toBe("error"));
  expect(view.result.current.error?.message).toBe("expected expression");
  expect(view.result.current.compiled).toBeUndefined();
  expect(f.calls[0]!.stop).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(mocks.dispose).toHaveBeenCalledWith({ id: "compiled" }),
  );
  // Fixing the file back to the same program runs it again.
  mocks.snapshot.mockResolvedValue(program('emit "value" close'));
  workspace.written();
  await waitFor(() => expect(f.calls).toHaveLength(2));
  expect(mocks.compile).toHaveBeenCalledTimes(2);
  expect(view.result.current.error).toBeUndefined();
  view.unmount();
  workspace.subscription.unsubscribe();
});

it("reports a failed file read, and retry reads it again", async () => {
  const f = setup();
  mocks.snapshot.mockRejectedValueOnce(new Error("Tea source is unavailable"));
  const view = render({
    ...f.node,
    source: { workspaceId: "wsp_test", path: "study.tea" },
  });
  await waitFor(() => expect(view.result.current.status).toBe("error"));
  expect(view.result.current.error?.message).toBe("Tea source is unavailable");
  expect(mocks.compile).not.toHaveBeenCalled();
  mocks.snapshot.mockResolvedValue(program('emit "value" close'));
  act(() => view.result.current.retry());
  await waitFor(() => expect(f.calls).toHaveLength(1));
  expect(mocks.compile).toHaveBeenCalledOnce();
  expect(view.result.current.status).toBe("loading");
  view.unmount();
});

it("cancels on symbol switch, preserves compilation, and disposes on unmount", async () => {
  const f = setup();
  const view = render(f.node);
  await waitFor(() => expect(f.calls).toHaveLength(1));
  act(() =>
    f.calls[0]!.sink.next({
      type: "snapshot",
      config: { inputs: {}, map: {}, parameters: {}, requests: {} },
      rid: "run",
      snapshot: {
        range: { from: 0, to: 3000 },
        data: fromPoints({}, [
          { time: 1000, value: 7 },
          { time: 2000, value: 9 },
        ]),
      },
    }),
  );
  expect(Array.from(view.result.current.data ?? [])).toMatchObject([
    { time: 1000, value: 7 },
    { time: 2000, value: 9 },
  ]);
  // The run's filled-in config travels with the data it produced.
  expect(view.result.current.config).toEqual({
    inputs: {},
    map: {},
    parameters: {},
    requests: {},
  });
  view.rerender({
    node: {
      ...f.node,
      ...Tea.barsInputs({
        ...series,
        listing: { ...series.listing, symbol: "BBB" },
      }),
    },
  });
  await waitFor(() => expect(f.calls).toHaveLength(2));
  expect(f.calls[0]!.stop).toHaveBeenCalledOnce();
  expect(f.calls[0]!.sink.closed).toBe(true);
  expect(Array.from(view.result.current.data ?? [])).toEqual([]);
  expect(view.result.current.config).toBeUndefined();
  expect(mocks.compile).toHaveBeenCalledOnce();
  view.rerender({ node: f.node });
  await waitFor(() => expect(f.calls).toHaveLength(3));
  expect(view.result.current.data).toBeUndefined();
  view.unmount();
  await waitFor(() =>
    expect(mocks.dispose).toHaveBeenCalledWith({ id: "compiled" }),
  );
  expect(f.calls[1]!.stop).toHaveBeenCalledOnce();
  expect(f.calls[2]!.stop).toHaveBeenCalledOnce();
});
it("reports failed release after unmount without replaying compilation failures", async () => {
  const f = setup();
  mocks.dispose.mockRejectedValueOnce(new Error("Release unavailable"));
  const view = render(f.node);
  await waitFor(() => expect(f.calls).toHaveLength(1));
  view.unmount();
  await waitFor(() =>
    expect(toast.getToasts()).toEqual([
      expect.objectContaining({
        title: "Couldn’t release indicator resources",
        description: "Release unavailable",
      }),
    ]),
  );
  mocks.compile.mockRejectedValueOnce(new Error("Compile unavailable"));
  const utils = render(f.node);
  await waitFor(() => expect(utils.result.current.status).toBe("error"));
  utils.unmount();
  await Promise.resolve();
  expect(toast.getToasts()).toHaveLength(1);
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it("releases a compilation that completes after unmount", async () => {
  let finish!: (value: Tea.CompileResponse) => void;
  mocks.compile.mockReturnValue(
    new Promise<Tea.CompileResponse>((resolve) => {
      finish = resolve;
    }),
  );
  const f = setup();
  const view = render(f.node);
  view.unmount();
  await act(async () => {
    finish(compilation);
  });
  await waitFor(() =>
    expect(mocks.dispose).toHaveBeenCalledWith({ id: "compiled" }),
  );
  expect(mocks.observe).not.toHaveBeenCalled();
});

it("replaces whole rows and reobserves windows without recompiling", async () => {
  const f = setup();
  const view = render(f.node);
  await waitFor(() => expect(f.calls).toHaveLength(1));
  act(() => {
    f.calls[0]!.sink.next({
      type: "snapshot",
      config: { inputs: {}, map: {}, parameters: {}, requests: {} },
      rid: "run",
      snapshot: {
        range: { from: 0, to: 2000 },
        data: fromPoints({}, [{ time: 1000, value: 1 }]),
      },
    });
    f.calls[0]!.sink.next({
      type: "updates",
      data: fromRows(fromPoints({}, [{ time: 1000, value: 1 }]).schema, [
        { time: 1000, value: null },
      ]),
    });
  });
  expect(view.result.current.data?.get(0)?.value).toBeNull();
  view.rerender({ node: { ...f.node, from: -1000 } });
  await waitFor(() => expect(f.calls).toHaveLength(2));
  expect(mocks.compile).toHaveBeenCalledOnce();
  act(() => f.calls[1]!.sink.error(new Error("Unavailable")));
  expect(view.result.current.status).toBe("error");
  expect(view.result.current.data?.get(0)?.value).toBeNull();
  expect(f.calls[1]!.stop).toHaveBeenCalledOnce();
  view.unmount();
});

it("retains data across superseded windows and warmups, replaces snapshots, and accepts an empty result", async () => {
  const f = setup();
  const view = render(f.node);
  await waitFor(() => expect(f.calls).toHaveLength(1));
  const old = fromPoints({}, [{ time: 1000, value: 7 }]);
  const snapshot = (data: typeof old) => ({
    type: "snapshot" as const,
    config: { inputs: {}, map: {}, parameters: {}, requests: {} },
    rid: "run",
    snapshot: { range: { from: -3000, to: 3000 }, data },
  });
  act(() => f.calls[0]!.sink.next(snapshot(old)));
  view.rerender({ node: { ...f.node, warmupBars: 0 } });
  await waitFor(() => expect(f.calls).toHaveLength(2));
  expect(f.calls[1]!.request.warmupBars).toBe(0);
  expect(view.result.current.status).toBe("loading");
  expect(view.result.current.data).toBe(old);
  view.rerender({ node: { ...f.node, from: -2000, countBack: 30 } });
  await waitFor(() => expect(f.calls).toHaveLength(3));
  expect(f.calls[0]!.stop).toHaveBeenCalledOnce();
  expect(f.calls[1]!.stop).toHaveBeenCalledOnce();
  act(() =>
    f.calls[1]!.sink.next(
      snapshot(fromPoints({}, [{ time: 1000, value: 999 }])),
    ),
  );
  expect(view.result.current.data).toBe(old);
  const replacement = fromPoints({}, [{ time: -1000, value: 12 }]);
  act(() => f.calls[2]!.sink.next(snapshot(replacement)));
  expect([...view.result.current.data!]).toEqual([{ time: -1000, value: 12 }]);
  view.rerender({ node: { ...f.node, from: -3000 } });
  await waitFor(() => expect(f.calls).toHaveLength(4));
  act(() => f.calls[3]!.sink.error(new Error("Refresh failed")));
  expect(view.result.current.status).toBe("error");
  expect(view.result.current.data).toBe(replacement);
  view.rerender({ node: { ...f.node, from: -2000 } });
  await waitFor(() => expect(f.calls).toHaveLength(5));
  act(() => f.calls[4]!.sink.next(snapshot(fromRows(old.schema, []))));
  expect(view.result.current.status).toBe("ready");
  expect(view.result.current.data?.numRows).toBe(0);
  expect(mocks.compile).toHaveBeenCalledOnce();
  view.unmount();
});

it("re-observes parameter, resolution and map changes without recompiling and clears their data, including returning to the old configuration", async () => {
  mocks.compile.mockResolvedValue({
    ...compilation,
    definition: {
      ...compilation.definition,
      parameters: [{ name: "length", type: "int", defaultValue: 20 }],
    },
  });
  const f = setup();
  const view = render(f.node);
  await waitFor(() => expect(f.calls).toHaveLength(1));
  expect(f.calls[0]!.request.parameters).toEqual({ length: 20 });
  act(() =>
    f.calls[0]!.sink.next({
      type: "snapshot",
      config: { inputs: {}, map: {}, parameters: {}, requests: {} },
      rid: "run",
      snapshot: {
        range: { from: 0, to: 2000 },
        data: fromPoints({}, [{ time: 1000, value: 7 }]),
      },
    }),
  );
  view.rerender({ node: { ...f.node, parameters: { length: 30 } } });
  await waitFor(() => expect(f.calls).toHaveLength(2));
  expect(f.calls[1]!.request.parameters).toEqual({ length: 30 });
  expect(view.result.current.data).toBeUndefined();
  view.rerender({ node: f.node });
  await waitFor(() => expect(f.calls).toHaveLength(3));
  expect(view.result.current.data).toBeUndefined();
  const ready = (call: number) =>
    act(() =>
      f.calls[call]!.sink.next({
        type: "snapshot",
        config: { inputs: {}, map: {}, parameters: {}, requests: {} },
        rid: "run",
        snapshot: {
          range: { from: 0, to: 2000 },
          data: fromPoints({}, [{ time: 1000, value: 8 }]),
        },
      }),
    );
  ready(2);
  view.rerender({
    node: { ...f.node, ...Tea.barsInputs({ ...series, resolution: "1m" }) },
  });
  await waitFor(() => expect(f.calls).toHaveLength(4));
  expect(view.result.current.data).toBeUndefined();
  ready(3);
  // An equal config built again keeps the observation.
  view.rerender({
    node: { ...f.node, ...Tea.barsInputs({ ...series, resolution: "1m" }) },
  });
  expect(f.calls).toHaveLength(4);
  expect(view.result.current.data).toBeDefined();
  const map = { close: ["bars", ["close"]] } as const;
  view.rerender({
    node: {
      ...f.node,
      ...Tea.barsInputs({ ...series, resolution: "1m" }),
      map,
    },
  });
  await waitFor(() => expect(f.calls).toHaveLength(5));
  expect(f.calls[4]!.request.map).toBe(map);
  expect(view.result.current.data).toBeUndefined();
  expect(mocks.compile).toHaveBeenCalledOnce();
  view.unmount();
});

it("does not reuse a disposed compilation when the hook returns to previous content", async () => {
  const f = setup();
  const view = render(f.node);
  await waitFor(() => expect(f.calls).toHaveLength(1));
  const pending: ((value: Tea.CompileResponse) => void)[] = [];
  mocks.compile.mockImplementation(
    () => new Promise<Tea.CompileResponse>((resolve) => pending.push(resolve)),
  );
  view.rerender({
    node: { ...f.node, source: program('emit "value" open') },
  });
  await waitFor(() => expect(pending).toHaveLength(1));
  view.rerender({ node: f.node });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(view.result.current.compiled).toBeUndefined();
  expect(view.result.current.data).toBeUndefined();
  expect(mocks.observe).toHaveBeenCalledOnce();
  await act(async () => {
    pending[0]!({ ...compilation, id: "retired" });
    pending[1]!({ ...compilation, id: "fresh" });
  });
  await waitFor(() => expect(f.calls).toHaveLength(2));
  expect(f.calls[1]!.request.id).toBe("fresh");
  expect(mocks.dispose).toHaveBeenCalledWith({ id: "retired" });
  expect(mocks.dispose).toHaveBeenCalledWith({ id: "compiled" });
  view.unmount();
});

it("retry recompiles the same content after a failure and releases the replaced compilation", async () => {
  mocks.compile.mockRejectedValueOnce(new Error("Compile failed"));
  const f = setup();
  const view = render(f.node);
  await waitFor(() => expect(view.result.current.status).toBe("error"));
  expect(view.result.current.error?.message).toBe("Compile failed");
  expect(mocks.observe).not.toHaveBeenCalled();
  act(() => view.result.current.retry());
  await waitFor(() => expect(f.calls).toHaveLength(1));
  expect(mocks.compile).toHaveBeenCalledTimes(2);
  expect(mocks.compile).toHaveBeenLastCalledWith(f.node.source);
  expect(f.calls[0]!.request.id).toBe("compiled");
  mocks.compile.mockResolvedValue({ ...compilation, id: "retried" });
  act(() => view.result.current.retry());
  await waitFor(() => expect(f.calls).toHaveLength(2));
  expect(mocks.compile).toHaveBeenCalledTimes(3);
  expect(mocks.dispose).toHaveBeenCalledWith({ id: "compiled" });
  expect(f.calls[1]!.request.id).toBe("retried");
  view.unmount();
});

const file = { workspaceId: "wsp_test", path: "study.tea" };

it("passes complete content through without reading anything", () => {
  const source = program('emit "value" close');
  const view = renderHook(() => useTeaSource(source), { wrapper });
  expect(view.result.current).toMatchObject({
    program: source,
    pending: false,
  });
  expect(view.result.current.error).toBeUndefined();
  expect(mocks.snapshot).not.toHaveBeenCalled();
  view.unmount();
});

it("reads a Workspace path, follows its Workspace's writes and changes, and keeps an equal re-read", async () => {
  mocks.snapshot.mockResolvedValue(program('emit "value" close'));
  const view = renderHook(() => useTeaSource(file), { wrapper });
  expect(view.result.current).toMatchObject({ pending: true });
  expect(view.result.current.program).toBeUndefined();
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  const first = view.result.current.program;
  expect(first).toEqual(program('emit "value" close'));
  expect(mocks.snapshot).toHaveBeenCalledWith(file, expect.anything());
  // The app's own write refreshes its Workspace's keys, which include this read.
  const write = () =>
    act(() =>
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.workspace(mocks.url, file.workspaceId),
      }),
    );
  await write();
  expect(mocks.snapshot).toHaveBeenCalledTimes(2);
  expect(view.result.current.program).toBe(first);
  mocks.snapshot.mockResolvedValue(program('emit "value" open'));
  await write();
  await waitFor(() =>
    expect(view.result.current.program).toEqual(program('emit "value" open')),
  );
  expect(view.result.current.pending).toBe(false);
  view.unmount();
});

it("re-reads on mount instead of handing a new consumer the cached content", async () => {
  mocks.snapshot.mockResolvedValue(program('emit "value" close'));
  const { result: cached, unmount: unmountCached } = renderHook(
    () => useTeaSource(file),
    { wrapper },
  );
  await waitFor(() => expect(cached.current.program).toBeDefined());
  // The file was saved; nothing has invalidated the cached read yet.
  let finish!: () => void;
  mocks.snapshot.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(program('emit "value" open'));
      }),
  );
  const { result: fresh, unmount: unmountFresh } = renderHook(
    () => useTeaSource(file),
    { wrapper },
  );
  expect(fresh.current).toMatchObject({ pending: true });
  expect(fresh.current.program).toBeUndefined();
  await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(2));
  await act(async () => finish());
  await waitFor(() =>
    expect(fresh.current).toMatchObject({
      pending: false,
      program: program('emit "value" open'),
    }),
  );
  expect(cached.current.program).toEqual(program('emit "value" open'));
  unmountCached();
  unmountFresh();
});

it("reports a failed read without content, and retry reads again", async () => {
  mocks.snapshot.mockRejectedValueOnce(new Error("Tea source is unavailable"));
  const view = renderHook(() => useTeaSource(file), { wrapper });
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current.error?.message).toBe("Tea source is unavailable");
  expect(view.result.current.program).toBeUndefined();
  mocks.snapshot.mockResolvedValue(program('emit "value" close'));
  act(() => view.result.current.retry());
  await waitFor(() => expect(view.result.current.program).toBeDefined());
  expect(view.result.current.error).toBeUndefined();
  view.unmount();
});

it("describes a program once per content and releases it when the content changes or on unmount", async () => {
  const view = renderHook(({ source }) => useTeaDefinition(source), {
    initialProps: {
      source: program('emit "value" close') as Tea.CompileRequest,
    },
    wrapper,
  });
  expect(view.result.current).toMatchObject({ pending: true });
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(view.result.current.compiled?.declaration?.title).toBe("Test");
  view.rerender({ source: program('emit "value" close') });
  expect(mocks.compile).toHaveBeenCalledOnce();
  mocks.compile.mockResolvedValue({ ...compilation, id: "edited" });
  view.rerender({ source: program('emit "value" open') });
  expect(view.result.current).toMatchObject({ pending: true });
  expect(view.result.current.compiled).toBeUndefined();
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(mocks.compile).toHaveBeenLastCalledWith(program('emit "value" open'));
  expect(mocks.dispose).toHaveBeenCalledExactlyOnceWith({ id: "compiled" });
  view.unmount();
  await waitFor(() =>
    expect(mocks.dispose).toHaveBeenCalledWith({ id: "edited" }),
  );
  expect(mocks.observe).not.toHaveBeenCalled();
});

it("describes a Workspace file from its read content, and reports read and compile failures", async () => {
  mocks.snapshot.mockResolvedValue(program('emit "value" close'));
  const view = renderHook(() => useTeaDefinition(file), { wrapper });
  await waitFor(() => expect(view.result.current.pending).toBe(false));
  expect(mocks.compile).toHaveBeenCalledExactlyOnceWith(
    program('emit "value" close'),
  );
  expect(view.result.current.compiled).toBeDefined();
  mocks.compile.mockRejectedValueOnce(new Error("expected expression"));
  mocks.snapshot.mockResolvedValue(program("broken"));
  await act(() =>
    queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.all }),
  );
  await waitFor(() =>
    expect(view.result.current.error?.message).toBe("expected expression"),
  );
  expect(view.result.current).toMatchObject({ pending: false });
  expect(view.result.current.compiled).toBeUndefined();
  mocks.snapshot.mockRejectedValue(new Error("Tea source is unavailable"));
  await act(() =>
    queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.all }),
  );
  await waitFor(() =>
    expect(view.result.current.error?.message).toBe(
      "Tea source is unavailable",
    ),
  );
  expect(view.result.current.compiled).toBeUndefined();
  view.unmount();
});
