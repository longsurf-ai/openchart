// Purpose: Verifies chart entity composition and preserves its invariants in Resource write schemas.

import {
  defineResource,
  STRICT_PARSE_OPTIONS,
} from "@openchart/server/lib/resource/definition";
import {
  resourceIssues,
  type Path,
} from "@openchart/server/lib/resource/invariant";
import type { WritableSchema } from "@openchart/server/lib/resource/write-schema";
import { Result, Schema } from "effect";
import { expect, expectTypeOf, test } from "vitest";

import { ChartEntity, ChartId, ChartSeries, type ChartPane } from "./entity";
import {
  chartCellTable,
  chartLinkTable,
  chartSeriesTable,
  chartTable,
} from "./schema";

function unusedStore(): never {
  throw new Error("Entity tests must not access a store");
}

const resource = defineResource({
  name: "chart",
  entity: ChartEntity,
  store: {
    load: unusedStore,
    list: unusedStore,
    insert: unusedStore,
    save: unusedStore,
    remove: unusedStore,
  },
});
const decode = Schema.decodeUnknownSync(ChartEntity, STRICT_PARSE_OPTIONS);
const create = Schema.decodeUnknownSync(
  resource.createSchema,
  STRICT_PARSE_OPTIONS,
);
const update = Schema.decodeUnknownSync(
  resource.updateSchema,
  STRICT_PARSE_OPTIONS,
);

function cell(suffix = "a") {
  return {
    id: `ccl_${suffix}`,
    marketSources: [
      {
        id: `cms_${suffix}_primary`,
        provider: "yfinance",
        listing: { symbol: "AAPL", currency: "USD" },
      },
      {
        id: `cms_${suffix}_comparison`,
        provider: "binance",
        listing: { symbol: "BTCUSDT", currency: "USDT" },
      },
    ],
    panes: [
      {
        id: `cpn_${suffix}_study`,
        series: [
          {
            id: `csr_${suffix}_volume`,
            role: "normal",
            source: {
              kind: "market",
              marketSourceId: `cms_${suffix}_primary`,
              output: "volume",
            },
          },
        ],
      },
      {
        id: `cpn_${suffix}_price`,
        series: [
          {
            id: `csr_${suffix}_comparison`,
            role: "normal",
            source: {
              kind: "market",
              marketSourceId: `cms_${suffix}_comparison`,
              output: "price",
            },
          },
          {
            id: `csr_${suffix}_primary`,
            role: "main",
            source: {
              kind: "market",
              marketSourceId: `cms_${suffix}_primary`,
              output: "price",
            },
          },
          {
            id: `csr_${suffix}_indicator`,
            role: "normal",
            source: {
              kind: "indicator",
              indicatorId: `ind_${suffix}`,
              output: "value",
            },
          },
        ],
      },
    ],
  };
}

function body() {
  return {
    dashboardId: "dsh_dashboard",
    cells: [cell("a"), cell("b")],
    links: [{ id: "clk_ab", fromCellId: "ccl_a", toCellId: "ccl_b" }],
  };
}

function entity() {
  return {
    id: "cht_grid",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    ...body(),
  };
}

test("composes the whole grid with one envelope and column-derived defaults", () => {
  const parsed = decode(entity());
  expect(resource.entity).toBe(ChartEntity);
  expect(resource.id.create).toBe(ChartId.create);
  expect(parsed.preset).toBe(chartTable.preset.default);
  expect(parsed.cells).toHaveLength(2); // The default preset only shows one.
  expect(parsed.cells[0]?.resolution).toBe(chartCellTable.resolution.default);
  expect(parsed.cells[0]?.session).toBe(chartCellTable.session.default);
  expect(parsed.cells[0]?.adjustment).toBe(chartCellTable.adjustment.default);
  expect(parsed.links[0]).toMatchObject({
    syncListing: chartLinkTable.syncListing.default,
    syncCrosshair: chartLinkTable.syncCrosshair.default,
  });
  expect(Schema.encodeSync(ChartEntity)(parsed)).toEqual(parsed);
  expect(() => decode(body())).toThrow();
});

test("an empty grid is valid but each existing cell needs a main binding", () => {
  expect(create({ dashboardId: "dsh_dashboard" })).toEqual({
    dashboardId: "dsh_dashboard",
    preset: chartTable.preset.default,
    cells: [],
    links: [],
  });
  expect(() =>
    create({ dashboardId: "dsh_dashboard", cells: [{ ...cell(), panes: [] }] }),
  ).toThrow();
});

