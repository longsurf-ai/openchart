// Purpose: Tea's shared contracts parse strictly at every level and keep the window, ordering and Bars column rules.
import { Field, Float64, Schema as ArrowSchema } from "apache-arrow";
import { Result, Schema, Struct } from "effect";
import { expect, it } from "vitest";
import { BarsSeries } from "@openchart/feed";
import { fromPoints, toJson } from "@openchart/timeseries";
import {
  ArrowSchemaJson,
  Bars,
  barsInputs,
  barsSchema,
  CompileRequest,
  CompileResponse,
  Message,
  NodeConfig,
  NodeRef,
  ObserveRequest,
  requestSeries,
  Samples,
} from "./index";

// The encoded barsSchema, written out in full. The alert-rule data migration
// stores this exact JSON, so changing it needs a new migration.
const barsSchemaJson = {
  fields: [
    {
      name: "open",
      nullable: true,
      type: { name: "floatingpoint", precision: "DOUBLE" },
      children: [],
    },
    {
      name: "high",
      nullable: true,
      type: { name: "floatingpoint", precision: "DOUBLE" },
      children: [],
    },
    {
      name: "low",
      nullable: true,
      type: { name: "floatingpoint", precision: "DOUBLE" },
      children: [],
    },
    {
      name: "close",
      nullable: true,
      type: { name: "floatingpoint", precision: "DOUBLE" },
      children: [],
    },
    {
      name: "volume",
      nullable: true,
      type: { name: "floatingpoint", precision: "DOUBLE" },
      children: [],
    },
    {
      name: "hl2",
      nullable: true,
      type: { name: "floatingpoint", precision: "DOUBLE" },
      children: [],
    },
    {
      name: "hlc3",
      nullable: true,
      type: { name: "floatingpoint", precision: "DOUBLE" },
      children: [],
    },
    {
      name: "ohlc4",
      nullable: true,
      type: { name: "floatingpoint", precision: "DOUBLE" },
      children: [],
    },
    {
      name: "hlcc4",
      nullable: true,
      type: { name: "floatingpoint", precision: "DOUBLE" },
      children: [],
    },
  ],
};

const listing = { symbol: "BTCUSDT", name: "Bitcoin", currency: "USDT" };
const series = {
  provider: "binance",
  listing,
  resolution: "1m",
  session: "24h",
  adjustment: "raw",
};
const bars = { _tag: "Bars", ...series, schema: barsSchemaJson };
const config = {
  inputs: { bars },
  map: { close: ["bars", ["close"]] },
  parameters: { length: 14 },
  requests: {},
};
const column = (name: string, type: object) => ({
  name,
  nullable: true,
  type,
  children: [],
});
const double = { name: "floatingpoint", precision: "DOUBLE" };
const ohlcv = ["open", "high", "low", "close", "volume"].map((name) =>
  column(name, double),
);

/** The message of the schema issue that rejects `input`; a thrown defect fails the test. */
function rejection(schema: Schema.Codec<unknown, unknown>, input: unknown) {
  const result = Schema.decodeUnknownResult(schema)(input);
  if (Result.isSuccess(result)) throw new Error("Expected a schema issue");
  return String(result.failure);
}

it("round trips a compile response with detached Arrow JSON definitions", () => {
  const inputs = new ArrowSchema([
    new Field("close", new Float64(), false, new Map([["source", "price"]])),
  ]);
  const response = {
    id: "compiled",
    declaration: null,
    definition: {
      parameters: [],
      inputs,
      outputs: inputs,
      requests: {
        daily: {
          parameters: [],
          inputs,
          outputs: inputs,
          requests: {},
          target: { symbol: "binance:ETHUSDT", timeframe: "D" },
        },
      },
    },
  };
  const encoded = Schema.encodeSync(CompileResponse)(response);
  expect(encoded.definition.inputs).toEqual({
    fields: [
      {
        ...column("close", double),
        nullable: false,
        metadata: [{ key: "source", value: "price" }],
      },
    ],
  });
  const decoded = Schema.decodeUnknownSync(CompileResponse)(
    JSON.parse(JSON.stringify(encoded)),
  );
  expect(decoded.definition.inputs.fields[0]?.metadata.get("source")).toBe(
    "price",
  );
  decoded.definition.inputs.fields[0]!.metadata.set("source", "changed");
  expect(inputs.fields[0]?.metadata.get("source")).toBe("price");
  expect(decoded.definition.requests.daily?.target).toEqual({
    symbol: "binance:ETHUSDT",
    timeframe: "D",
  });
  expect(
    decoded.definition.requests.daily?.inputs.fields[0]?.metadata.get("source"),
  ).toBe("price");
  const { id, definition } = encoded;
  for (const invalid of [
    { ...encoded, definition: { ...definition, inputs: "invalid" } },
    { ...encoded, definition: { ...definition, outputs: { fields: [{}] } } },
    {
      ...encoded,
      definition: {
        ...definition,
        requests: { daily: { ...definition.requests.daily, id: "child" } },
      },
    },
    { id, declaration: null, ...definition }, // the old flat shape
  ])
    rejection(CompileResponse, invalid);
});

