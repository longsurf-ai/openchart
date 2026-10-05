// Purpose: Read what a rule that follows an Indicator follows now, and expand it into the nodes one Tea call runs.

import { barsSeries, type BarsSeries } from "@openchart/feed";
import { indicatorPrefix } from "@openchart/server/alert/starters";
import {
  ResourceNotFound,
  Transactor,
  Transition,
} from "@openchart/server/lib/resource";
import type { AlertRuleRunConfig } from "@openchart/server/resources/alert-rule";
import {
  ChartId,
  chartResource,
  getMainSource,
} from "@openchart/server/resources/chart";
import {
  indicatorResource,
  type Indicator,
  type IndicatorId,
} from "@openchart/server/resources/indicator";
import * as Tea from "@openchart/server/tea";
import { Effect } from "effect";

/**
 * Reads the Indicator and the market its chart cell shows now, in one
 * transaction. Null when the Indicator, its chart or its cell is gone. Run it
 * through Transactor, or apply it inside a caller's transaction.
 *
 * @example const follow = yield* Transactor.run(followIndicator(indicatorId));
 */
export function followIndicator(id: IndicatorId) {
  return Transition.from((tx) =>
    Effect.gen(function* () {
      const indicator = yield* indicatorResource.transitions
        .get(id)
        .apply(tx, undefined)
        .pipe(
          Effect.catchTag("Resource.NotFound", () => Effect.succeed(undefined)),
        );
      if (!indicator) return null;
      const chart = yield* chartResource.transitions
        .get(ChartId.make(indicator.chartId))
        .apply(tx, undefined)
        .pipe(
          Effect.catchTag("Resource.NotFound", () => Effect.succeed(undefined)),
        );
      const cell = chart?.cells.find((cell) => cell.id === indicator.cellId);
      return cell
        ? { indicator, market: barsSeries(getMainSource(cell), cell) }
        : null;
    }),
  );
}

/**
 * The `invalid_request` Tea error for an Indicator a rule can't read.
 *
 * @example Effect.try({ try: () => Tea.indicatorSeriesOutputs(compiled), catch: invalidIndicator });
 */
export const invalidIndicator = (cause: unknown) =>
  new Tea.Error(
    {
      code: "invalid_request",
      message: cause instanceof Error ? cause.message : "Invalid Indicator",
    },
    { cause },
  );

/**
 * What one observe or validate call runs for a rule that follows an Indicator,
 * in Tea's own terms. The root keeps the rule's parameters and requests, and
 * reads the cell's market as `bars` and, through the NodeRef input
 * `indicator`, each numeric or plot output `<name>` as `indicator.<name>`
 * (horizontal lines carry no number per bar). The Indicator runs as
 * `nodes.indicator` with its overrides on the same Bars input, so the market
 * opens once. Pure: the caller compiles and disposes `compiled`, as
 * {@link ruleRequest} does. Fails with {@link invalidIndicator} when an
 * override names no parameter or an output can't be read.
 *
 * @example const { config, nodes } = yield* followIndicatorNodes(rule, follow, compiled);
 */
export function followIndicatorNodes(
  { parameters, requests }: Pick<Tea.NodeConfig, "parameters" | "requests">,
  {
    indicator,
    market,
  }: { readonly indicator: Indicator; readonly market: BarsSeries },
  compiled: Pick<Tea.CompileResponse, "id" | "definition" | "declaration">,
) {
  return Effect.try({
    try: (): {
      readonly config: Tea.NodeConfig;
      readonly nodes: Tea.ObserveRequest["nodes"];
    } => {
      const bars = Tea.barsInputs(market);
      const config: Tea.NodeConfig = {
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
          ...Object.fromEntries(
            Tea.indicatorSeriesOutputs(compiled).map(({ name, path }) => [
              `${indicatorPrefix}${name}`,
              ["indicator", path] as const,
            ]),
          ),
        },
        parameters,
        requests,
      };
      return {
        config,
        nodes: {
          indicator: {
            id: compiled.id,
            ...bars,
            parameters: Tea.teaParameters(
              compiled.definition,
              indicator.parameterOverrides,
            ),
            requests: {},
          },
        },
      };
    },
    catch: invalidIndicator,
  });
}

/**
 * Compiles an Indicator's snapshot. The caller's Scope disposes it. Fails like
 * {@link Tea.ITeaService.compile}.
 *
 * @example const compiled = yield* compileIndicator(follow.indicator);
 */
export const compileIndicator = Effect.fn("compileIndicator")(function* (
  indicator: Indicator,
) {
  const tea = yield* Tea.Service;
  return yield* Effect.acquireRelease(
    tea.compile({ entry: indicator.source.path, sources: indicator.snapshot }),
    (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
  );
});

/**
 * A stored rule config as Tea runs it: a NodeConfig plus the other compiled
 * scripts it reads (`nodes`), everything an observe or validate call needs
 * apart from the script's own `id` and the time window. A config that follows an Indicator also
 * returns what it follows now; its Indicator is compiled in the caller's
 * Scope, which disposes it. Fails with ResourceNotFound when that Indicator,
 * its chart or its cell is gone (Rule save reports it, the Alert runner
 * disables the rule), and like {@link followIndicatorNodes}.
 *
 * @example
 * const { config, nodes, follow } = yield* ruleRequest(yield* decodeAlertRuleRunConfig(stored));
 * yield* tea.validate({ id: node.id, ...config, nodes });
 */
export const ruleRequest = Effect.fn("ruleRequest")(function* (
  config:
    | Tea.NodeConfig
    | Extract<AlertRuleRunConfig, { readonly indicatorId: unknown }>,
) {
  if (!("indicatorId" in config))
    return { config, nodes: {}, follow: undefined };
  const follow = yield* Transactor.run(followIndicator(config.indicatorId));
  if (!follow)
    return yield* new ResourceNotFound({
      resource: "indicator",
      id: config.indicatorId,
    });
  const compiled = yield* compileIndicator(follow.indicator);
  return {
    ...(yield* followIndicatorNodes(config, follow, compiled)),
    follow,
  };
});
