// Purpose: Expose existing cross-Resource operations under resources.macro.

import {
  STRICT_PARSE_OPTIONS,
  Transactor,
} from "@openchart/server/lib/resource";
import { trpc } from "@openchart/server/lib/trpc";
import {
  createChartWidget,
  CreateChartWidgetInput,
} from "@openchart/server/resources/macros/create-chart-widget";
import { createDashboardWithChart } from "@openchart/server/resources/macros/create-dashboard-with-chart";
import {
  addIndicator,
  AddIndicatorInput,
} from "@openchart/server/resources/macros/add-indicator";
import {
  removeIndicator,
  RemoveIndicatorInput,
} from "@openchart/server/resources/macros/remove-indicator";
import { Effect, Schema } from "effect";

import { AlertEventId } from "@openchart/server/resources/alert-event";
import { IndicatorId } from "@openchart/server/resources/indicator";
import {
  compileIndicator,
  followIndicator,
  invalidIndicator,
} from "@openchart/server/resources/macros/follow-indicator";
import {
  SaveAlertRuleInput,
  saveAlertRule,
} from "@openchart/server/resources/macros/save-alert-rule";
import * as Tea from "@openchart/server/tea";
import { feedExecutions } from "@openchart/server/trigger/post-context";

/** Cross-Resource queries and mutations retain their owning operation's execution contract. */
export const macroRouter = trpc.router({
  createDashboardWithChart: trpc.procedure.mutation(({ ctx }) =>
    ctx.runtime.runPromise(Transactor.run(createDashboardWithChart())),
  ),
  createChartWidget: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(CreateChartWidgetInput, {
        parseOptions: STRICT_PARSE_OPTIONS,
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.runtime.runPromise(Transactor.run(createChartWidget(input))),
    ),
  addIndicator: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(AddIndicatorInput, {
        parseOptions: STRICT_PARSE_OPTIONS,
      }),
    )
    .mutation(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(Transactor.run(addIndicator(input)), { signal }),
    ),
  removeIndicator: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(RemoveIndicatorInput, {
        parseOptions: STRICT_PARSE_OPTIONS,
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.runtime.runPromise(Transactor.run(removeIndicator(input))),
    ),
  saveAlertRule: trpc.procedure
    .input(Schema.toStandardSchemaV1(SaveAlertRuleInput))
    .mutation(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(Transactor.run(saveAlertRule(input)), { signal }),
    ),
  /** What a rule that follows this Indicator follows now, for the editor; null when it is gone. */
  alertIndicator: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(Schema.Struct({ indicatorId: IndicatorId }), {
        parseOptions: STRICT_PARSE_OPTIONS,
      }),
    )
    .query(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const follow = yield* Transactor.run(
              followIndicator(input.indicatorId),
            );
            if (!follow) return null;
            const node = yield* compileIndicator(follow.indicator);
            const outputs = yield* Effect.try({
              try: () => Tea.indicatorSeriesOutputs(node),
              catch: invalidIndicator,
            });
            return {
              title: node.declaration?.title ?? follow.indicator.source.path,
              market: follow.market,
              outputs: outputs.map((output) => output.name),
            };
          }),
        ),
        { signal },
      ),
    ),
  alertFeedExecutions: trpc.procedure
    .input(
      Schema.toStandardSchemaV1(
        Schema.Struct({
          eventIds: Schema.Array(AlertEventId).check(Schema.isMaxLength(200)),
        }).annotate({ parseOptions: { onExcessProperty: "error" } }),
      ),
    )
    .query(({ ctx, input, signal }) =>
      ctx.runtime.runPromise(feedExecutions(input.eventIds), { signal }),
    ),
});