it("encodes barsSchema as the frozen Arrow JSON that stored rules copy", () => {
  const encoded = Schema.encodeSync(ArrowSchemaJson)(barsSchema);
  expect(JSON.stringify(encoded)).toBe(JSON.stringify(barsSchemaJson));
  expect(Schema.decodeUnknownSync(Bars)(bars).schema.fields).toHaveLength(9);
});

it("accepts only Bars columns as DOUBLE, requires OHLCV, and names the field at fault", () => {
  const withFields = (fields: readonly object[]) => ({
    ...bars,
    schema: { fields },
  });
  expect(
    Schema.decodeUnknownSync(Bars)(withFields(ohlcv)).schema.fields,
  ).toHaveLength(5);
  const exceptVolume = ohlcv.filter(({ name }) => name !== "volume");
  const notDouble = `must have type {"name":"floatingpoint","precision":"DOUBLE"}`;
  for (const [fields, message] of [
    [exceptVolume, "Schema is missing required Bars columns: volume"],
    // Present with the wrong type is not missing.
    [
      [
        ...exceptVolume,
        column("volume", { name: "int", bitWidth: 64, isSigned: true }),
      ],
      `Field 'volume' ${notDouble}`,
    ],
    [
      [...ohlcv, column("hl2", { name: "floatingpoint", precision: "SINGLE" })],
      `Field 'hl2' ${notDouble}`,
    ],
    [[...ohlcv, column("hl2", { name: "utf8" })], `Field 'hl2' ${notDouble}`],
    [
      [...ohlcv, column("trades", double)],
      "Field 'trades' is not a Bars column (open, high, low, close, volume, hl2, hlc3, ohlc4, hlcc4)",
    ],
    [
      [...ohlcv, column("time", { name: "timestamp", unit: "MILLISECOND" })],
      "Field 'time' is not a Bars column",
    ],
  ] as const)
    expect(rejection(Bars, withFields(fields))).toContain(message);
});

it("requires sample rows to be completed bars with strictly ascending times", () => {
  const row = (time: number) => ({
    time,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: null,
  });
  const samples = (rows: object[]) => ({
    ...bars,
    _tag: "Samples",
    rows,
  });
  expect(
    Schema.decodeUnknownSync(Samples)(samples([row(0), row(60_000)])).rows,
  ).toHaveLength(2);
  for (const rows of [
    [row(60_000), row(0)],
    [row(0), row(0)],
  ])
    expect(rejection(Samples, samples(rows))).toContain("strictly ascend");
  rejection(Samples, samples([{ ...row(0), trades: 1 }]));
  expect(
    rejection(Samples, { ...samples([]), schema: { fields: [] } }),
  ).toContain(
    "Schema is missing required Bars columns: open, high, low, close, volume",
  );
});

it("rejects unknown keys at every level, including inside nodes and requests", () => {
  const nodeRef = { _tag: "NodeRef", node: "rsi", schema: barsSchemaJson };
  expect(Schema.decodeUnknownSync(NodeRef)(nodeRef).node).toBe("rsi");
  const request = {
    ...config,
    inputs: { bars, rsi: nodeRef },
    id: "alert",
    from: 1,
    to: "now",
    countBack: 1,
    warmupBars: 1000,
    nodes: { rsi: { id: "rsi", ...config } },
  };
  expect(Schema.decodeUnknownSync(ObserveRequest)(request).nodes.rsi?.id).toBe(
    "rsi",
  );
  for (const [schema, invalid] of [
    [Bars, { ...bars, extra: 1 }],
    [Bars, { ...bars, listing: { ...listing, extra: 1 } }],
    [NodeRef, { ...nodeRef, extra: 1 }],
    [Samples, { ...bars, _tag: "Samples", rows: [], extra: 1 }],
    [NodeConfig, { ...config, extra: 1 }],
    [NodeConfig, { ...config, inputs: { bars: { ...bars, extra: 1 } } }],
    [NodeConfig, { ...config, requests: { daily: { ...config, extra: 1 } } }],
    [ObserveRequest, { ...request, extra: 1 }],
    [
      ObserveRequest,
      { ...request, nodes: { rsi: { id: "rsi", ...config, extra: 1 } } },
    ],
    [
      ObserveRequest,
      {
        ...request,
        nodes: {
          rsi: {
            id: "rsi",
            ...config,
            inputs: { bars: { ...bars, extra: 1 } },
          },
        },
      },
    ],
  ] as const)
    expect(rejection(schema, invalid)).toContain("excess");
});

