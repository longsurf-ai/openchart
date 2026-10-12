// Purpose: Prove per-owner Tea execution sharing, bounded startup, latest-row retention and cleanup.
import { ProviderId } from "@openchart/market";
import * as Tea from "@openchart/tea";
import { fromPoints, fromRows, type DataFrame } from "@openchart/timeseries";
import { Schema } from "apache-arrow";
import { Observable, type Subscriber } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";
import {
  createTeaGroup,
  teaGroupRequestKey,
  type TeaGroupRequest,
} from "../group";

const parameter: Tea.Parameter = {
  name: "length",
  title: null,
  type: "int",
  control: "int",
  defaultValue: 14,
  active: null,
  constraints: null,
  enumType: null,
  group: null,
  inline: null,
  tooltip: null,
  confirm: false,
  display: "all",
  seriesSid: null,
};
const compiled: Tea.CompileResponse = {
  id: "compiled",
  declaration: {
    kind: "indicator",
    title: "Test",
    overlay: false,
    timeframe: "",
  },
  definition: {
    parameters: [parameter],
    inputs: new Schema([]),
    outputs: new Schema([]),
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
const node: TeaGroupRequest["node"] = {
  source: {
    entry: "main.tea",
    sources: { "main.tea": "close", "lib.tea": "open" },
  },
  parameters: {},
  ...Tea.barsInputs(series),
  requests: {},
  from: 0,
  to: "now",
  countBack: 1,
  warmupBars: Tea.standardWarmupBars,
};
const request = (
  key: string,
  change: Partial<TeaGroupRequest["node"]> = {},
): TeaGroupRequest => ({
  key,
  node: { ...node, ...change },
});
const snapshot = (data: DataFrame): Tea.Message => ({
  type: "snapshot",
  rid: "run",
  config: {
    ...Tea.barsInputs(series),
    parameters: { length: 14 },
    requests: {},
  },
  snapshot: { range: { from: 0, to: 10000 }, data },
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});
function setup() {
  const calls: {
    request: Tea.ObserveRequest;
    sink: Subscriber<Tea.Message>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const client = {
    compile: vi
      .fn<(source: Tea.CompileRequest) => Promise<Tea.CompileResponse>>()
      .mockResolvedValue(compiled),
    dispose: vi.fn().mockResolvedValue(undefined),
    observe: vi.fn(
      (request: Tea.ObserveRequest) =>
        new Observable<Tea.Message>((sink) => {
          const stop = vi.fn();
          calls.push({ request, sink, stop });
          return stop;
        }),
    ),
  };
  const releaseError = vi.fn();
  const group = createTeaGroup(client, releaseError);
  cleanup.push(() => group.close());
  return { client, calls, group, releaseError };
}

it("shares canonical content, effective defaults and results across independent consumer IDs", async () => {
  const f = setup();
  const a = request("row:histogram");
  const b = request("row:signal", {
    source: {
      entry: "main.tea",
      sources: { "lib.tea": "open", "main.tea": "close" },
    },
    parameters: { length: 14 },
    map: Object.fromEntries(Object.entries(node.map).reverse()),
  });
  f.group.reconcile([a, b]);
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  expect(f.client.compile).toHaveBeenCalledOnce();
  expect(f.calls[0]!.request.parameters).toEqual({ length: 14 });
  f.calls[0]!.sink.next(
    snapshot(fromPoints({}, [{ time: 1, histogram: 3, signal: 5 }])),
  );
  const states = f.group.getSnapshot();
  expect(states.get(a.key)).toBe(states.get(b.key));
  expect(states.get(a.key)?.data?.get(0)).toEqual({
    time: 1,
    histogram: 3,
    signal: 5,
  });
  f.group.reconcile([b]);
  expect(f.calls[0]!.stop).not.toHaveBeenCalled();
  expect(f.client.dispose).not.toHaveBeenCalled();
  f.group.reconcile([]);
  expect(f.calls[0]!.stop).toHaveBeenCalledOnce();
  expect(f.client.dispose).toHaveBeenCalledExactlyOnceWith({ id: compiled.id });
});

it.each([
  [
    "symbol",
    {
      ...Tea.barsInputs({
        ...series,
        listing: { ...series.listing, symbol: "BBB" },
      }),
    },
  ],
  [
    "provider",
    { ...Tea.barsInputs({ ...series, provider: ProviderId.make("other") }) },
  ],
  ["resolution", { ...Tea.barsInputs({ ...series, resolution: "1h" }) }],
  ["session", { ...Tea.barsInputs({ ...series, session: "extended" }) }],
  ["adjustment", { ...Tea.barsInputs({ ...series, adjustment: "split" }) }],
  ["parameters", { parameters: { length: 28 } }],
  ["from", { from: 1 }],
  ["to", { to: 10000 }],
  ["countBack", { countBack: 2 }],
  ["warmup", { warmupBars: 1 }],
  ["map", { map: { ...node.map, close: ["bars", ["open"]] } }],
] satisfies [string, Partial<TeaGroupRequest["node"]>][])(
  "separates observations with a different %s while sharing compilation",
  async (_name, change) => {
    const f = setup();
    f.group.reconcile([request("a"), request("b", change)]);
    await vi.waitFor(() => expect(f.calls).toHaveLength(2));
    expect(f.client.compile).toHaveBeenCalledOnce();
  },
);

it("separates entry points and imported code, and compares records independently of key order", async () => {
  const f = setup();
  const reversed = request("a", {
    source: {
      entry: "main.tea",
      sources: { "lib.tea": "open", "main.tea": "close" },
    },
  });
  expect(teaGroupRequestKey([request("a")])).toBe(
    teaGroupRequestKey([reversed]),
  );
  f.group.reconcile([
    request("a"),
    request("b", { source: { ...node.source, entry: "lib.tea" } }),
    request("c", {
      source: {
        ...node.source,
        sources: { ...node.source.sources, "lib.tea": "high" },
      },
    }),
  ]);
  await vi.waitFor(() => expect(f.calls).toHaveLength(3));
  expect(f.client.compile).toHaveBeenCalledTimes(3);
});

it("resolves child defaults and includes every explicit child binding in run identity", async () => {
  const f = setup();
  f.client.compile.mockResolvedValue({
    ...compiled,
    definition: {
      ...compiled.definition,
      requests: {
        daily: {
          ...compiled.definition,
          target: { symbol: "test:AAA", timeframe: "D" },
        },
      },
    },
  });
  const child: Tea.NodeConfig = {
    ...Tea.barsInputs(series),
    parameters: {},
    requests: {},
  };
  f.group.reconcile([
    request("a", { requests: { daily: child } }),
    request("b", {
      parameters: { length: 14 },
      requests: { daily: { ...child, parameters: { length: 14 } } },
    }),
    request("c", {
      requests: {
        daily: { ...child, ...Tea.barsInputs({ ...series, resolution: "1h" }) },
      },
    }),
  ]);
  await vi.waitFor(() => expect(f.calls).toHaveLength(2));
  expect(f.group.getSnapshot().get("a")).toBe(f.group.getSnapshot().get("b"));
  expect(f.calls[0]!.request.requests.daily?.parameters).toEqual({
    length: 14,
  });
});

it("keeps only the newest whole row, including provisional null and nonfinite replacements", async () => {
  const f = setup();
  f.group.reconcile([request("a")]);
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  const data = fromPoints({}, [
    { time: 1, value: 11, other: 1, provisional: false },
    { time: 2, value: 22, other: 2, provisional: true },
  ]);
  const sink = f.calls[0]!.sink;
  sink.next(snapshot(data));
  expect(f.group.getSnapshot().get("a")?.data?.numRows).toBe(1);
  expect(f.group.getSnapshot().get("a")?.time).toBe(2);
  sink.next({
    type: "updates",
    data: fromRows(data.schema, [
      { time: 2, value: null, other: NaN, provisional: false },
    ]),
  });
  expect(f.group.getSnapshot().get("a")?.data?.get(0)).toEqual({
    time: 2,
    value: null,
    other: NaN,
    provisional: false,
  });
  sink.next({
    type: "updates",
    data: fromRows(data.schema, [
      { time: 1, value: 999, other: 99, provisional: false },
    ]),
  });
  expect(f.group.getSnapshot().get("a")?.time).toBe(2);
  sink.next({
    type: "updates",
    data: fromRows(data.schema, [
      { time: 3, value: Infinity, other: null, provisional: true },
    ]),
  });
  expect(f.group.getSnapshot().get("a")?.data?.get(0)).toEqual({
    time: 3,
    value: Infinity,
    other: null,
    provisional: true,
  });
  expect(f.group.getSnapshot().get("a")?.data?.numRows).toBe(1);
});

it("limits startup to four and admits more history after snapshots without stopping live channels", async () => {
  const f = setup();
  const requests = Array.from({ length: 8 }, (_, index) =>
    request(String(index), {
      ...Tea.barsInputs({
        ...series,
        listing: { ...series.listing, symbol: String(index) },
      }),
    }),
  );
  f.group.reconcile(requests);
  await vi.waitFor(() => expect(f.calls).toHaveLength(4));
  f.calls[0]!.sink.next(
    snapshot(fromRows(fromPoints({}, [{ time: 1, value: 1 }]).schema, [])),
  );
  expect(f.group.getSnapshot().get("0")?.status).toBe("empty");
  expect(f.calls).toHaveLength(5);
  expect(f.calls[0]!.stop).not.toHaveBeenCalled();
  f.calls[1]!.sink.next(snapshot(fromPoints({}, [{ time: 1, value: 1 }])));
  expect(f.calls).toHaveLength(6);
  f.group.reconcile([requests[0]!]);
  expect(f.calls).toHaveLength(6);
  expect(
    f.calls.slice(1).every((call) => call.stop.mock.calls.length === 1),
  ).toBe(true);
  expect(f.calls[0]!.stop).not.toHaveBeenCalled();
});

it("bounds compilation startup, skips removed queued programs and disposes every late ID", async () => {
  const f = setup();
  const finish: ((result: Tea.CompileResponse) => void)[] = [];
  f.client.compile.mockImplementation(
    () => new Promise((resolve) => finish.push(resolve)),
  );
  f.group.reconcile(
    Array.from({ length: 7 }, (_, index) =>
      request(String(index), {
        source: {
          entry: "main.tea",
          sources: { "main.tea": `close * ${index}` },
        },
      }),
    ),
  );
  await vi.waitFor(() => expect(f.client.compile).toHaveBeenCalledTimes(4));
  f.group.close();
  for (const [index, resolve] of finish.entries())
    resolve({ ...compiled, id: `compiled-${index}` });
  await vi.waitFor(() => expect(f.client.dispose).toHaveBeenCalledTimes(4));
  expect(f.client.compile).toHaveBeenCalledTimes(4);
  expect(f.calls).toHaveLength(0);
});

it("releases startup slots for synchronous snapshots without closing live observations", async () => {
  const f = setup();
  const stops = Array.from({ length: 12 }, () => vi.fn());
  let started = 0;
  f.client.observe.mockImplementation(
    () =>
      new Observable((sink) => {
        const stop = stops[started++]!;
        sink.next(snapshot(fromPoints({}, [{ time: 1, value: 2 }])));
        return stop;
      }),
  );
  f.group.reconcile(
    stops.map((_, index) =>
      request(String(index), {
        ...Tea.barsInputs({
          ...series,
          listing: { ...series.listing, symbol: String(index) },
        }),
      }),
    ),
  );
  await vi.waitFor(() => expect(started).toBe(12));
  expect(
    [...f.group.getSnapshot().values()].every(
      (state) => state.status === "ready",
    ),
  ).toBe(true);
  expect(stops.every((stop) => stop.mock.calls.length === 0)).toBe(true);
  f.group.close();
  expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
});

it.each(["remove", "close"])(
  "releases a queued live run when its synchronous first snapshot triggers %s",
  async (action) => {
    const f = setup();
    const sinks: Subscriber<Tea.Message>[] = [];
    const stops = Array.from({ length: 5 }, () => vi.fn());
    f.client.observe.mockImplementation(
      () =>
        new Observable((sink) => {
          const stop = stops[sinks.length]!;
          sinks.push(sink);
          if (sinks.length === 5)
            sink.next(snapshot(fromPoints({}, [{ time: 1, value: 2 }])));
          return stop;
        }),
    );
    f.group.reconcile(
      stops.map((_, index) =>
        request(String(index), {
          ...Tea.barsInputs({
            ...series,
            listing: { ...series.listing, symbol: String(index) },
          }),
        }),
      ),
    );
    await vi.waitFor(() => expect(sinks).toHaveLength(4));
    const observer = f.group.states.subscribe((states) => {
      if (states.get("4")?.status === "ready") {
        if (action === "close") f.group.close();
        else f.group.reconcile([]);
      }
    });
    sinks[0]!.next(snapshot(fromPoints({}, [{ time: 1, value: 2 }])));
    expect(sinks).toHaveLength(5);
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    expect(f.group.getSnapshot().size).toBe(0);
    observer.unsubscribe();
  },
);

it("retries shared failures, clears failed live values and ignores a retired run", async () => {
  const f = setup();
  f.client.compile.mockRejectedValueOnce(new Error("bad compile"));
  const requests = [request("a"), request("b")];
  f.group.reconcile(requests);
  await vi.waitFor(() =>
    expect(f.group.getSnapshot().get("a")?.error?.message).toBe("bad compile"),
  );
  f.group.retry("b");
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  f.calls[0]!.sink.next(snapshot(fromPoints({}, [{ time: 1, value: 2 }])));
  f.calls[0]!.sink.error(new Error("feed unavailable"));
  expect(f.group.getSnapshot().get("a")?.status).toBe("error");
  expect(f.group.getSnapshot().get("a")?.data).toBeUndefined();
  f.group.retry("a");
  expect(f.calls).toHaveLength(2);
  expect(f.client.compile).toHaveBeenCalledTimes(2);
  f.calls[0]!.sink.next(snapshot(fromPoints({}, [{ time: 1, value: 999 }])));
  expect(f.group.getSnapshot().get("a")?.status).toBe("loading");
  f.calls[1]!.sink.next(snapshot(fromPoints({}, [{ time: 1, value: 3 }])));
  expect(f.group.getSnapshot().get("a")?.data?.get(0)?.value).toBe(3);
  expect(f.group.getSnapshot().get("a")).toBe(f.group.getSnapshot().get("b"));
});

it("contains invalid parameters to their consumer and reports disposal failure to its owner", async () => {
  const f = setup();
  f.group.reconcile([
    request("a"),
    request("bad", { parameters: { missing: 1 } }),
  ]);
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  expect(f.group.getSnapshot().get("bad")?.error?.message).toContain(
    "no longer exists",
  );
  f.client.dispose.mockRejectedValueOnce(new Error("release failed"));
  f.group.close();
  await vi.waitFor(() =>
    expect(f.releaseError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "release failed" }),
    ),
  );
});

it("does not share programs or observations between independent mounted groups", async () => {
  const f = setup();
  const other = createTeaGroup(f.client, f.releaseError);
  cleanup.push(() => other.close());
  f.group.reconcile([request("same")]);
  other.reconcile([request("same")]);
  await vi.waitFor(() => expect(f.calls).toHaveLength(2));
  expect(f.client.compile).toHaveBeenCalledTimes(2);
  f.group.close();
  expect(f.calls[0]!.stop).toHaveBeenCalledOnce();
  expect(f.calls[1]!.stop).not.toHaveBeenCalled();
});