test("main identity is independent of pane and series order", () => {
  const input = body();
  const parsed = create(input);
  expect(parsed.cells[0]?.panes[0]?.series).toHaveLength(1);
  expect(parsed.cells[0]?.panes[1]?.series[1]?.role).toBe("main");
  input.cells[0]!.panes.reverse();
  expect(create(input).cells[0]?.panes[0]?.series[1]?.role).toBe("main");
});

test("rejects missing and multiple main series", () => {
  for (const role of ["normal", "main"]) {
    const input = body();
    input.cells[0]!.panes[1]!.series[role === "normal" ? 1 : 0]!.role = role;
    expect(() => create(input)).toThrow();
  }
});

test("rejects empty or omitted pane bindings in every Resource schema", () => {
  expectTypeOf<[]>().not.toExtend<ChartPane["series"]>();
  for (const series of [[], undefined]) {
    const input = body();
    const cell = input.cells[0]!;
    const value = {
      ...input,
      cells: [
        { ...cell, panes: [{ ...cell.panes[0], series }, cell.panes[1]] },
      ],
      links: [],
    };
    expect(() => create(value)).toThrow();
    expect(() => update(value)).toThrow();
    expect(() => decode({ ...entity(), ...value })).toThrow();
  }
});

test("source is a typed union and indicator bindings cannot be main", () => {
  type IndicatorSeries = Extract<
    ChartSeries,
    { readonly source: { readonly kind: "indicator" } }
  >;
  expectTypeOf<IndicatorSeries["role"]>().toEqualTypeOf<"normal">();
  expectTypeOf<ChartSeries["source"]["kind"]>().toEqualTypeOf<
    "market" | "indicator"
  >();
  const parse = Schema.decodeUnknownSync(ChartSeries, STRICT_PARSE_OPTIONS);
  const indicator = {
    id: "csr_indicator",
    source: { kind: "indicator", indicatorId: "ind_a", output: "value" },
  };
  expect(parse(indicator).role).toBe(chartSeriesTable.role.default);
  expect(() => parse({ ...indicator, role: "main" })).toThrow();
  // Only price can be main; volume is always a normal binding.
  const market = (output: string) => ({
    id: "csr_market",
    role: "main",
    source: { kind: "market", marketSourceId: "cms_a", output },
  });
  expect(parse(market("price")).role).toBe("main");
  expect(() => parse(market("volume"))).toThrow();
  expect(parse({ ...market("volume"), role: "normal" }).source).toMatchObject({
    output: "volume",
  });
  for (const source of [
    {},
    { kind: "market" },
    { kind: "market", marketSourceId: "cms_a", indicatorId: "ind_a" },
    { kind: "market", marketSourceId: "cms_a" },
    { kind: "market", marketSourceId: "cms_a", output: "value" },
    { kind: "indicator", output: "value" },
    { kind: "indicator", indicatorId: "", output: "value" },
    { kind: "indicator", indicatorId: "ind_a" },
    { kind: "indicator", indicatorId: "ind_a", output: "" },
    { kind: "indicator", indicatorId: "ind_a", output: null },
  ]) {
    expect(() => parse({ ...indicator, source })).toThrow();
  }
});

test("only a volume profile binding carries settings, within their bounds", () => {
  const parse = Schema.decodeUnknownSync(ChartSeries, STRICT_PARSE_OPTIONS);
  const binding = (output: string, settings: object) => ({
    id: "csr_market",
    role: "normal",
    source: { kind: "market", marketSourceId: "cms_a", output },
    ...settings,
  });
  const chosen = { resolution: "1h", rows: 100 };
  expect(parse(binding("volumeProfile", chosen))).toMatchObject(chosen);
  // Absent settings stay absent: the profile keeps its defaults.
  expect(parse(binding("volumeProfile", {}))).not.toHaveProperty("rows");
  for (const invalid of [
    binding("volume", { rows: 24 }),
    binding("price", { resolution: "1h" }),
    binding("volumeProfile", { rows: 0 }),
    binding("volumeProfile", { rows: 101 }),
    binding("volumeProfile", { rows: 2.5 }),
    binding("volumeProfile", { resolution: "2h" }),
  ])
    expect(() => parse(invalid)).toThrow();
});

