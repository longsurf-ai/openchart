// Purpose: Owns persisted Alertable definitions and the Alert Rule Resource table.

import { SessionType } from "@openchart/market";
import { inArray } from "drizzle-orm";
import { BarsSeries } from "@openchart/feed/bars";
import {
  resourceEnvelopeChecks,
  resourceEnvelopeColumns,
} from "@openchart/server/lib/resource/envelope-columns";
import { DrawingId } from "@openchart/server/resources/drawing/schema";
import { IndicatorId } from "@openchart/server/resources/indicator/schema";
import * as Tea from "@openchart/tea";
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Schema } from "effect";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;

// A stored rule reads only Bars. A NodeRef names another node of one observe
// call, which storage never has, and Samples never update.
const readsOnlyBars = (config: Tea.NodeConfigEncoded): boolean =>
  Object.values(config.inputs).every((input) => input._tag === "Bars") &&
  Object.values(config.requests).every(readsOnlyBars);

// Each request child is one leaf: the JSON form of the shared NodeConfig,
// whose inputs are Bars at every depth. `@openchart/tea` owns the recursion,
// so this file keeps no second recursive schema. JSON Schema shows a child as
// a plain object.
const isNodeConfigJson = Schema.is(Schema.toEncoded(Tea.NodeConfig));
const ChildConfig = Schema.declare(
  (value): value is Tea.NodeConfigEncoded =>
    isNodeConfigJson(value) && readsOnlyBars(value),
  { expected: "a complete child NodeConfig whose inputs are all Bars" },
);

// The JSON form of a NodeConfig whose inputs are all Bars. A config that fails
// both forms gets one error from each, so each form's excess-key message names
// that form.
const BarsNodeConfig = Schema.Struct({
  inputs: Schema.Record(Schema.String, Schema.toEncoded(Tea.Bars)),
  map: Tea.InputMap,
  parameters: Tea.NodeParameters,
  requests: Schema.Record(Schema.String, ChildConfig),
}).annotate({
  ...strict,
  messageUnexpectedKey:
    "A NodeConfig has only inputs, map, parameters and requests",
});

/**
 * A rule that follows an Indicator by value, with no FK. It runs on the market
 * of the Indicator's chart cell and reads the Indicator's numeric and plot
 * outputs as `indicator.<output>` columns; its inputs and map are built when it
 * runs. A missing Indicator disables the rule.
 */
export const FollowIndicatorConfig = Schema.Struct({
  indicatorId: IndicatorId,
  parameters: Tea.NodeParameters,
  requests: Schema.Record(Schema.String, ChildConfig),
}).annotate({
  ...strict,
  messageUnexpectedKey:
    "A config that follows an Indicator has only indicatorId, parameters and requests",
});
/** A stored rule config that follows an Indicator. */
export type FollowIndicatorConfig = typeof FollowIndicatorConfig.Type;

/**
 * Stored rule configuration, as JSON: an `@openchart/tea` NodeConfig whose
 * inputs are all Bars, or a rule that follows an Indicator. Decode it with
 * `decodeAlertRuleRunConfig` (entity.ts) before running it.
 */
export const AlertRuleConfig = Schema.Union([
  BarsNodeConfig,
  FollowIndicatorConfig,
]);
/** Stored rule configuration. */
export type AlertRuleConfig = typeof AlertRuleConfig.Type;

/** Drawing-owned geometry plus the rule's condition and market-data settings. */
export const DrawingAlertDefinition = Schema.Struct({
  kind: Schema.Literal("drawing"),
  drawingId: DrawingId,
  operator: Schema.Literals([
    "crossing",
    "crossing_up",
    "crossing_down",
    "entering_channel",
    "exiting_channel",
    "inside_channel",
    "outside_channel",
    "touching",
  ]),
  inputs: BarsSeries,
}).annotate(strict);
/** Persisted link; deleted drawings leave rule and event history intact. */
export type DrawingAlertDefinition = typeof DrawingAlertDefinition.Type;

/** Stored construction data for an Alertable; runtime objects never enter Resources. */
export const AlertableDefinition = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("tea"),
    source: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(65536),
    ),
    config: AlertRuleConfig,
  }).annotate(strict),
  DrawingAlertDefinition,
]);
/** Complete serializable definition observed by the Alert runner. */
export type AlertableDefinition = typeof AlertableDefinition.Type;

/** User-authored alert sources; `enabled` alone decides whether a rule is observed. */
export const alertRules = sqliteTable(
  "alert_rule",
  {
    ...resourceEnvelopeColumns(),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    // A rule that does not repeat is disabled by the transaction recording its first fire.
    repeat: integer("repeat", { mode: "boolean" }).notNull().default(false),
    alertable: text("alertable_json", { mode: "json" })
      .$type<AlertableDefinition>()
      .notNull(),
  },
  (table) => [
    ...resourceEnvelopeChecks("alert_rule", table),
    check(
      "chk_alert_rules_name",
      sql`length(trim(${table.name})) BETWEEN 1 AND 160`,
    ),
    check(
      "chk_alert_rules_alertable",
      sql`json_valid(${table.alertable}) AND json_type(${table.alertable}) IS 'object'
        AND ((json_extract(${table.alertable}, '$.kind') IS 'tea'
        AND json_type(${table.alertable}, '$.source') IS 'text'
        AND length(json_extract(${table.alertable}, '$.source')) BETWEEN 1 AND 65536
        AND json_type(${table.alertable}, '$.config') IS 'object')
        OR (json_extract(${table.alertable}, '$.kind') IS 'drawing'
        AND json_type(${table.alertable}, '$.drawingId') IS 'text'
        AND substr(json_extract(${table.alertable}, '$.drawingId'), 1, 4) = 'drw_'
        AND json_type(${table.alertable}, '$.operator') IS 'text'
        AND json_extract(${table.alertable}, '$.operator') IN ('crossing', 'crossing_up', 'crossing_down', 'entering_channel', 'exiting_channel', 'inside_channel', 'outside_channel', 'touching')
        AND json_type(${table.alertable}, '$.inputs') IS 'object'
        AND json_type(${table.alertable}, '$.inputs.provider') IS 'text'
        AND length(json_extract(${table.alertable}, '$.inputs.provider')) > 0
        AND json_type(${table.alertable}, '$.inputs.listing') IS 'object'
        AND json_type(${table.alertable}, '$.inputs.listing.symbol') IS 'text'
        AND json_type(${table.alertable}, '$.inputs.listing.currency') IS 'text'
        AND json_type(${table.alertable}, '$.inputs.resolution') IS 'text'
        AND json_extract(${table.alertable}, '$.inputs.resolution') IN ('1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1W', '1M')
        AND json_type(${table.alertable}, '$.inputs.session') IS 'text'
        AND ${inArray(sql`json_extract(${table.alertable}, '$.inputs.session')`, SessionType.literals).inlineParams()}
        AND json_type(${table.alertable}, '$.inputs.adjustment') IS 'text'
        AND json_extract(${table.alertable}, '$.inputs.adjustment') IN ('raw', 'split', 'split_dividend')))`,
    ),
  ],
);
