// Purpose: Verify all-row market bindings and honest latest-value projection into widget-local Formula cells.
import { act, render } from "@testing-library/react";
import {
  Field,
  Float64,
  Int64,
  Schema,
  Struct,
  TimestampMillisecond,
  Uint64,
} from "apache-arrow";
import { BehaviorSubject } from "rxjs";
import { fromRows } from "@openchart/timeseries";
import type {
  TeaGroupRequest,
  TeaLatestState,
} from "@openchart/app/hooks/use-tea";
import type { Watchlist } from "../api/queries";
import type { FormulaValues } from "../components/context";
import { FormulaRuntime } from "../hooks/formula-runtime";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), group: vi.fn() }));
vi.mock("@openchart/app/hooks/use-bars", () => ({
  useBarsCapabilitiesMany: mocks.capabilities,
}));
vi.mock("@openchart/app/hooks/use-tea", () => ({ useTeaGroup: mocks.group }));
const outputs = new Schema([
  new Field("time", new TimestampMillisecond(), false),
  new Field("value", new Float64(), true, new Map([["tea:write", "set"]])),
  new Field(
    "plot",
    new Struct([new Field("series", new Float64(), true)]),
    true,
    new Map([
      ["tea:write", "set"],
      ["tea:typeId", "visual.Plot"],
    ]),
  ),
]);
const compiled: NonNullable<TeaLatestState["compiled"]> = {
  declaration: null,
  definition: { parameters: [], inputs: new Schema([]), outputs, requests: {} },
};
function list(): Watchlist {
  const metric = {
    kind: "formula",
    source: { workspaceId: "wsp_test", path: "main.tea" },
    snapshot: { "main.tea": 'emit "value" close' },
    parameterOverrides: {},
    output: "value",
    bars: { resolution: "1d" },
  };
  return {
    id: "wtl_test",
    revision: 1,
    name: "Test",
    createdAt: 0,
    updatedAt: 0,
    columns: [
      { id: "wcl_value", visible: true, metric },
      { id: "wcl_plot", visible: true, metric: { ...metric, output: "plot" } },
      { id: "wcl_hidden", visible: false, metric },
      { id: "wcl_price", visible: true, metric: { kind: "price" } },
      {
        id: "wcl_research",
        visible: true,
        metric: {
          kind: "semantic",
          prompt: { parts: [{ type: "text", text: "Describe the business." }] },
        },
      },
    ],
    sections: [
      {
        id: "wsc_parent",
        items: [
          {
            id: "wit_a",
            provider: "test",
            listing: { symbol: "AAA", currency: "USD" },
          },
        ],
        sections: [
          {
            id: "wsc_nested",
            items: [
              {
                id: "wit_b",
                provider: "test",
                listing: { symbol: "BBB", currency: "USD" },
              },
            ],
            sections: [],
          },
        ],
      },
    ],
  } as unknown as Watchlist;
}
const daily = { resolution: "1d", session: "regular", adjustment: "raw" };
function ready(value: number | null, plot: number | null): TeaLatestState {
  return {
    status: "ready",
    compiled,
    time: 10,
    data: fromRows(outputs, [{ time: 10, value, plot: { series: plot } }]),
  };
}
function setup() {
  const retry = vi.fn();
  const refetch = vi.fn().mockResolvedValue(undefined);
  mocks.capabilities.mockReturnValue([
    { data: [daily], refetch },
    { data: [daily], refetch },
  ]);
  const states = new Map<string, TeaLatestState>();
  const changes = new BehaviorSubject<ReadonlyMap<string, TeaLatestState>>(
    states,
  );
  mocks.group.mockReturnValue({ states: changes, retry });
  const values = new BehaviorSubject<FormulaValues>({});
  return { states, changes, values, retry, refetch };
}
beforeEach(() => vi.clearAllMocks());

