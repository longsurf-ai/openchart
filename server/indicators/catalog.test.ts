// Purpose: Compile and execute every shipped file against real Tea with deterministic OHLCV.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  createNode,
  DataStream,
  pineBuiltinSupplier,
  tea,
  type Datum,
  type Node,
} from "tea";
import { BarsSeries } from "@openchart/feed";
import { marketContext } from "@openchart/server/tea/source";
import { columnSchema } from "@openchart/server/tea/wiring";
import { from } from "rxjs";
import { indicatorCatalog, indicatorGoalKeys } from "./catalog";

/**
 * Bind 160 hourly bars to a script and to each of its request children, the
 * way TeaService wires a live chart: timed rows, the newest still forming,
 * every unread column ignored, and columns a bar does not name read as `0`.
 */
function bindBars(
  node: Node,
  bar: (index: number) => Record<string, number>,
): Node {
  const stream = (columns: readonly string[]) =>
    new DataStream(
      columnSchema(columns),
      from(
        Array.from({ length: 160 }, (_, i) => ({
          time: Date.UTC(2026, 0, 5) + i * 3_600_000,
          provisional: i === 159,
          ...Object.fromEntries(
            columns.map((name) => [name, bar(i)[name] ?? 0]),
          ),
        })),
      ),
    );
  const names = (schema: typeof node.module.inputs.schema) =>
    schema.fields.map((field) => field.name);
  return node.module.requests.reduce(
    (bound, request) =>
      bound.bind(stream(names(request.module.inputs.schema)), [request.name]),
    node.bind(stream(names(node.module.inputs.schema))),
  );
}

/** The numbers one output row carries: a plot's value, or a profile's row bounds and lengths. */
function outputNumbers(value: unknown): (number | null)[] {
  // A profile is written only on the rows the chart draws.
  if (value === null || value === undefined) return [];
  const profile = value as {
    rows?: { low: number; high: number; segments: { value: number }[] }[];
  };
  if (profile.rows)
    return profile.rows.flatMap((row) => [
      row.low,
      row.high,
      ...row.segments.map((segment) => segment.value),
    ]);
  return [(value as { series: number | null }).series];
}

const market = Schema.decodeUnknownSync(BarsSeries)({
  provider: "yfinance",
  listing: { symbol: "MSFT", currency: "USD" },
  resolution: "1h",
  session: "regular",
  adjustment: "split",
});

