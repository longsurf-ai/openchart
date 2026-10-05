// Purpose: Connect chart price and Indicator alerts to their saved rules, actions and shared editor.
import { hashKey, useQueries, useQuery } from "@tanstack/react-query";
import { useState, type PropsWithChildren } from "react";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";

import {
  ChartAlertContext,
  type ChartAlertLine,
} from "@openchart/app/features/chart/components/alert-button";
import { chartWidget } from "@openchart/app/features/chart/components/widget";
import {
  alertConditionsQueryOptions,
  alertRulesQueryOptions,
  alertStartersQueryOptions,
  alertConfigMarket,
  useCreateAlertRule,
  useDeleteAlertRule,
  useDuplicateAlertRule,
  type AlertRule,
  type NewDrawingAlert,
} from "@openchart/app/features/alerts/api/queries";
import { AlertRuleDialog } from "@openchart/app/features/alerts/components/alert-rule-dialog";
import { useWidget } from "@openchart/app/hooks/use-widget";

import { useAlertsAgent } from "./use-alerts-agent";
import { renderAlertListingPicker } from "./alert-listing-picker";
import { alertPromptEditor } from "./alert-prompt-editor";

const ChartProvider = chartWidget.Provider!;

/**
 * Compose chart alerts with Resource-backed lines and the shared rule editor.
 * Creation has no toast or desktop notification; saved rules appear as lines.
 * Query reports request failures; missing starter data uses the shared error toast.
 * Unmount releases Query observers.
 * @example <ChartAlertsProvider><ChartContent /></ChartAlertsProvider>
 */
export function ChartAlertsProvider({ children }: PropsWithChildren) {
  const { transport } = useWidget();
  const agent = useAlertsAgent();
  const starters = useQuery(alertStartersQueryOptions(transport));
  const rules = useQuery(alertRulesQueryOptions(transport));
  const create = useCreateAlertRule(transport);
  const remove = useDeleteAlertRule(transport);
  const duplicate = useDuplicateAlertRule(transport);
  const [editing, setEditing] = useState<AlertRule>();
  const [drawing, setDrawing] = useState<NewDrawingAlert>();
  const price = starters.data?.find((starter) => starter.id === "price");
  useErrorToast(
    starters.data && !price ? "Price alerts are unavailable." : undefined,
    {
      id: `price-alerts:${transport.url}`,
      title: "Couldn’t load price alerts",
      retry: () => {
        void starters.refetch();
      },
    },
  );
  const enabled = (rules.data ?? []).filter((rule) => rule.enabled);
  // Rules with requests are custom Tea and never draw a line.
  const conditionQueries = enabled.map(({ alertable }) =>
    alertConditionsQueryOptions(
      transport,
      alertable.kind === "tea" &&
        Object.keys(alertable.config.requests).length === 0
        ? { source: alertable.source, parameters: alertable.config.parameters }
        : undefined,
    ),
  );
  // useQueries warns on repeated keys; drawing rules, and one source on several inputs, share a key.
  const queries = [
    ...new Map(
      conditionQueries.map((options) => [hashKey(options.queryKey), options]),
    ).values(),
  ];
  const projections = new Map(
    useQueries({ queries }).map((result, index) => [
      hashKey(queries[index]!.queryKey),
      result.data,
    ]),
  );
  const thresholdOperators = new Set<string>([
    ...(price?.operators ?? [])
      .filter((operator) => operator.group === "threshold")
      .map((operator) => operator.value),
    ...(price?.legacyOperators ?? []).map((operator) => operator.value),
  ]);
  // A line is exactly one threshold condition on price or an Indicator output.
  const lines = enabled.flatMap((rule, index): ChartAlertLine[] => {
    const conditions = projections.get(
      hashKey(conditionQueries[index]!.queryKey),
    )?.rules;
    const condition = conditions?.length === 1 ? conditions[0] : undefined;
    if (
      !price ||
      rule.alertable.kind !== "tea" ||
      !condition ||
      "rules" in condition ||
      !thresholdOperators.has(condition.operator)
    )
      return [];
    const { source, config } = rule.alertable;
    const line = {
      id: rule.id,
      name: rule.name,
      threshold: condition.value.threshold,
      // Starters name it `threshold`; buildConditions prefixes a single leaf's parameters with c0_.
      thresholdParameter:
        source === price.source || price.legacySources.includes(source)
          ? "threshold"
          : "c0_threshold",
    };
    // Price reads the rule's market, the one series every root Bars input reads.
    const market = alertConfigMarket(config);
    if (condition.field === "price" && market)
      return [{ ...line, inputs: market }];
    if (condition.field.startsWith("indicator.") && "indicatorId" in config)
      return [
        {
          ...line,
          indicator: {
            indicatorId: config.indicatorId,
            output: condition.field.slice("indicator.".length),
          },
        },
      ];
    return [];
  });
  return (
    <ChartAlertContext.Provider
      value={{
        pending:
          create.isPending ||
          remove.isPending ||
          duplicate.isPending ||
          starters.isFetching,
        agentAvailable: agent !== undefined,
        error:
          create.error ??
          remove.error ??
          duplicate.error ??
          rules.error ??
          starters.error ??
          (starters.data && !price
            ? new Error("Price alerts are unavailable.")
            : null),
        lines,
        drawingAlerts: (rules.data ?? []).flatMap((rule) =>
          rule.alertable.kind === "drawing"
            ? [
                {
                  id: rule.id,
                  name: rule.name,
                  drawingId: rule.alertable.drawingId,
                  enabled: rule.enabled,
                  inputs: rule.alertable.inputs,
                },
              ]
            : [],
        ),
        edit: (id) => setEditing(rules.data?.find((rule) => rule.id === id)),
        remove: (id) => {
          const rule = rules.data?.find((item) => item.id === id);
          if (rule) remove.mutate(rule.id);
        },
        duplicate: (id, threshold) => {
          const rule = rules.data?.find((item) => item.id === id);
          if (rule) duplicate.mutate({ rule, threshold });
        },
        create: (target, runAgent) => {
          if (!price) {
            void starters.refetch();
            return;
          }
          create.mutate({
            ...target,
            starter: price,
            operator: "crossing",
            repeat: false,
            channels: runAgent
              ? ["notification", "agent_prompt"]
              : ["notification"],
            agent,
          });
        },
        createDrawing: setDrawing,
      }}
    >
      <ChartProvider>{children}</ChartProvider>
      {editing || drawing ? (
        <AlertRuleDialog
          key={editing?.id ?? drawing?.drawingId}
          rule={editing}
          drawing={drawing}
          transport={transport}
          renderListingPicker={renderAlertListingPicker}
          renderPromptEditor={alertPromptEditor(transport)}
          onClose={() => {
            setEditing(undefined);
            setDrawing(undefined);
          }}
        />
      ) : null}
    </ChartAlertContext.Provider>
  );
}