it("binds all nested rows and only visible Formula columns, sharing nodes independent of output", () => {
  const f = setup();
  const watchlist = list();
  const view = render(
    <FormulaRuntime watchlist={watchlist} values={f.values} />,
  );
  const requests = mocks.group.mock.lastCall![0] as TeaGroupRequest[];
  expect(requests.map(({ key }) => key)).toEqual([
    "wit_a:wcl_value",
    "wit_a:wcl_plot",
    "wit_b:wcl_value",
    "wit_b:wcl_plot",
  ]);
  expect(requests[0]!.node).toEqual(requests[1]!.node);
  expect(requests[0]!.node.inputs.bars).toMatchObject({
    provider: "test",
    listing: { symbol: "AAA" },
    ...daily,
  });
  expect(requests[2]!.node.inputs.bars).toMatchObject({
    provider: "test",
    listing: { symbol: "BBB" },
  });
  expect(requests[0]!.node.countBack).toBe(1);
  expect(requests[0]!.node.warmupBars).toBeGreaterThan(1);
  const { from } = requests[0]!.node;
  view.rerender(
    <FormulaRuntime
      watchlist={{
        ...watchlist,
        columns: watchlist.columns.map<Watchlist["columns"][number]>(
          (column) =>
            column.id === "wcl_value" ? { ...column, visible: false } : column,
        ),
      }}
      values={f.values}
    />,
  );
  const remaining = mocks.group.mock.lastCall![0] as TeaGroupRequest[];
  expect(remaining.map(({ key }) => key)).toEqual([
    "wit_a:wcl_plot",
    "wit_b:wcl_plot",
  ]);
  expect(remaining[0]!.node.from).toBe(from);
  expect(f.values.value.wit_a).not.toHaveProperty("wcl_value");
  view.unmount();
  expect(f.values.value).toEqual({});
});

it("projects numeric and Plot values, preserves unavailable values and retains unchanged row references", () => {
  const f = setup();
  f.states.set("wit_a:wcl_value", ready(0, 7));
  f.states.set("wit_a:wcl_plot", ready(0, 7));
  f.states.set("wit_b:wcl_value", ready(null, NaN));
  f.states.set("wit_b:wcl_plot", ready(null, NaN));
  const watchlist = list();
  const view = render(
    <FormulaRuntime watchlist={watchlist} values={f.values} />,
  );
  expect(f.values.value.wit_a?.wcl_value).toEqual({
    status: "ready",
    value: 0,
    time: 10,
  });
  expect(f.values.value.wit_a?.wcl_plot).toEqual({
    status: "ready",
    value: 7,
    time: 10,
  });
  expect(f.values.value.wit_b?.wcl_value).toEqual({
    status: "empty",
    time: 10,
  });
  expect(f.values.value.wit_b?.wcl_plot).toEqual({ status: "empty", time: 10 });
  const before = f.values.value.wit_b;
  const requestBuilds = mocks.group.mock.calls.length;
  f.states.set("wit_a:wcl_value", ready(Infinity, 9));
  act(() => f.changes.next(new Map(f.states)));
  expect(f.values.value.wit_a?.wcl_value).toEqual({
    status: "empty",
    time: 10,
  });
  expect(f.values.value.wit_b).toBe(before);
  expect(mocks.group).toHaveBeenCalledTimes(requestBuilds);
  view.unmount();
});

it("uses the first exact capability match and rejects unsupported explicit settings without changing interval/provider", () => {
  const f = setup();
  mocks.capabilities.mockReturnValue([
    {
      data: [
        { ...daily, resolution: "1h" },
        { ...daily, session: "extended" },
        daily,
      ],
      refetch: f.refetch,
    },
    { data: [{ ...daily, resolution: "1h" }], refetch: f.refetch },
  ]);
  const original = list();
  const watchlist = {
    ...original,
    columns: original.columns.map<Watchlist["columns"][number]>((column) =>
      column.id === "wcl_value" && column.metric.kind === "formula"
        ? {
            ...column,
            metric: {
              ...column.metric,
              bars: { ...column.metric.bars, session: "regular" as const },
            },
          }
        : column,
    ),
  };
  render(<FormulaRuntime watchlist={watchlist} values={f.values} />);
  const requests = mocks.group.mock.lastCall![0] as TeaGroupRequest[];
  expect(requests).toHaveLength(2);
  expect(requests[0]!.node.inputs.bars).toMatchObject(daily);
  expect(requests[1]!.node.inputs.bars).toMatchObject({
    ...daily,
    session: "extended",
  });
  expect(f.values.value.wit_b?.wcl_value?.status).toBe("error");
  f.values.value.wit_b?.wcl_value?.retry?.();
  expect(f.refetch).toHaveBeenCalledOnce();
});