it("keeps from < to, countBack > 0 and a whole warmupBars >= 0, and requires complete child configs", () => {
  const request = {
    ...config,
    id: "compiled",
    from: 1,
    to: "now",
    countBack: 10,
    warmupBars: 0,
    requests: { daily: config },
    nodes: {},
  };
  const decode = Schema.decodeUnknownSync(ObserveRequest);
  expect(decode(request).to).toBe("now");
  expect(decode({ ...request, to: 2 }).to).toBe(2);
  expect(rejection(ObserveRequest, { ...request, to: 1 })).toContain(
    "from must precede to",
  );
  for (const invalid of [
    { ...request, countBack: 0 },
    { ...request, warmupBars: -1 },
    { ...request, warmupBars: 1.5 },
    { ...request, warmupBars: undefined },
    // JSON drops undefined, so a request without the key is what can arrive.
    Struct.omit(request, ["warmupBars"]),
    { ...request, id: "" },
    { ...request, nodes: undefined },
    { ...request, nodes: { rsi: config } }, // a node needs its compiled id
    { ...request, requests: { daily: { ...config, parameters: undefined } } },
  ])
    rejection(ObserveRequest, invalid);
});

it("names the run and the config it reads in every snapshot message", () => {
  const snapshot = {
    range: { from: 0, to: 2 },
    data: toJson(fromPoints({}, [{ time: 1, price: 1 }])),
  };
  const config = { inputs: {}, map: {}, parameters: {}, requests: {} };
  const decode = Schema.decodeUnknownSync(Message);
  expect(
    decode({ type: "snapshot", rid: "run", config, snapshot }),
  ).toMatchObject({ rid: "run", config });
  for (const invalid of [
    { type: "snapshot", config, snapshot },
    { type: "snapshot", rid: "", config, snapshot },
    { type: "snapshot", rid: "run", snapshot },
    {
      type: "snapshot",
      rid: "run",
      config,
      snapshot: {
        ...snapshot,
        data: toJson(fromPoints({}, [{ time: 2, price: 1 }])),
      },
    },
  ])
    rejection(Message, invalid);
});

it("builds a Bars input and a map for every Bars column", () => {
  const decoded = Schema.decodeUnknownSync(BarsSeries)(series);
  const withExtraKeys = { ...decoded, id: 7 };
  const inputs = barsInputs(withExtraKeys);
  expect(inputs).toEqual({
    inputs: { bars: { _tag: "Bars", ...decoded, schema: barsSchema } },
    map: {
      open: ["bars", ["open"]],
      high: ["bars", ["high"]],
      low: ["bars", ["low"]],
      close: ["bars", ["close"]],
      volume: ["bars", ["volume"]],
      hl2: ["bars", ["hl2"]],
      hlc3: ["bars", ["hlc3"]],
      ohlc4: ["bars", ["ohlc4"]],
      hlcc4: ["bars", ["hlcc4"]],
    },
  });
  const encoded = Schema.encodeSync(NodeConfig)({
    ...inputs,
    parameters: {},
    requests: {},
  });
  expect(encoded.inputs.bars).toEqual(bars);
  const roundTrip = Schema.decodeUnknownSync(NodeConfig)(
    JSON.parse(JSON.stringify(encoded)),
  );
  expect(Schema.is(NodeConfig)(roundTrip)).toBe(true);
});

it("accepts exactly Workspace sources or complete snapshot sources", () => {
  const decode = Schema.decodeUnknownSync(CompileRequest);
  expect(
    decode({ workspaceId: "wsp_test", path: "main.tea", includeSources: true }),
  ).toEqual({
    workspaceId: "wsp_test",
    path: "main.tea",
    includeSources: true,
  });
  expect(decode({ entry: "main.tea", sources: { "main.tea": "" } })).toEqual({
    entry: "main.tea",
    sources: { "main.tea": "" },
  });
  for (const request of [
    { source: "" },
    { path: "main.tea" },
    { entry: "main.tea", sources: {} },
    { entry: "main.tea", sources: { "other.tea": "" } },
    { entry: "main.tea", sources: { "main.tea": "" }, includeSources: true },
    {
      workspaceId: "wsp_test",
      path: "main.tea",
      entry: "main.tea",
      sources: { "main.tea": "" },
    },
  ])
    expect(() => decode(request)).toThrow();
});

it("lists the market each request child reads, leaving out node references", () => {
  const series = Schema.decodeUnknownSync(BarsSeries)({
    provider: "binance",
    listing: { symbol: "BTCUSDT", currency: "USDT" },
    resolution: "1m",
    session: "24h",
    adjustment: "raw",
  });
  const daily = { ...series, resolution: "1d" as const };
  const config: NodeConfig = {
    ...barsInputs(series),
    parameters: {},
    requests: {
      daily: { ...barsInputs(daily), parameters: {}, requests: {} },
      indicator: {
        inputs: {
          rsi: { _tag: "NodeRef", node: "rsi", schema: new ArrowSchema([]) },
        },
        map: {},
        parameters: {},
        requests: {},
      },
    },
  };
  expect(requestSeries(config)).toEqual([{ name: "daily", series: daily }]);
});
