// Purpose: Build stored Alert Rule configs in tests, in the canonical JSON that save stores.
import { BarsSeries } from "@openchart/feed";
import * as Tea from "@openchart/tea";
import { Schema } from "effect";

import { AlertRuleRunConfig } from "./entity";

/**
 * The stored config of a rule that reads `series` as its Bars input `bars`,
 * with every Bars column mapped. Request children are decoded NodeConfigs.
 * @example const config = barsRuleConfig(series, { threshold: 200 });
 */
export function barsRuleConfig(
  series: typeof BarsSeries.Encoded,
  parameters: Tea.NodeParameters = {},
  requests: Readonly<Record<string, Tea.NodeConfig>> = {},
) {
  const market = Schema.decodeUnknownSync(BarsSeries)(series);
  return Schema.encodeSync(AlertRuleRunConfig.members[0])({
    inputs: { bars: { _tag: "Bars", ...market, schema: Tea.barsSchema } },
    map: Tea.barsInputs(market).map,
    parameters,
    requests,
  });
}
