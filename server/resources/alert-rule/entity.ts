// Purpose: Derives the Alert Rule Resource entity from its table and stored alert definition schema.

import { defineId } from "@openchart/identifier";
import { envelopeFields } from "@openchart/server/lib/resource/envelope";
import { serverManaged } from "@openchart/server/lib/resource/annotation";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import { Effect, Schema } from "effect";

import { IndicatorId } from "@openchart/server/resources/indicator/schema";
import * as Tea from "@openchart/tea";

import {
  AlertableDefinition,
  type AlertRuleConfig,
  alertRules,
} from "./schema";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;

/** Branded Alert Rule identifier with the `alr_` prefix. */
export const AlertRuleId = defineId("alr", "AlertRule.ID");

/** Identifier of an Alert Rule Resource. */
export type AlertRuleId = typeof AlertRuleId.Type;

const ruleColumns = createSelectSchema(alertRules, {
  name: (schema) =>
    schema.check(
      Schema.makeFilter(
        (name) => {
          const length = name.trim().length;
          return length >= 1 && length <= 160;
        },
        {
          message:
            "Alert rule name must contain 1 to 160 characters after trimming",
        },
      ),
    ),
  alertable: AlertableDefinition,
});

function withColumnDefault<S extends Schema.Codec<unknown>>(
  schema: S,
  column: AnySQLiteColumn,
) {
  return schema.pipe(
    Schema.withDecodingDefaultType<S>(
      Effect.succeed(Schema.decodeUnknownSync(schema)(column.default)),
    ),
  );
}

/**
 * Complete Alert Rule with its independent Resource envelope. The save transition
 * owns `alertable`: Tea source/configuration or a drawing
 * reference with its condition and market settings. `enabled` alone decides
 * whether the rule is observed; `repeat = false` means the first recorded fire disables it.
 * Fired events are addressed separately and never embedded here.
 */
export const AlertRuleEntity = Schema.Struct({
  ...envelopeFields(AlertRuleId),
  name: ruleColumns.fields.name,
  enabled: withColumnDefault(ruleColumns.fields.enabled, alertRules.enabled),
  repeat: withColumnDefault(ruleColumns.fields.repeat, alertRules.repeat),
  alertable: serverManaged(ruleColumns.fields.alertable),
});

/** Complete runtime shape of an Alert Rule Resource. */
export type AlertRuleEntity = typeof AlertRuleEntity.Type;

const BarsRunConfig = Schema.Struct({
  inputs: Schema.Record(Schema.String, Tea.Bars),
  map: Tea.InputMap,
  parameters: Tea.NodeParameters,
  requests: Schema.Record(Schema.String, Tea.NodeConfig),
}).annotate(strict);

const FollowRunConfig = Schema.Struct({
  // The stored form already holds the decoded id.
  indicatorId: Schema.toType(IndicatorId),
  parameters: Tea.NodeParameters,
  requests: Schema.Record(Schema.String, Tea.NodeConfig),
}).annotate(strict);

/**
 * A stored {@link AlertRuleConfig} decoded for running: Arrow JSON becomes
 * Arrow schemas that {@link Tea.Bars} checks. Encoding writes back canonical
 * JSON, so equal configs store equal JSON.
 *
 * @example const json = Schema.encodeSync(AlertRuleRunConfig)(config);
 */
export const AlertRuleRunConfig = Schema.Union([
  BarsRunConfig,
  FollowRunConfig,
]);
/** A stored rule configuration, decoded for running. */
export type AlertRuleRunConfig = typeof AlertRuleRunConfig.Type;

/**
 * Decodes a stored {@link AlertRuleConfig} for running with the one form
 * `indicatorId` picks, so an error names only that form's problem. Fails with
 * an `invalid_request` Tea error.
 *
 * @example const config = yield* decodeAlertRuleRunConfig(rule.alertable.config);
 */
export const decodeAlertRuleRunConfig = Effect.fn("decodeAlertRuleRunConfig")(
  function* (stored: AlertRuleConfig) {
    return "indicatorId" in stored
      ? yield* Schema.decodeEffect(FollowRunConfig)(stored)
      : yield* Schema.decodeEffect(BarsRunConfig)(stored);
  },
  Effect.mapError(
    (cause) =>
      new Tea.Error(
        { code: "invalid_request", message: cause.message },
        { cause },
      ),
  ),
);