it("keeps capability and execution failures separate, clears old values, and retries current execution", () => {
  const f = setup();
  f.states.set("wit_a:wcl_value", ready(3, 4));
  const watchlist = list();
  const view = render(
    <FormulaRuntime watchlist={watchlist} values={f.values} />,
  );
  f.states.set("wit_a:wcl_value", {
    status: "error",
    compiled,
    error: new Error("Execution unavailable"),
  });
  mocks.capabilities.mockReturnValue([
    { data: [daily], refetch: f.refetch },
    {
      isError: true,
      error: new Error("Market unavailable"),
      refetch: f.refetch,
    },
  ]);
  view.rerender(<FormulaRuntime watchlist={watchlist} values={f.values} />);
  expect(f.values.value.wit_a?.wcl_value).toMatchObject({
    status: "error",
    error: "Execution unavailable",
  });
  expect(f.values.value.wit_a?.wcl_value).not.toHaveProperty("value");
  f.values.value.wit_a?.wcl_value?.retry?.();
  expect(f.retry).toHaveBeenCalledWith("wit_a:wcl_value");
  expect(f.values.value.wit_b?.wcl_value).toMatchObject({
    status: "error",
    error: "Market unavailable",
  });
  expect(mocks.group.mock.lastCall![0] as TeaGroupRequest[]).toHaveLength(2);
});

it("never uses another output when a saved output is missing", () => {
  const f = setup();
  f.states.set("wit_a:wcl_value", ready(3, 4));
  const original = list();
  const watchlist = {
    ...original,
    columns: original.columns.map<Watchlist["columns"][number]>((column) =>
      column.id === "wcl_value" && column.metric.kind === "formula"
        ? { ...column, metric: { ...column.metric, output: "removed" } }
        : column,
    ),
  };
  render(<FormulaRuntime watchlist={watchlist} values={f.values} />);
  expect(f.values.value.wit_a?.wcl_value?.status).toBe("error");
  expect(f.values.value.wit_a?.wcl_value?.error).toContain("removed");
  expect(f.values.value.wit_a?.wcl_value?.value).toBeUndefined();
});

it.each([
  { type: new Int64(), value: 42n },
  { type: new Int64(), value: -9_223_372_036_854_775_808n },
  { type: new Uint64(), value: 0n },
  { type: new Uint64(), value: 18_446_744_073_709_551_615n },
])(
  "reports unsupported $type output $value instead of silently rendering an empty cell",
  ({ type, value }) => {
    const f = setup();
    const integerOutputs = new Schema([
      new Field("time", new TimestampMillisecond(), false),
      new Field("value", type, true, new Map([["tea:write", "set"]])),
    ]);
    const data = fromRows(integerOutputs, [{ time: 10, value }]);
    expect(data.get(0)?.value).toBe(value);
    f.states.set("wit_a:wcl_value", {
      status: "ready",
      compiled: {
        ...compiled,
        definition: { ...compiled.definition, outputs: integerOutputs },
      },
      time: 10,
      data,
    });
    render(<FormulaRuntime watchlist={list()} values={f.values} />);
    expect(f.values.value.wit_a?.wcl_value).toMatchObject({
      status: "error",
      error: expect.stringContaining("Output “value” is unavailable"),
    });
    expect(f.values.value.wit_a?.wcl_value).not.toHaveProperty("value");
  },
);
