// Purpose: Enforce validated Alert definitions at the Resource write boundary.
import { router } from "@openchart/server";
import { temporaryHome } from "@openchart/server/home.test-utils";
import { makeRuntime } from "@openchart/server/runtime";
import { Feed } from "@openchart/server/feed/service";
import * as Tea from "@openchart/server/tea";
import { alertRuleResource } from "@openchart/server/resources/alert-rule";
import { barsRuleConfig } from "@openchart/server/resources/alert-rule/alert-rule.test-utils";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const value = {
  name: "Validated rule",
  enabled: false,
  repeat: true,
  alertable: {
    kind: "tea" as const,
    source:
      'threshold = input.float(200)\nalertcondition("above", close > threshold)',
    config: barsRuleConfig(
      {
        provider: "yfinance",
        listing: { symbol: "AAPL", currency: "USD" },
        resolution: "1m",
        session: "regular",
        adjustment: "raw",
      },
      { threshold: 200 },
    ),
  },
};
let runtime: ReturnType<typeof makeRuntime>;
let caller: ReturnType<typeof router.createCaller>;
beforeEach(() => {
  runtime = makeRuntime({ home: temporaryHome(), databasePath: ":memory:" });
  caller = router.createCaller({ runtime });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.dispose();
});

test("generic create and patch cannot write alertable, while metadata patches preserve it", async () => {
  await expect(caller.resources.alert_rule.create(value)).rejects.toMatchObject(
    { code: "BAD_REQUEST" },
  );
  await expect(
    caller.resources.alert_rule.create({ name: "Missing definition" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect((await caller.resources.alert_rule.list()).items).toEqual([]);
  const created = await caller.resources.alert_rule.save({ value });
  for (const operation of [
    { op: "replace" as const, path: "/alertable/source", value: "invalid Tea" },
    {
      op: "add" as const,
      path: "/alertable",
      value: { ...value.alertable, source: "invalid Tea" },
    },
    {
      op: "add" as const,
      path: "",
      value: {
        ...value,
        alertable: { ...value.alertable, source: "invalid Tea" },
      },
    },
  ]) {
    await expect(
      caller.resources.alert_rule.patch({
        id: created.id,
        expectedRevision: created.revision,
        operations: [operation],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.resources.alert_rule.get({ id: created.id })).toEqual(
      created,
    );
  }
  const renamed = await caller.resources.alert_rule.patch({
    id: created.id,
    expectedRevision: 1,
    operations: [{ op: "replace", path: "/name", value: "Renamed" }],
  });
  expect(renamed).toMatchObject({
    name: "Renamed",
    revision: 2,
    alertable: value.alertable,
  });
});

test.each([true, false])(
  "rejects invalid writes with enabled=%s, releases compilation, and never opens Feed",
  async (enabled) => {
    const tea = await runtime.runPromise(Tea.Service);
    const feed = await runtime.runPromise(Feed);
    const get = vi.spyOn(feed, "get");
    const dispose = vi.spyOn(tea, "dispose");
    const created = await caller.resources.alert_rule.save({
      value: { ...value, enabled },
    });
    for (const alertable of [
      { ...value.alertable, source: "invalid draft" },
      { ...value.alertable, source: 'emit "price" close' },
      {
        ...value.alertable,
        config: { ...value.alertable.config, parameters: {} },
      },
    ]) {
      const invalid = { value: { ...value, enabled, alertable } };
      await expect(
        caller.resources.alert_rule.save(invalid),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller.resources.alert_rule.save({
          ...invalid,
          rule: { id: created.id, expectedRevision: 1 },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await caller.resources.alert_rule.list()).items).toEqual([
        created,
      ]);
    }
    // One valid write plus two compiled failures for each create/update pair.
    expect(dispose).toHaveBeenCalledTimes(5);
    expect(get).not.toHaveBeenCalled();
    expect((await caller.resources.trigger.list()).items).toEqual([]);
  },
);

test("a config error names only the form that rejects it", async () => {
  const bars = value.alertable.config.inputs.bars!;
  const vwap = { ...bars.schema.fields[0]!, name: "vwap" };
  const withConfig = <Config>(config: Config) => ({
    value: { ...value, alertable: { ...value.alertable, config } },
  });
  // Decoding picks the form by indicatorId, so the Bars error comes alone:
  // the message ends at its path, with no line from the other form.
  await expect(
    caller.resources.alert_rule.save(
      withConfig({
        ...value.alertable.config,
        inputs: {
          bars: {
            ...bars,
            schema: { ...bars.schema, fields: [...bars.schema.fields, vwap] },
          },
        },
      }),
    ),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: expect.stringMatching(
      /vwap[^\n]*\n {2}at \["inputs"\]\["bars"\]\["schema"\]$/,
    ),
  });
  // The agent's input is checked against both forms; each names itself.
  expect(() =>
    Schema.decodeUnknownSync(
      alertRuleResource.transitionDefinitions.save.input,
    )(withConfig({ ...value.alertable.config, extra: true })),
  ).toThrow(
    /A NodeConfig has only inputs, map, parameters and requests\n.*\["extra"\]\nA config that follows an Indicator has only indicatorId, parameters and requests\n.*\["inputs"\]/,
  );
});

test("updates with revision checks and preserves the revision for identical definitions", async () => {
  const created = await caller.resources.alert_rule.save({ value });
  const rule = { id: created.id, expectedRevision: created.revision };
  expect(await caller.resources.alert_rule.save({ rule, value })).toEqual(
    created,
  );
  // Another spelling of the same Arrow schema stores the same canonical JSON.
  const bars = value.alertable.config.inputs.bars!;
  const respelled = {
    ...value,
    alertable: {
      ...value.alertable,
      config: {
        ...value.alertable.config,
        inputs: {
          bars: {
            ...bars,
            schema: {
              fields: bars.schema.fields.map((field) => ({
                ...field,
                metadata: [],
              })),
              metadata: [],
            },
          },
        },
      },
    },
  };
  expect(
    await caller.resources.alert_rule.save({ rule, value: respelled }),
  ).toEqual(created);
  const changed = {
    ...value,
    alertable: {
      ...value.alertable,
      config: { ...value.alertable.config, parameters: { threshold: 300 } },
    },
  };
  const updated = await caller.resources.alert_rule.save({
    rule,
    value: changed,
  });
  expect(updated).toMatchObject({ ...changed, id: created.id, revision: 2 });
  await expect(
    caller.resources.alert_rule.save({ rule, value }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await caller.resources.alert_rule.get({ id: created.id })).toEqual(
    updated,
  );
});
