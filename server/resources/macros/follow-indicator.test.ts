// Purpose: A rule that follows an Indicator runs it on the rule's market and reads its numeric and plot outputs as indicator.<name>.
import { BarsSeries } from "@openchart/feed";
import { indicatorResource } from "@openchart/server/resources/indicator";
import * as Tea from "@openchart/tea";
import { Field, Float64, Schema as ArrowSchema, Struct } from "apache-arrow";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";

import { followIndicatorNodes } from "./follow-indicator";

const market = Schema.decodeUnknownSync(BarsSeries)({
  provider: "binance",
  listing: { symbol: "BTCUSDT", currency: "USDT" },
  resolution: "1m",
  session: "24h",
  adjustment: "raw",
});
const output = (name: string, typeId?: string) =>
  new Field(
    name,
    typeId ? new Struct([]) : new Float64(),
    true,
    new Map(
      typeId
        ? [
            ["tea:write", "set"],
            ["tea:typeId", typeId],
          ]
        : [["tea:write", "set"]],
    ),
  );
/** A compiled `plot("avg", ...)`, `emit "raw" ...` and `hline("level", ...)` Indicator. */
const compiled: Pick<Tea.CompileResponse, "id" | "definition" | "declaration"> =
  {
    id: "compiled-indicator",
    declaration: {
      kind: "indicator",
      title: "Average",
      overlay: false,
      timeframe: "",
    },
    definition: {
      parameters: [
        {
          name: "length",
          title: null,
          type: "int",
          control: "int",
          defaultValue: 2,
          active: null,
          constraints: null,
          enumType: null,
          group: null,
          inline: null,
          tooltip: null,
          confirm: false,
          display: "all",
          seriesSid: null,
        },
      ],
      inputs: new ArrowSchema([new Field("close", new Float64(), true)]),
      outputs: new ArrowSchema([
        output("avg", "visual.Plot"),
        output("raw"),
        output("level", "visual.Hline"),
      ]),
      requests: {},
    },
  };
const rule = { parameters: { threshold: 12 }, requests: {} };
const following = (parameterOverrides: Tea.ParameterOverrides) => ({
  indicator: Schema.decodeUnknownSync(indicatorResource.entity)({
    id: "ind_average",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    chartId: "cht_a",
    cellId: "ccl_a",
    source: { workspaceId: "wsp_test", path: "average.tea" },
    snapshot: { "average.tea": "" },
    parameterOverrides,
  }),
  market,
});

test("the Indicator runs on the rule's market as nodes.indicator, and its plot and numeric outputs become indicator.<name> columns", () => {
  const { config, nodes } = Effect.runSync(
    followIndicatorNodes(rule, following({ length: 4 }), compiled),
  );
  const bars = Tea.barsInputs(market);
  expect(config).toEqual({
    inputs: {
      ...bars.inputs,
      indicator: {
        _tag: "NodeRef",
        node: "indicator",
        schema: compiled.definition.outputs,
      },
    },
    map: {
      ...bars.map,
      "indicator.avg": ["indicator", ["avg", "series"]],
      "indicator.raw": ["indicator", ["raw"]],
    },
    parameters: { threshold: 12 },
    requests: {},
  });
  expect(nodes).toEqual({
    indicator: {
      id: "compiled-indicator",
      ...bars,
      parameters: { length: 4 },
      requests: {},
    },
  });
  // Equal Bars inputs, so the service opens the market once for both nodes.
  expect(nodes.indicator!.inputs.bars).toEqual(config.inputs.bars);
});

test.each([
  ["“missing” no longer exists", following({ missing: 1 }), compiled],
  [
    "indicator() declaration",
    following({}),
    { ...compiled, declaration: null },
  ],
])(
  "an Indicator a rule cannot read fails as invalid_request: %s",
  (message, follow, indicator) => {
    const error = Effect.runSync(
      Effect.flip(followIndicatorNodes(rule, follow, indicator)),
    );
    expect(error).toBeInstanceOf(Tea.Error);
    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain(message);
  },
);
