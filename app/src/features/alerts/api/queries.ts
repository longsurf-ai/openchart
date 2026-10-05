// Purpose: Own Alert queries and atomic rule/action saves; editing never admits Agent runs.
import {
  infiniteQueryOptions,
  queryOptions,
  skipToken,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { BarsSeries } from "@openchart/feed";
import { encodedBarsInputs } from "@openchart/app/lib/tea";
import { resourceQueryKeys } from "@openchart/app/lib/resource/invalidation";
import type {
  AgentInputs,
  AppTransport,
  ResourceInputs,
  ResourceOutputs,
} from "@openchart/app/lib/transport/transport";

/** Saved Tea definitions or drawing links define execution. */
export type AlertRule = ResourceOutputs["alert_rule"]["list"]["items"][number];
export type DrawingAlert = Extract<
  AlertSave["value"]["alertable"],
  { kind: "drawing" }
>;
/** Chart creation carries only saved identity, descriptive text and evaluation settings. */
export type NewDrawingAlert = Pick<DrawingAlert, "drawingId" | "inputs"> & {
  name: string;
  type: string;
};
/** Common Agent composer input, including Parts, model and workspace. */
export type AlertPrompt = AgentInputs["prompt"]["input"];
/** Agent defaults used by chart quick creation. */
export type TriggerAgent = Pick<AlertPrompt, "agent" | "model">;
type StoredTrigger = ResourceOutputs["trigger"]["list"]["items"][number];
type NewTrigger = ResourceInputs["trigger"]["create"];
/** Full action content is retained when only another action or model changes. */
export type TriggerTarget =
  | Extract<NewTrigger["target"], { kind: "notification" }>
  | {
      kind: "agent_prompt";
      prompt: AlertPrompt;
      binding?: Extract<
        NewTrigger["target"],
        { kind: "agent_prompt" }
      >["binding"];
    };
/** Project recursive Resource output onto the shared prompt input wire shape. */
export type Trigger = Pick<
  StoredTrigger,
  "id" | "revision" | "name" | "enabled" | "event" | "updatedAt"
> & { target: TriggerTarget };
export type TriggerChannel = TriggerTarget["kind"];
/** What a followed Indicator follows now: its title, cell market and readable outputs. */
export type AlertIndicator = Awaited<
  ReturnType<
    AppTransport["rpc"]["resources"]["macro"]["alertIndicator"]["query"]
  >
>;
export type AlertStarter = Awaited<
  ReturnType<
    AppTransport["rpc"]["resources"]["alert_rule"]["starters"]["query"]
  >
>[number];

/** The server's condition tree for Tea source and parameters; null for custom Tea.
 * The editor and chart lines share this one projection; missing input skips the read.
 * @example useQuery(alertConditionsQueryOptions(transport, { source, parameters })); */
export function alertConditionsQueryOptions(
  transport: AppTransport,
  input?: Parameters<
    AppTransport["rpc"]["resources"]["alert_rule"]["readConditions"]["query"]
  >[0],
) {
  return queryOptions({
    queryKey: [["alert", "readConditions"], transport.url, input] as const,
    // Sources can reach 64 KiB, too long for a GET URL.
    queryFn: input
      ? ({ signal }) =>
          transport.rpc.resources.alert_rule.readConditions.query(input, {
            signal,
            context: { method: "POST" },
          })
      : skipToken,
    // A pure function of source and parameters.
    staleTime: Infinity,
    meta: { errorTitle: "Couldn’t read alert conditions" },
  });
}

/** Build a validated conditions draft without saving it; Query reports request failures. @example await client.fetchQuery(buildAlertConditionsQueryOptions(transport, { query })); */
export function buildAlertConditionsQueryOptions(
  transport: AppTransport,
  input: Parameters<
    AppTransport["rpc"]["resources"]["alert_rule"]["buildConditions"]["query"]
  >[0],
) {
  return queryOptions({
    queryKey: [["alert", "buildConditions"], transport.url, input] as const,
    queryFn: ({ signal }) =>
      transport.rpc.resources.alert_rule.buildConditions.query(input, {
        signal,
      }),
    meta: { errorTitle: "Couldn’t build alert conditions" },
  });
}

/** Trigger dispatch fills these placeholders from the firing event; editing keeps them literal. */
export const defaultTriggerTemplate = "{symbol} {title}: {value}";
/** Default instructions for a new alert action, independent of the selected Agent provider. */
export const defaultAlertAgentPrompt =
  "Explain this move from this alert: {message}";
export {
  alertConfigMarket,
  encodedBarsInputs,
  readAlertConfig,
  writeAlertConfig,
  type AlertConfig,
} from "@openchart/app/lib/tea";
/** Atomic editor snapshot: absent identity creates; present identity compares its revision. */
export type AlertSave = Parameters<
  AppTransport["rpc"]["resources"]["macro"]["saveAlertRule"]["mutate"]
>[0];

/** Page rules with the shared Resource invalidation prefix. @example useInfiniteQuery(alertRulePagesQueryOptions(transport)); */
export function alertRulePagesQueryOptions(
  transport: AppTransport,
  orderBy?: Exclude<ResourceInputs["alert_rule"]["list"], void>["orderBy"],
) {
  return infiniteQueryOptions({
    meta: { errorTitle: "Couldn’t load rules" },
    queryKey: [
      ["resources", "alert_rule", "list"],
      transport.url,
      "pages",
      orderBy,
    ] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      transport.rpc.resources.alert_rule.list.query(
        {
          limit: 20,
          cursor: pageParam,
          ...(orderBy ? { orderBy, order: "desc" as const } : {}),
        },
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}
/** Direct links read their Rule independently of loaded directory pages; deletion is an empty result. @example useQuery(alertRuleQueryOptions(transport, ruleId)); */
export function alertRuleQueryOptions(transport: AppTransport, id?: string) {
  return queryOptions({
    meta: { errorTitle: "Couldn’t load this rule" },
    queryKey: [["resources", "alert_rule", "get"], transport.url, id] as const,
    queryFn: id
      ? async ({ signal }) => {
          try {
            return await transport.rpc.resources.alert_rule.get.query(
              { id },
              { signal },
            );
          } catch (error) {
            if (
              error instanceof Error &&
              "data" in error &&
              typeof error.data === "object" &&
              error.data !== null &&
              "code" in error.data &&
              error.data.code === "NOT_FOUND"
            )
              return null;
            throw error;
          }
        }
      : skipToken,
  });
}
/** Read all rule pages for chart projections without silently truncating at 200. @example useQuery(alertRulesQueryOptions(transport)); */
export function alertRulesQueryOptions(transport: AppTransport) {
  return queryOptions({
    meta: { errorTitle: "Couldn’t load rules" },
    queryKey: [
      ["resources", "alert_rule", "list"],
      transport.url,
      "all",
    ] as const,
    queryFn: async ({ signal }) => {
      const items: AlertRule[] = [];
      let cursor: string | undefined;
      do {
        const page = await transport.rpc.resources.alert_rule.list.query(
          { limit: 200, cursor },
          { signal },
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    },
  });
}
async function readTriggers(
  transport: AppTransport,
  signal?: AbortSignal,
): Promise<Trigger[]> {
  const items: Trigger[] = [];
  let cursor: string | undefined;
  do {
    const page = await transport.rpc.resources.trigger.list.query(
      { limit: 200, cursor },
      { signal },
    );
    for (const item of page.items) items.push(item as unknown as Trigger);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
/** Preserve complete prompts and action revisions in editor snapshots. @example useQuery(triggersQueryOptions(transport)); */
export function triggersQueryOptions(transport: AppTransport) {
  return queryOptions({
    meta: { errorTitle: "Couldn’t load rule actions" },
    queryKey: [["resources", "trigger", "list"], transport.url] as const,
    queryFn: ({ signal }) => readTriggers(transport, signal),
    refetchOnMount: "always",
  });
}
/** Exact bundled sources identify editable Simple projections. @example useQuery(alertStartersQueryOptions(transport)); */
export function alertStartersQueryOptions(transport: AppTransport) {
  return queryOptions({
    meta: { errorTitle: "Couldn’t load alert scripts" },
    queryKey: [["alert", "starters"], transport.url] as const,
    queryFn: ({ signal }) =>
      transport.rpc.resources.alert_rule.starters.query(undefined, { signal }),
    staleTime: Infinity,
  });
}
/** Read current drawing metadata without copying its geometry into an alert. @example useQuery(alertDrawingQueryOptions(transport, drawingId)); */
export function alertDrawingQueryOptions(
  transport: AppTransport,
  drawingId?: string,
) {
  return queryOptions({
    meta: { errorTitle: "Couldn’t load this alert’s drawing" },
    queryKey: [
      ...resourceQueryKeys.resource("drawing"),
      "alert",
      transport.url,
      drawingId,
    ],
    queryFn: drawingId
      ? async ({ signal }) => {
          try {
            return await transport.rpc.resources.drawing.get.query(
              { id: drawingId },
              { signal },
            );
          } catch (error) {
            if (
              error instanceof Error &&
              "data" in error &&
              typeof error.data === "object" &&
              error.data !== null &&
              "code" in error.data &&
              error.data.code === "NOT_FOUND"
            )
              return null;
            throw error;
          }
        }
      : skipToken,
  });
}
function refresh(client: QueryClient, ...resources: string[]) {
  return Promise.all(
    resources.map((resource) =>
      client.invalidateQueries({
        queryKey: resourceQueryKeys.resource(resource),
      }),
    ),
  );
}
/** One transaction persists Rule and actions; identical Rule bodies never restart observation. @example save.mutate({value, actions}); */
export function useSaveAlertRule(transport: AppTransport) {
  const client = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn’t save this rule" },
    mutationFn: async (draft: AlertSave): Promise<void> => {
      await transport.rpc.resources.macro.saveAlertRule.mutate(draft);
    },
    retry: false,
    onSettled: () => refresh(client, "alert_rule", "trigger"),
  });
}
/** Validate enabled definitions through the atomic save boundary; disabling only patches enabled. @example toggle.mutate({rule,enabled:true}); */
export function useToggleAlertRule(transport: AppTransport) {
  const client = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn’t update this rule" },
    mutationFn: async ({
      rule,
      enabled,
    }: {
      rule: AlertRule;
      enabled: boolean;
    }) => {
      if (!enabled) {
        await transport.rpc.resources.alert_rule.patch.mutate({
          id: rule.id,
          expectedRevision: rule.revision,
          operations: [{ op: "replace", path: "/enabled", value: false }],
        });
        return;
      }
      const actions = (await readTriggers(transport))
        .filter((action) => action.event.ruleId === rule.id)
        .map(({ id, revision, name, enabled, target }) => ({
          id,
          expectedRevision: revision,
          name,
          enabled,
          target,
        }));
      await transport.rpc.resources.macro.saveAlertRule.mutate({
        rule: { id: rule.id, expectedRevision: rule.revision },
        value: {
          name: rule.name,
          enabled: true,
          repeat: rule.repeat,
          alertable: rule.alertable,
        },
        actions,
      } as AlertSave);
    },
    retry: false,
    onSettled: () => refresh(client, "alert_rule", "trigger"),
  });
}
/** Delete the rule and its attached actions; Resource owns history cascade. @example remove.mutate(rule.id); */
export function useDeleteAlertRule(transport: AppTransport) {
  const client = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn’t delete this rule" },
    mutationFn: async (id: AlertRule["id"]) => {
      await transport.rpc.resources.alert_rule.delete.mutate({ id });
      const actions = (await readTriggers(transport)).filter(
        (item) => item.event.ruleId === id,
      );
      await Promise.all(
        actions.map((item) =>
          transport.rpc.resources.trigger.delete.mutate({ id: item.id }),
        ),
      );
    },
    retry: false,
    onSettled: () => refresh(client, "alert_rule", "trigger", "alert_event"),
  });
}
/** The Indicator an alert follows, with the name of the Indicator output it tests. */
export type AlertIndicatorOutput = {
  indicatorId: string;
  output: string;
  /** Leads the default rule name, e.g. "AAPL RSI". */
  label: string;
};
/** Quick chart alert creation uses the same atomic save boundary as the editor.
 * A market rule uses `starter`'s source; an Indicator rule generates conditions
 * on `indicator.<output>` with `starter`'s operators and value defaults. */
export type NewAlertRule = (
  { inputs: BarsSeries } | { indicator: AlertIndicatorOutput }
) & {
  starter: AlertStarter;
  operator: string;
  threshold: number;
  repeat: boolean;
  channels: readonly TriggerChannel[];
  agent?: TriggerAgent;
  name?: string;
  template?: string;
};
/** Create a threshold starter without opening an editor or admitting an Agent run. @example create.mutate({inputs,starter,operator:"crossing",threshold:200,repeat:false,channels:["notification"]}); */
export function useCreateAlertRule(transport: AppTransport) {
  const client = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn’t create this rule" },
    mutationFn: async (draft: NewAlertRule): Promise<void> => {
      const { starter, operator, threshold, repeat, agent } = draft;
      const condition = `${starter.operators.find((item) => item.value === operator)?.label ?? operator} ${threshold}`;
      const name =
        draft.name ??
        ("indicator" in draft
          ? `${draft.indicator.label} ${condition}`
          : `${draft.inputs.listing.symbol} ${starter.label} ${condition}`);
      const defaults = Object.fromEntries(
        starter.parameters.map((parameter) => [
          parameter.name,
          parameter.defaultValue,
        ]),
      );
      const message = draft.template ?? defaultTriggerTemplate;
      const actions = draft.channels.map((kind) => {
        if (kind === "agent_prompt" && !agent)
          throw new Error(
            "Choose a model before delivering alerts to the Agent.",
          );
        return {
          name,
          enabled: true,
          target:
            kind === "notification"
              ? { kind, message }
              : {
                  kind,
                  prompt: {
                    ...agent!,
                    parts: [
                      {
                        type: "text" as const,
                        text: draft.template ?? defaultAlertAgentPrompt,
                      },
                    ],
                  },
                },
        };
      });
      let alertable: AlertSave["value"]["alertable"];
      if ("indicator" in draft) {
        const generated =
          await transport.rpc.resources.alert_rule.buildConditions.query({
            query: {
              combinator: "and",
              rules: [
                {
                  field: `indicator.${draft.indicator.output}`,
                  operator,
                  value: {
                    ...(defaults as Record<
                      "threshold" | "lower" | "upper" | "amount" | "bars",
                      number
                    >),
                    threshold,
                  },
                },
              ],
            },
          });
        alertable = {
          kind: "tea",
          source: generated.source,
          config: {
            indicatorId: draft.indicator.indicatorId,
            parameters: generated.parameters,
            requests: {},
          },
        } as AlertSave["value"]["alertable"];
      } else
        alertable = {
          kind: "tea",
          source: starter.source,
          config: {
            ...encodedBarsInputs(draft.inputs),
            parameters: { ...defaults, op: operator, threshold },
            requests: {},
          },
        };
      await transport.rpc.resources.macro.saveAlertRule.mutate({
        value: { name, enabled: true, repeat, alertable },
        actions,
      } as AlertSave);
    },
    retry: false,
    onSettled: () => refresh(client, "alert_rule", "trigger"),
  });
}
/** What a followed Indicator follows now; null once the Indicator or its cell is gone. @example useQuery(alertIndicatorQueryOptions(transport, indicatorId)); */
export function alertIndicatorQueryOptions(
  transport: AppTransport,
  indicatorId?: string,
) {
  return queryOptions({
    meta: { errorTitle: "Couldn’t read this Indicator" },
    queryKey: [
      ...resourceQueryKeys.resource("indicator"),
      "alert",
      transport.url,
      indicatorId,
    ] as const,
    queryFn: indicatorId
      ? ({ signal }) =>
          transport.rpc.resources.macro.alertIndicator.query(
            { indicatorId },
            { signal },
          )
      : skipToken,
  });
}
/** Copy complete saved action content and bindings in the same transaction as the new rule.
 * A tea copy may write a new value to the parameter holding its threshold.
 * @example duplicate.mutate({rule,threshold:{parameter:"threshold",value:201}}); */
export function useDuplicateAlertRule(transport: AppTransport) {
  const client = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn’t copy this rule" },
    mutationFn: async ({
      rule,
      threshold,
    }: {
      rule: AlertRule;
      threshold?: { parameter: string; value: number };
    }) => {
      const actions = (await readTriggers(transport))
        .filter((item) => item.event.ruleId === rule.id)
        .map(({ name, enabled, target }) => ({ name, enabled, target }));
      await transport.rpc.resources.macro.saveAlertRule.mutate({
        value: {
          name: `${rule.name.slice(0, 153)} (copy)`,
          enabled: rule.enabled,
          repeat: rule.repeat,
          alertable:
            rule.alertable.kind === "tea" && threshold !== undefined
              ? {
                  ...rule.alertable,
                  config: {
                    ...rule.alertable.config,
                    parameters: {
                      ...rule.alertable.config.parameters,
                      [threshold.parameter]: threshold.value,
                    },
                  },
                }
              : rule.alertable,
        },
        actions,
      } as AlertSave);
    },
    retry: false,
    onSettled: () => refresh(client, "alert_rule", "trigger"),
  });
}
