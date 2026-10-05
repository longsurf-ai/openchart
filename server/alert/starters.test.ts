// Purpose: Verifies every built-in starter compiles to one alert column with the two shared inputs, and is served by resources.alert_rule.starters.

import { router } from "@openchart/server";
import { Feed } from "@openchart/server/feed/service";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import * as Tea from "@openchart/server/tea/tea";
import { Workspaces } from "@openchart/server/workspace/workspace";

import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, test } from "vitest";
import { Field, Float64, Schema as ArrowSchema } from "apache-arrow";
import { of } from "rxjs";
import { DataStream, tea, type Datum } from "tea";

import {
  alertStarterOperators,
  alertStarterParameters,
  alertStarters,
  alertStarterWarmup,
  validateAlertStarterParameters,
} from "./starters";

test.each(alertStarters)(
  "the $id starter compiles to one alert column and the shared inputs",
  async (starter) => {
    // Inline compilation reads neither a Workspace nor the Feed.
    const runtime = ManagedRuntime.make(
      Tea.layer.pipe(
        Layer.provide(
          Layer.merge(Layer.mock(Workspaces, {}), Layer.mock(Feed, {})),
        ),
      ),
    );
    try {
      const { definition } = await runtime.runPromise(
        Effect.flatMap(Tea.Service, (tea) =>
          tea.compile({
            entry: "<inline>",
            sources: { "<inline>": starter.source },
          }),
        ),
      );
      expect(Tea.teaAlertOutputs(definition.outputs)).toEqual(["alert"]);
      expect(definition.parameters.map((parameter) => parameter.name)).toEqual([
        alertStarterParameters.operator,
        alertStarterParameters.threshold,
        alertStarterParameters.lower,
        alertStarterParameters.upper,
        alertStarterParameters.amount,
        alertStarterParameters.bars,
      ]);
      expect(definition.parameters[0]!.constraints).toEqual({
        kind: "options",
        options: alertStarterOperators.map((operator) => operator.value),
      });
      expect(definition.requests).toEqual({});
    } finally {
      await runtime.dispose();
    }
  },
);

test("resources.alert_rule.starters serves the catalog with price and volume", async () => {
  const runtime = makeRuntime({
    home: temporaryHome(),
    databasePath: ":memory:",
  });
  try {
    const starters = await router
      .createCaller({ runtime })
      .resources.alert_rule.starters();
    expect(starters).toEqual(alertStarters);
    expect(starters.map((starter) => starter.id)).toEqual(
      expect.arrayContaining(["price", "volume"]),
    );
  } finally {
    await runtime.dispose();
  }
});

const defaults = {
  op: "greater_than",
  threshold: 10,
  lower: 8,
  upper: 12,
  amount: 2,
  bars: 2,
};
const samples = [
  5,
  10,
  10,
  15,
  5,
  15,
  8,
  12,
  13,
  7,
  0,
  2,
  0,
  -2,
  NaN,
  ...Array.from({ length: 20 }, (_, index) =>
    index % 2 === 0 ? index + 10 : index + 4,
  ),
  30,
  10,
  100,
];
const schema = new ArrowSchema([
  new Field("close", new Float64(), false),
  new Field("volume", new Float64(), false),
]);

// Independent sampled-point policy. NaN never satisfies a condition. Endpoints
// belong to crossing/transition detection; inside/outside remain strict.
function expected(
  op: string,
  current: number,
  previous: number,
  base: number,
): boolean {
  if (!Number.isFinite(current)) return false;
  const crossUp = previous < 10 && current >= 10;
  const crossDown = previous > 10 && current <= 10;
  switch (op) {
    case "crossing":
      return crossUp || crossDown;
    case "crossing_up":
      return crossUp;
    case "crossing_down":
      return crossDown;
    case "greater_than":
      return current > 10;
    case "less_than":
      return current < 10;
    case "inside_channel":
      return current > 8 && current < 12;
    case "outside_channel":
      return current < 8 || current > 12;
    case "entering_channel":
      return (previous < 8 || previous > 12) && current >= 8 && current <= 12;
    case "exiting_channel":
      return previous >= 8 && previous <= 12 && (current < 8 || current > 12);
    case "moving_up":
      return current - base >= 2;
    case "moving_down":
      return current - base <= -2;
    case "moving_up_percent":
      return base !== 0 && (100 * (current - base)) / base >= 2;
    case "moving_down_percent":
      return base !== 0 && (100 * (current - base)) / base <= -2;
    default:
      throw new Error(op);
  }
}

test.each(alertStarters)(
  "$id implements all thirteen sampled-point conditions",
  (starter) => {
    for (const operator of alertStarterOperators) {
      const template = tea`${starter.source}`;
      const node = template
        .bind({ ...defaults, op: operator.value })
        .bind(
          new DataStream(
            schema,
            of(...samples.map((close) => ({ close, volume: close }))),
          ),
        );
      const rows: Datum[] = [];
      const errors: unknown[] = [];
      try {
        node.to({
          next: (row) => rows.push(row),
          error: (error) => errors.push(error),
        });
        expect(errors).toEqual([]);
        expect(rows).toHaveLength(samples.length);
        const values = rows.map((row) => Number(row.value));
        expect(
          rows.map((row) => (row.alert as unknown[]).length > 0),
          operator.value,
        ).toEqual(
          values.map((value, index) =>
            expected(
              operator.value,
              value,
              values[index - 1] ?? NaN,
              values[index - 2] ?? NaN,
            ),
          ),
        );
      } finally {
        node.dispose();
        template.dispose();
      }
    }
  },
);

test("starter constraints and warmup include the requested movement history", () => {
  const price = alertStarters[0]!;
  expect(
    validateAlertStarterParameters(price.source, {
      ...defaults,
      op: "inside_channel",
      lower: 12,
    }),
  ).toMatch(/Lower/);
  expect(
    validateAlertStarterParameters(price.source, {
      ...defaults,
      op: "moving_up",
      amount: 0,
    }),
  ).toMatch(/positive/);
  expect(
    validateAlertStarterParameters(price.source, {
      ...defaults,
      op: "moving_up",
      bars: 1.5,
    }),
  ).toMatch(/integer/);
  expect(validateAlertStarterParameters(price.source, defaults)).toBeNull();
  expect(
    alertStarterWarmup(price.source, { ...defaults, bars: 1500 }),
  ).toBeGreaterThanOrEqual(1500);
  expect(
    alertStarterWarmup(alertStarters[2]!.source, { ...defaults, bars: 1500 }),
  ).toBeGreaterThanOrEqual(1514);
  expect(alertStarterWarmup("custom script", defaults)).toBe(0);
});