test("rejects dangling and cross-cell market references", () => {
  for (const suffix of ["missing", "b"]) {
    const market = body();
    market.cells[0]!.panes[1]!.series[0]!.source.marketSourceId = `cms_${suffix}_comparison`;
    expect(() => create(market)).toThrow();
  }
});

test("indicator bindings name an Indicator by value without a chart-owned indicator", () => {
  // The chart owns no indicators; unknown and other-cell ids both decode.
  for (const indicatorId of ["ind_missing", "ind_b"]) {
    const input = body();
    input.cells[0]!.panes[1]!.series[2]!.source.indicatorId = indicatorId;
    expect(create(input).cells[0]?.panes[1]?.series[2]?.source).toEqual({
      kind: "indicator",
      indicatorId,
      output: "value",
    });
  }
});

test("market sources and indicator bindings survive removal of non-main display bindings", () => {
  const input = body();
  input.cells[0]!.panes[1]!.series.splice(0, 1);
  const parsed = create(input).cells[0]!;
  expect(parsed.marketSources.map((source) => source.id)).toEqual([
    "cms_a_primary",
    "cms_a_comparison",
  ]);
  expect(parsed.panes[1]?.series.map((series) => series.source)).toEqual([
    { kind: "market", marketSourceId: "cms_a_primary", output: "price" },
    { kind: "indicator", indicatorId: "ind_a", output: "value" },
  ]);
});

test("one indicator output can appear in multiple explicit panes", () => {
  const input = body();
  const binding = input.cells[0]!.panes[1]!.series[2]!;
  input.cells[0]!.panes[0]!.series = [
    {
      ...binding,
      id: "csr_second_output",
    },
  ];
  const panes = create(input).cells[0]!.panes;
  expect(panes[0]?.series.map((series) => series.source)).toEqual([
    binding.source,
  ]);
  expect(panes[1]?.series[2]?.source).toEqual(binding.source);
});

test("rejects duplicate identities within collections and across cells", () => {
  const duplicateCell = body();
  duplicateCell.cells.push(cell("a"));
  expect(() => create(duplicateCell)).toThrow();

  for (const suffix of ["a", "b"]) {
    const pane = body();
    pane.cells[1]!.panes[1]!.id = `cpn_${suffix}_study`;
    expect(() => create(pane)).toThrow();
    const source = body();
    source.cells[1]!.marketSources.push({
      id: `cms_${suffix}_primary`,
      provider: "yfinance",
      listing: { symbol: "MSFT", currency: "USD" },
    });
    expect(() => create(source)).toThrow();
    const series = body();
    series.cells[1]!.panes[1]!.series[0]!.id = `csr_${suffix}_primary`;
    expect(() => create(series)).toThrow();
  }
});

test("links reject self-links, duplicate ids, and repeated directed pairs", () => {
  const input = body();
  for (const link of [
    { id: "clk_self", fromCellId: "ccl_a", toCellId: "ccl_a" },
    { id: "clk_ab", fromCellId: "ccl_b", toCellId: "ccl_a" },
    { id: "clk_duplicate_pair", fromCellId: "ccl_a", toCellId: "ccl_b" },
  ]) {
    expect(() => create({ ...input, links: [...input.links, link] })).toThrow();
  }
  expect(
    create({
      ...input,
      links: [
        ...input.links,
        { id: "clk_ba", fromCellId: "ccl_b", toCellId: "ccl_a" },
      ],
    }).links,
  ).toHaveLength(2);
});

test("rejects invalid listing identities and enum values", () => {
  const source = cell().marketSources[0]!;
  for (const invalid of [
    { listing: 101 },
    { listing: { symbol: "AAPL" } },
    { listing: { currency: "USD" } },
    { listing: { symbol: "AAPL", currency: "USD", id: Infinity } },
    { listing: { symbol: "AAPL", currency: "USD", unknown: true } },
    { provider: "" },
    { provider: undefined },
  ]) {
    expect(() =>
      create({
        ...body(),
        cells: [
          {
            ...cell(),
            marketSources: [{ ...source, ...invalid }, cell().marketSources[1]],
          },
        ],
      }),
    ).toThrow();
  }
  expect(() => create({ ...body(), preset: "1x1" })).toThrow();
  expect(() =>
    create({ ...body(), cells: [{ ...cell(), resolution: "daily" }] }),
  ).toThrow();
  expect(() =>
    create({ ...body(), cells: [{ ...cell(), session: "unknown" }] }),
  ).toThrow();
  expect(() =>
    create({ ...body(), cells: [{ ...cell(), adjustment: "unknown" }] }),
  ).toThrow();
});