describe("indicator templates", () => {
  it("contains 71 originals and 30 curated studies without duplicate identities", () => {
    expect(indicatorCatalog).toHaveLength(101);
    expect(new Set(indicatorCatalog.map((entry) => entry.id)).size).toBe(101);
    expect(indicatorCatalog.filter((entry) => entry.discovery)).toHaveLength(
      30,
    );
  });
  it("provides discovery content and supported goals for every starter", () => {
    const representedGoals = new Set<string>();
    for (const entry of indicatorCatalog) {
      expect(entry.prompt.trim(), entry.id).not.toBe("");
      expect(entry.description.trim(), entry.id).not.toBe("");
      expect(entry.goals.length, entry.id).toBeGreaterThan(0);
      for (const goal of entry.goals) {
        expect(indicatorGoalKeys, entry.id).toContain(goal);
        representedGoals.add(goal);
      }
    }
    expect([...representedGoals].sort()).toEqual([...indicatorGoalKeys].sort());
  });
  // Curated visual/confirmation behavior is exercised in featured-studies.test.ts.
  for (const entry of indicatorCatalog.filter((entry) => !entry.discovery)) {
    it(entry.name, async () => {
      const source = await readFile(
        new URL(`./builtins/${entry.id}.tea`, import.meta.url),
        "utf8",
      );
      // Bound like TeaService binds a chart's script: with the market's facts
      // and the chart's timeframe, which request lines such as
      // request.security(syminfo.tickerid, ...) need.
      const compiled = tea`${source}`;
      const node = createNode(
        compiled.module.bind(
          {},
          marketContext(compiled.module.inputs, [market], market.resolution),
        ),
        pineBuiltinSupplier(),
      );
      const prices = (i: number): Record<string, number> => {
        const close = 100 + i * 0.1 + Math.sin(i / 4) * 3;
        return {
          close,
          open: close - 0.5,
          high: close + 2,
          low: close - 2,
          volume: 1000 + i,
          hl2: close,
          hlc3: close,
          ohlc4: close - 0.125,
        };
      };
      const rows = Array.from({ length: 160 }, (_, i) => prices(i));
      const run = bindBars(node, prices);
      const output: Datum[] = [];
      try {
        await new Promise<void>((resolve, reject) =>
          run.to({
            next: (row) => output.push(row),
            error: reject,
            complete: resolve,
          }),
        );
        expect(output).toHaveLength(rows.length);
        for (const field of node.module.outputs.schema.fields.filter((f) =>
          f.metadata.has("tea:write"),
        )) {
          const values = outputNumbers(output.at(-1)![field.name]);
          expect(values.length, `${entry.id}/${field.name}`).toBeGreaterThan(0);
          expect(
            values.every((value) => Number.isFinite(value)),
            `${entry.id}/${field.name}`,
          ).toBe(true);
        }
        const last = output.at(-1)!;
        if (entry.id === "sma") {
          const expected =
            rows
              .slice(-14)
              .reduce((total, row) => total + Number(row.close), 0) / 14;
          expect((last.value as { series: number }).series).toBeCloseTo(
            expected,
            8,
          );
        }
        if (entry.id === "volume")
          expect((last.histogram as { series: number }).series).toBe(1159);
        const flat = bindBars(node, () => ({}));
        try {
          await new Promise<void>((resolve, reject) =>
            flat.to({
              next: (row) => {
                for (const field of node.module.outputs.schema.fields.filter(
                  (field) => field.metadata.has("tea:write"),
                )) {
                  for (const value of outputNumbers(row[field.name]))
                    expect(
                      value === null ||
                        Number.isFinite(value) ||
                        Number.isNaN(value),
                      `${entry.id} must not emit infinity for flat prices/zero volume`,
                    ).toBe(true);
                }
              },
              error: reject,
              complete: resolve,
            }),
          );
        } finally {
          flat.dispose();
        }
      } finally {
        run.dispose();
        node.dispose();
      }
    });
  }
});

it.each([
  ["sma", { value: 593.5 }],
  ["ema", { value: 593.5 }],
  ["rsi", { value: 100 }],
  ["macd", { macd: 7, signal: 7, histogram: 0 }],
  [
    "bollinger-bands",
    {
      basis: 590.5,
      upper: 590.5 + 2 * Math.sqrt(33.25),
      lower: 590.5 - 2 * Math.sqrt(33.25),
    },
  ],
  ["volume", { histogram: 1000 }],
] as const)(
  "%s matches a closed-form linear-price reference",
  async (id, expected) => {
    const source = await readFile(
      new URL(`./builtins/${id}.tea`, import.meta.url),
      "utf8",
    );
    const node = tea`${source}`;
    const rows = Array.from({ length: 600 }, (_, index) => {
      const close = index + 1;
      const values: Record<string, number> = {
        close,
        open: close,
        high: close + 2,
        low: close - 2,
        volume: 1000,
        hl2: close,
        hlc3: close,
        ohlc4: close,
      };
      return Object.fromEntries(
        node.module.inputs.schema.fields.map((field) => [
          field.name,
          values[field.name],
        ]),
      );
    });
    const run = node.bind(
      new DataStream(node.module.inputs.schema, from(rows)),
    );
    let last: Datum | undefined;
    try {
      await new Promise<void>((resolve, reject) =>
        run.to({
          next: (row) => {
            last = row;
          },
          complete: resolve,
          error: reject,
        }),
      );
      for (const [output, value] of Object.entries(expected))
        expect((last![output] as { series: number }).series).toBeCloseTo(
          value,
          7,
        );
    } finally {
      run.dispose();
      node.dispose();
    }
  },
);
