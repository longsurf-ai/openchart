import { describe, expect, test } from "vitest";
import { Field, Float64, Schema as ArrowSchema } from "apache-arrow";
import { of } from "rxjs";
import { DataStream, tea, type Datum } from "tea";
import { Schema } from "effect";
import {
  buildConditions,
  ConditionQuery,
  readConditions,
  conditionWarmup,
  type ConditionGroup,
} from "./conditions";
import { alertStarters } from "./starters";

const values = { threshold: 9, lower: 8, upper: 12, amount: 1, bars: 1 };
const query: ConditionGroup = {
  combinator: "and",
  rules: [
    { field: "price", operator: "greater_than", value: values },
    {
      combinator: "or",
      rules: [
        {
          field: "volume",
          operator: "greater_than",
          value: { ...values, threshold: 75 },
        },
        {
          field: "price",
          operator: "crossing_up",
          value: { ...values, threshold: 10 },
        },
      ],
    },
  ],
};

describe("condition programs", () => {
  test("round trips generated trees and preserves AND/OR and arrival crossing semantics in real Tea", () => {
    const generated = buildConditions(query);
    expect(readConditions(generated.source, generated.parameters)).toEqual(
      query,
    );
    const template = tea`${generated.source}`;
    const node = template
      .bind(generated.parameters)
      .bind(
        new DataStream(
          new ArrowSchema([
            new Field("close", new Float64()),
            new Field("volume", new Float64()),
          ]),
          of(
            { close: 5, volume: 10 },
            { close: 10, volume: 50 },
            { close: 15, volume: 100 },
          ),
        ),
      );
    const rows: Datum[] = [];
    try {
      node.to({
        next: (row) => rows.push(row),
        error: (error) => {
          throw error;
        },
      });
      expect(rows.map((row) => (row.alert as unknown[]).length > 0)).toEqual([
        false,
        true,
        true,
      ]);
      expect(rows[2]).toMatchObject({
        value: 15,
        price_0: 15,
        volume_1: 100,
        price_2: 15,
      });
    } finally {
      node.dispose();
      template.dispose();
    }
  });
  test("reads an Indicator output as a named series and round trips it", () => {
    const indicatorQuery: ConditionGroup = {
      combinator: "and",
      rules: [
        {
          field: "indicator.rsi",
          operator: "crossing_up",
          value: { ...values, threshold: 70 },
        },
        { field: "price", operator: "greater_than", value: values },
      ],
    };
    const generated = buildConditions(indicatorQuery);
    expect(generated.source).toContain(
      'c0_value = input.series("indicator.rsi")',
    );
    expect(readConditions(generated.source, generated.parameters)).toEqual(
      indicatorQuery,
    );
    const template = tea`${generated.source}`;
    const node = template
      .bind(generated.parameters)
      .bind(
        new DataStream(
          new ArrowSchema([
            new Field("close", new Float64()),
            new Field("indicator.rsi", new Float64()),
          ]),
          of(
            { close: 10, "indicator.rsi": 60 },
            { close: 10, "indicator.rsi": 72 },
            { close: 5, "indicator.rsi": 75 },
          ),
        ),
      );
    const rows: Datum[] = [];
    try {
      node.to({ next: (row) => rows.push(row) });
      expect(rows.map((row) => (row.alert as unknown[]).length > 0)).toEqual([
        false,
        true,
        false,
      ]);
      expect(rows[1]).toMatchObject({ "indicator.rsi_0": 72, price_1: 10 });
    } finally {
      node.dispose();
      template.dispose();
    }
    for (const field of ['indicator.a"b', "indicator.", "indicator.a\\b"])
      expect(() =>
        Schema.decodeUnknownSync(ConditionQuery)({
          combinator: "and",
          rules: [{ field, operator: "greater_than", value: values }],
        }),
      ).toThrow();
  });
  test("modified code, external statements, and inconsistent parameter shapes are never silently projected", () => {
    const generated = buildConditions(query);
    expect(
      readConditions(
        generated.source.replace("close", "open"),
        generated.parameters,
      ),
    ).toBeNull();
    expect(
      readConditions(
        `${generated.source}\nemit "extra" close`,
        generated.parameters,
      ),
    ).toBeNull();
    expect(
      readConditions(generated.source, {
        ...generated.parameters,
        c0_threshold: "",
      }),
    ).toBeNull();
    expect(() =>
      Schema.decodeUnknownSync(ConditionQuery)({ ...query, not: true }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ConditionQuery)({
        combinator: "and",
        rules: [],
      }),
    ).toThrow();
    expect(() =>
      buildConditions({
        combinator: "and",
        rules: [
          {
            field: "price",
            operator: "inside_channel",
            value: { ...values, lower: 20 },
          },
        ],
      }),
    ).toThrow(/Lower/);
  });
  test("recognizes legacy sources without changing their strict crossing and retains long windows", () => {
    for (const starter of alertStarters) {
      expect(
        conditionWarmup(starter.source, { op: "greater_than", threshold: 10 }),
      ).toBe(0);
      expect(
        conditionWarmup(starter.legacySources[0]!, {
          op: "crosses",
          threshold: 10,
        }),
      ).toBe(0);
      const legacy = readConditions(starter.legacySources[0]!, {
        op: "crosses",
        threshold: 10,
      });
      expect(legacy).not.toBeNull();
      const generated = buildConditions(legacy!);
      expect(generated.source).toContain("ta.cross(");
      expect(readConditions(generated.source, generated.parameters)).toEqual(
        legacy,
      );
    }
    expect(
      buildConditions({
        combinator: "and",
        rules: [
          {
            field: "rsi",
            operator: "moving_up",
            value: { ...values, bars: 1500 },
          },
        ],
      }).warmupBars,
    ).toBe(1515);
  });
});