test("does not admit removed configuration, child envelopes, or storage columns", () => {
  for (const extra of [
    { revision: 1 },
    { position: 0 },
    { chartId: "cht_grid" },
    { listing: 101 },
  ]) {
    expect(() =>
      create({ ...body(), cells: [{ ...cell(), ...extra }] }),
    ).toThrow();
  }
  // Indicators are their own Resource; a cell no longer carries them.
  const indicators = [
    {
      id: "ind_a",
      source: { workspaceId: "wsp_test", path: "sma.tea" },
      parameterOverrides: {},
    },
  ];
  for (const extra of [{ indicators: [] }, { indicators }]) {
    const cells = [{ ...cell(), ...extra }];
    expect(() => create({ ...body(), cells })).toThrow();
    expect(() => decode({ ...entity(), cells })).toThrow();
  }
  expect(() =>
    create({ ...body(), links: [{ ...body().links[0], position: 0 }] }),
  ).toThrow();
});

test("removed time-scale linking is rejected", () => {
  expect(() =>
    create({ ...body(), links: [{ ...body().links[0], syncTimeScale: true }] }),
  ).toThrow();
});

test("Resource write derivation retains constraints and excludes only the envelope", () => {
  const parsed = decode(entity());
  const projected = resource.project(parsed);
  expect(update(projected)).toEqual(create(body()));
  for (const field of ["id", "revision", "createdAt", "updatedAt"]) {
    expect(() =>
      create({ ...body(), [field]: parsed[field as keyof typeof parsed] }),
    ).toThrow();
  }
  const writable = create(body());
  const withoutMain = {
    ...writable,
    cells: writable.cells.map((item) => ({ ...item, panes: [] })),
  };
  expect(() => update(withoutMain)).toThrow();
  expect(() => update({ ...body(), cells: [cell(), cell()] })).toThrow();
});

test("root invariants report every invalid cell and link with field paths", () => {
  const input = body();
  input.cells[0]!.panes[1]!.series[1]!.role = "normal";
  input.cells[1]!.panes[1]!.series[0]!.role = "main";
  input.cells[0]!.panes[1]!.series[0]!.source.marketSourceId =
    "cms_b_comparison";
  input.links[0]!.toCellId = "ccl_missing";
  for (const [schema, value] of [
    [ChartEntity, { ...entity(), ...input }],
    [resource.body, input],
    [resource.createSchema, input],
    [resource.updateSchema, input],
  ] as const) {
    const result = Schema.decodeUnknownResult(schema)(value);
    if (Result.isSuccess(result)) throw new Error("Expected invalid chart");
    expect(resourceIssues(result.failure.issue)).toMatchObject([
      {
        code: "chart.main_series_count",
        path: "/cells/0/panes",
        expected: 1,
        actual: 0,
      },
      {
        code: "chart.main_series_count",
        path: "/cells/1/panes",
        expected: 1,
        actual: 2,
      },
      {
        code: "chart.series_source",
        path: "/cells/0/panes/1/series/0/source/marketSourceId",
      },
      { code: "chart.link_endpoint", path: "/links/0/toCellId" },
    ]);
  }
});

test("duplicate identities identify the duplicate field and paths derive from ChartEntity", () => {
  const input = body();
  input.cells[1]!.panes[1]!.series[0]!.id =
    input.cells[0]!.panes[1]!.series[0]!.id;
  const result = Schema.decodeUnknownResult(resource.createSchema)(input);
  if (Result.isSuccess(result))
    throw new Error("Expected duplicate id rejection");
  expect(resourceIssues(result.failure.issue)).toMatchObject([
    { code: "chart.unique_ids", path: "/cells/1/panes/1/series/0/id" },
  ]);
  type ChartPath = Path<WritableSchema<typeof ChartEntity>["Type"]>;
  expectTypeOf<
    readonly [
      "cells",
      number,
      "panes",
      number,
      "series",
      number,
      "source",
      "indicatorId",
    ]
  >().toExtend<ChartPath>();
  expectTypeOf<readonly ["cells", number, "paens"]>().not.toExtend<ChartPath>();
  expectTypeOf<
    readonly ["cells", number, "panes", number, "id", "length"]
  >().not.toExtend<ChartPath>();
  expectTypeOf<readonly ["revision"]>().not.toExtend<ChartPath>();
});
