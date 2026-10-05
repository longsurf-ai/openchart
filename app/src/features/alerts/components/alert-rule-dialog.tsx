// Purpose: Compose Conditions/Tea and the native Agent composer over one revision-checked alert draft.
import { useAssistantContext } from "@assistant-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BellIcon,
  BotIcon,
  ListTreeIcon,
  CodeIcon,
  PlusIcon,
  ChartCandlestick,
  WrapTextIcon,
} from "lucide-react";
import { barsSeries, type BarsSeries, type Resolution } from "@openchart/feed";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import { Button } from "@openchart/app/components/ui/button";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldSet,
} from "@openchart/app/components/ui/field";
import { Input } from "@openchart/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openchart/app/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@openchart/app/components/ui/tabs";
import { Toggle } from "@openchart/app/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";
import { cn } from "@openchart/app/utils/cn";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@openchart/app/components/ui/avatar/avatar";
import { alertLogoIdentifier } from "@openchart/app/features/alerts/lib/alert-logo-identifier";
import { useLogo } from "@openchart/app/hooks/use-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openchart/app/components/ui/dropdown";
import {
  formatQuery,
  prepareRuleGroup,
  type RuleGroupType,
} from "react-querybuilder";
import {
  ConditionsEditor,
  conditionValues,
  defaultConditions,
  type ConditionField,
} from "./conditions-editor";
import "./alert-workflow.css";
import {
  alertStartersQueryOptions,
  alertConditionsQueryOptions,
  buildAlertConditionsQueryOptions,
  alertDrawingQueryOptions,
  alertIndicatorQueryOptions,
  triggersQueryOptions,
  useSaveAlertRule,
  defaultTriggerTemplate,
  alertConfigMarket,
  encodedBarsInputs,
  readAlertConfig,
  writeAlertConfig,
  type AlertConfig,
  type AlertPrompt,
  type AlertRule,
  type AlertSave,
  type AlertStarter,
  type Trigger,
  type DrawingAlert,
  type NewDrawingAlert,
  type TriggerTarget,
} from "@openchart/app/features/alerts/api/queries";
import { AlertActionNode, type AlertActionDraft } from "./alert-action-node";
import type { AppTransport } from "@openchart/app/lib/transport/transport";

const CodeEditor = lazy(() =>
  import("@openchart/app/components/ui/code-editor").then(({ CodeEditor }) => ({
    default: CodeEditor,
  })),
);

/** App composition owns symbol/provider selection, without a cross-feature import. */
export type AlertListingPicker = (props: {
  value: BarsSeries | null;
  onChange: (value: BarsSeries | null) => void;
}) => ReactNode;
/** The feature consumes composer output without owning Agent runtime or sessions. */
export type AlertPromptEditor = {
  model?: AlertPrompt["model"];
  content: ReactNode;
  ready: boolean;
  changed: boolean;
  partsChanged: boolean;
  modelChanged: boolean;
  workspaceChanged: boolean;
  read: () => Promise<AlertPrompt>;
};
export type AlertPromptEditorRenderer = (props: {
  prompt?: AlertPrompt;
  initialText: string;
  disabled: boolean;
  onCancel: () => void;
  children: (editor: AlertPromptEditor) => ReactNode;
}) => ReactNode;
export type AlertRuleDialogProps = {
  rule?: AlertRule;
  /** Preserve an open draft after source deletion, but block saving it. */
  ruleUnavailable?: boolean;
  drawing?: NewDrawingAlert;
  /** Open this action draft when navigating from a feed post. */
  initialActionId?: string;
  transport: AppTransport;
  renderListingPicker: AlertListingPicker;
  renderPromptEditor: AlertPromptEditorRenderer;
  onClose: () => void;
};

/** Edit one canonical definition; failed saves keep the draft mounted. @example <AlertRuleDialog {...props} /> */
export function AlertRuleDialog(props: AlertRuleDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <DialogContent className="neutral-controls max-h-[90vh] overflow-y-auto sm:max-w-2xl lg:max-w-2xl xl:max-w-2xl">
        <AlertRuleContent
          {...props}
          onBusyChange={setBusy}
          presentation="dialog"
        />
      </DialogContent>
    </Dialog>
  );
}

/** Reuse the dialog's exact draft and save boundary in the full rule page. Remount with a rule ID key when switching rules. @example <AlertRulePage key={rule.id} {...props} onDirtyChange={setDirty} /> */
export function AlertRulePage(
  props: AlertRuleDialogProps & {
    onDirtyChange?: (dirty: boolean) => void;
    /** Render the name draft in the host's header, replacing the Name form row. */
    renderTitle?: (title: ReactNode) => ReactNode;
    /** Place controls in the host pane footer, outside scrolling content. */
    renderFooter?: (footer: ReactNode) => ReactNode;
    /** App composition supplies the original drawing's chart without coupling features. */
    renderChart?: (drawing: DrawingAlert) => ReactNode;
  },
) {
  return (
    <div className="alert-rule-page neutral-controls w-full min-w-0 space-y-4">
      <AlertRuleContent {...props} presentation="page" />
    </div>
  );
}

type EditorHostProps = AlertRuleDialogProps & {
  presentation: "page" | "dialog";
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  renderTitle?: (title: ReactNode) => ReactNode;
  renderFooter?: (footer: ReactNode) => ReactNode;
  renderChart?: (drawing: DrawingAlert) => ReactNode;
};

function AlertRuleContent(props: EditorHostProps) {
  useAssistantContext({
    disabled: !props.rule,
    getContext: () => `user is viewing alert rule with id ${props.rule?.id}`,
  });
  const starters = useQuery(alertStartersQueryOptions(props.transport));
  const triggers = useQuery(triggersQueryOptions(props.transport));
  const [actionsReady, setActionsReady] = useState(false);
  // Admit one fresh action snapshot; later refetches must retain drafts and conflict checks.
  useEffect(() => {
    if (triggers.isFetchedAfterMount && triggers.isSuccess)
      setActionsReady(true);
  }, [triggers.isFetchedAfterMount, triggers.isSuccess]);
  if (starters.data && triggers.data && actionsReady)
    return (
      <AlertRuleEditor
        {...props}
        starters={starters.data}
        deliveries={triggers.data.filter(
          (item) => item.event.ruleId === props.rule?.id,
        )}
      />
    );
  return (
    <>
      {props.renderTitle?.(props.rule?.name ?? "New alert")}
      {props.presentation === "dialog" ? (
        <DialogHeader className="pb-4">
          <DialogTitle>
            {props.rule ? "Edit alert rule" : "Create alert rule"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Alert rule configuration
          </DialogDescription>
        </DialogHeader>
      ) : null}
      {starters.isError || triggers.isError ? (
        <Button
          onClick={() => {
            void starters.refetch();
            void triggers.refetch();
          }}
        >
          Retry
        </Button>
      ) : (
        <p role="status">Loading rule…</p>
      )}
    </>
  );
}

function DraftState({
  dirty,
  onChange,
}: {
  dirty: boolean;
  onChange?: (dirty: boolean) => void;
}) {
  useEffect(() => {
    onChange?.(dirty);
  }, [dirty, onChange]);
  return null;
}

/** Only exact saved template source can use the Simple form. @example matchingAlertStarter(starters, source); */
export function matchingAlertStarter(
  starters: readonly AlertStarter[],
  source: string,
) {
  return starters.find(
    (starter) =>
      starter.source === source || starter.legacySources.includes(source),
  );
}
const defaults = (starter: AlertStarter) => ({
  op: "greater_than",
  ...Object.fromEntries(
    starter.parameters.map((parameter) => [
      parameter.name,
      parameter.defaultValue,
    ]),
  ),
});
/**
 * A Conditions program's config: `parameters` and no requests, reading what
 * `root` reads, its inputs or the Indicator it follows. Without a root it
 * reads nothing yet.
 */
const conditionsConfig = (
  root: AlertConfig | null | undefined,
  parameters: AlertConfig["parameters"],
): AlertConfig =>
  root && "indicatorId" in root
    ? { indicatorId: root.indicatorId, parameters, requests: {} }
    : {
        inputs: root?.inputs ?? {},
        map: root?.map ?? {},
        parameters,
        requests: {},
      };
const starterConfigText = (starter: AlertStarter, root?: AlertConfig | null) =>
  writeAlertConfig(conditionsConfig(root, defaults(starter)));

type ExecutableConditions = Parameters<
  AppTransport["rpc"]["resources"]["alert_rule"]["buildConditions"]["query"]
>[0]["query"];
type ConditionLeaf = Extract<
  ExecutableConditions["rules"][number],
  { field: unknown }
>;

// RQB row IDs stay in the UI. The server validates the execution-only shape.
function executableConditions(query: RuleGroupType): ExecutableConditions {
  if (!query.rules.length)
    throw new Error("Add at least one condition to each group.");
  return {
    combinator: query.combinator as "and" | "or",
    rules: query.rules.map((rule) => {
      if ("rules" in rule) return executableConditions(rule);
      const draft = rule.value as Record<string, string | number>;
      const value = { ...conditionValues };
      for (const key of Object.keys(value) as (keyof typeof value)[]) {
        const raw = draft[key];
        if (raw === "" || raw === undefined || !Number.isFinite(Number(raw)))
          throw new Error(`Enter a valid ${key} for ${rule.field}.`);
        value[key] = Number(raw);
      }
      return {
        field: rule.field as ConditionLeaf["field"],
        operator: rule.operator,
        value,
      };
    }),
  };
}

function AlertRuleEditor({
  rule: currentRule,
  ruleUnavailable = false,
  drawing: initialDrawing,
  initialActionId,
  transport,
  renderListingPicker,
  renderPromptEditor,
  onClose,
  starters,
  deliveries,
  onBusyChange,
  onDirtyChange,
  presentation,
  renderTitle,
  renderFooter,
  renderChart,
}: EditorHostProps & {
  starters: readonly AlertStarter[];
  deliveries: readonly Trigger[];
}) {
  const [rule] = useState(currentRule);
  const [snapshot] = useState(() => [...deliveries]);
  const tea = rule?.alertable.kind === "tea" ? rule.alertable : undefined;
  const [drawing, setDrawing] = useState<DrawingAlert | undefined>(() =>
    rule?.alertable.kind === "drawing"
      ? rule.alertable
      : initialDrawing
        ? {
            kind: "drawing",
            drawingId: initialDrawing.drawingId,
            inputs: initialDrawing.inputs,
            operator:
              initialDrawing.type === "parallel_channel"
                ? "entering_channel"
                : "crossing",
          }
        : undefined,
  );
  const linkedDrawing = useQuery(
    alertDrawingQueryOptions(transport, drawing?.drawingId),
  );
  const drawingItem = linkedDrawing.data?.data;
  const drawingType = drawingItem?.type ?? initialDrawing?.type;
  const drawingName = drawingItem
    ? drawingItem.type === "annotation"
      ? drawingItem.title
      : (drawingItem.name ?? drawingItem.type.replaceAll("_", " "))
    : linkedDrawing.data === null
      ? "Drawing deleted"
      : (initialDrawing?.name ?? "Linked drawing");
  const channelDrawing =
    drawingType === "parallel_channel" ||
    (drawing?.operator.endsWith("_channel") ?? false);
  const boundaryDrawing =
    ["freehand", "polyline", "rectangle", "triangle", "curved_line"].includes(
      drawingType ?? "",
    ) ||
    (!drawingType && drawing?.operator === "touching");
  const drawingOperators = boundaryDrawing
    ? ([
        { value: "crossing", label: "Crossing" },
        { value: "touching", label: "Touch" },
      ] as const)
    : channelDrawing
      ? ([
          { value: "entering_channel", label: "Entering Channel" },
          { value: "exiting_channel", label: "Exiting Channel" },
          { value: "inside_channel", label: "Inside Channel" },
          { value: "outside_channel", label: "Outside Channel" },
        ] as const)
      : ([
          { value: "crossing", label: "Crossing" },
          { value: "crossing_up", label: "Crossing Up" },
          { value: "crossing_down", label: "Crossing Down" },
        ] as const);
  const [source, setSource] = useState(tea?.source ?? starters[0]!.source);
  const [savedConfigText] = useState(() =>
    tea ? writeAlertConfig(tea.config) : starterConfigText(starters[0]!),
  );
  const [configText, setConfigText] = useState(savedConfigText);
  const config = useMemo(() => {
    try {
      return readAlertConfig(configText);
    } catch {
      return null;
    }
  }, [configText]);
  // The root's Bars inputs. A followed Indicator, or a rule without a symbol yet, has none.
  const barsInputs =
    config && "inputs" in config ? Object.entries(config.inputs) : [];
  // The market Conditions show and edit: the one series every Bars input reads.
  // Bars inputs on different series show none until a picked symbol moves them all.
  const marketInputs = config ? alertConfigMarket(config) : undefined;
  const indicatorId =
    config && "indicatorId" in config ? config.indicatorId : undefined;
  // Point every Bars input at `series`; a config without one gets the standard Bars input.
  const setMarket = (series: BarsSeries) =>
    setConfigText(
      writeAlertConfig(
        config && "inputs" in config && barsInputs.length
          ? {
              ...config,
              inputs: Object.fromEntries(
                barsInputs.map(
                  ([name, input]) =>
                    [
                      name,
                      { ...input, ...barsSeries(series, series) },
                    ] as const,
                ),
              ),
            }
          : {
              ...encodedBarsInputs(series),
              parameters: config?.parameters ?? defaults(starters[0]!),
              requests: config?.requests ?? {},
            },
      ),
    );
  const followed = useQuery(alertIndicatorQueryOptions(transport, indicatorId));
  // An Indicator's outputs reuse the Price starter's operators and values.
  const fields = useMemo<readonly ConditionField[]>(() => {
    const price = starters.find((item) => item.id === "price");
    const indicator = followed.data;
    return indicator && price
      ? [
          ...starters,
          ...indicator.outputs.map((output) => ({
            id: `indicator.${output}`,
            label: `${indicator.title} ${output}`,
            operators: price.operators,
            legacyOperators: [],
            parameters: price.parameters,
          })),
        ]
      : starters;
  }, [starters, followed.data]);
  const indicatorInput = followed.data
    ? `${followed.data.title} · ${followed.data.market.listing.symbol} ${followed.data.market.resolution} (follows chart)`
    : followed.data === null
      ? "Indicator deleted"
      : followed.isError
        ? "Couldn’t read this Indicator"
        : "Loading Indicator…";
  const savedStarter =
    tea &&
    Object.keys(tea.config.requests).length === 0 &&
    matchingAlertStarter(starters, tea.source);
  const [conditions, setConditions] = useState<RuleGroupType | null>(() =>
    !tea
      ? defaultConditions()
      : savedStarter
        ? prepareRuleGroup({
            combinator: "and",
            rules: [
              {
                field: savedStarter.id,
                operator: String(
                  tea.config.parameters.op ??
                    (savedStarter.source === tea.source
                      ? "greater_than"
                      : "exceeds"),
                ),
                value: Object.fromEntries(
                  Object.entries(conditionValues).map(([key, value]) => [
                    key,
                    tea.config.parameters[key] ?? value,
                  ]),
                ),
              },
            ],
          })
        : null,
  );
  const definitionEdited = useRef(false);
  const [conditionsChanged, setConditionsChanged] = useState(false);
  const queryClient = useQueryClient();
  const projected = useQuery({
    ...alertConditionsQueryOptions(
      transport,
      tea && {
        source: tea.source,
        parameters: tea.config.parameters,
      },
    ),
    enabled:
      !!tea && !savedStarter && Object.keys(tea.config.requests).length === 0,
  });
  useEffect(() => {
    if (projected.data && !definitionEdited.current)
      setConditions(prepareRuleGroup(projected.data as RuleGroupType));
  }, [projected.data]);
  const [section, setSection] = useState<
    "conditions" | "code" | "chart" | null
  >(null);
  const [wrapCode, setWrapCode] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [authoredName, setName] = useState<string>();
  const market = drawing?.inputs ?? marketInputs ?? followed.data?.market;
  const symbol = market?.listing.symbol;
  const suggestedName = drawing
    ? `${symbol} Price ${drawingOperators.find((item) => item.value === drawing.operator)?.label ?? drawing.operator} ${drawingName}`.slice(
        0,
        160,
      )
    : indicatorId
      ? `${followed.data?.title ?? "Indicator"} alert`
      : `${symbol ?? "Market"} alert`;
  const savedDrawing =
    rule?.alertable.kind === "drawing" ? rule.alertable : undefined;
  const originalGeneratedDrawingName = savedDrawing
    ? `${savedDrawing.inputs.listing.symbol} Price ${drawingOperators.find((item) => item.value === savedDrawing.operator)?.label ?? savedDrawing.operator} ${drawingName}`.slice(
        0,
        160,
      )
    : undefined;
  const name =
    authoredName ??
    (drawing &&
    (!rule ||
      rule.name === originalGeneratedDrawingName ||
      rule.name === `${symbol} ${drawingName}`)
      ? suggestedName
      : (rule?.name ?? suggestedName));
  const [repeat, setRepeat] = useState(rule?.repeat ?? false);
  const logo = useLogo(
    alertLogoIdentifier(market, drawing ? undefined : (config ?? undefined)),
  );
  const symbolLogo = logo.data?.url;
  const [initialActions] = useState<AlertActionDraft[]>(() =>
    rule
      ? snapshot.map(({ id, name, enabled, target }) => ({
          id,
          name,
          enabled,
          target,
        }))
      : [
          {
            id: crypto.randomUUID(),
            name: "",
            enabled: true,
            target: { kind: "notification", message: defaultTriggerTemplate },
          },
          {
            id: crypto.randomUUID(),
            name: "",
            enabled: true,
            target: { kind: "agent_prompt" },
          },
        ],
  );
  const [actions, setActions] = useState(initialActions);
  const [focusActionId, setFocusActionId] = useState(initialActionId);
  const addButton = useRef<HTMLButtonElement>(null);
  const editors = useRef(new Map<string, AlertPromptEditor>());
  const [editorStates, setEditorStates] = useState<
    Record<string, { ready: boolean; changed: boolean }>
  >({});
  const onEditorChange = useCallback(
    (actionId: string, editor: AlertPromptEditor | undefined) => {
      if (editor) editors.current.set(actionId, editor);
      else editors.current.delete(actionId);
      setEditorStates((states) => {
        const before = states[actionId];
        if (!editor) {
          if (!before) return states;
          const next = { ...states };
          delete next[actionId];
          return next;
        }
        if (before?.ready === editor.ready && before.changed === editor.changed)
          return states;
        return {
          ...states,
          [actionId]: { ready: editor.ready, changed: editor.changed },
        };
      });
    },
    [],
  );
  const addAction = (kind: TriggerTarget["kind"]) => {
    const actionId = crypto.randomUUID();
    setActions((current) => [
      ...current,
      {
        id: actionId,
        name: "",
        enabled: true,
        target:
          kind === "notification"
            ? { kind, message: defaultTriggerTemplate }
            : { kind },
      },
    ]);
    setFocusActionId(actionId);
  };
  const actionsReady = actions.every((action) =>
    action.target.kind === "notification"
      ? !!action.target.message.trim()
      : !(action.enabled || editorStates[action.id]?.changed) ||
        !!editorStates[action.id]?.ready,
  );
  const save = useSaveAlertRule(transport);
  const [preparing, setPreparing] = useState(false);
  const [inputError, setInputError] = useState<string>();
  const disabled = save.isPending || preparing;
  const stale =
    ruleUnavailable ||
    currentRule?.revision !== rule?.revision ||
    snapshot.some(
      (item) =>
        deliveries.find((current) => current.id === item.id)?.revision !==
        item.revision,
    ) ||
    deliveries.some((item) => !snapshot.some((old) => old.id === item.id));
  const id = useId();
  const starter = matchingAlertStarter(starters, source);
  const build = async () => {
    if (!conditions || !conditionsChanged) return { source, configText };
    // Draft validation stays inline; Query alone reports backend failures.
    const input = { query: executableConditions(conditions) };
    const generated = await queryClient
      .fetchQuery(buildAlertConditionsQueryOptions(transport, input))
      .catch(() => undefined);
    if (!generated) return;
    return {
      source: generated.source,
      configText: writeAlertConfig(
        conditionsConfig(config, generated.parameters),
      ),
    };
  };
  const selectSection = async (
    next: "conditions" | "code",
    pressed: boolean,
  ) => {
    if (!pressed) {
      setSection(null);
      return;
    }
    if (drawing) {
      setSection("conditions");
      return;
    }
    setInputError(undefined);
    setPreparing(true);
    try {
      if (next === "code") {
        const built = await build();
        if (!built) return;
        setSource(built.source);
        setConfigText(built.configText);
        setConditionsChanged(false);
        setSection("code");
      } else if (conditions) setSection("conditions");
      else if (config && Object.keys(config.requests).length === 0) {
        const projection = await queryClient
          .fetchQuery(
            alertConditionsQueryOptions(transport, {
              source,
              parameters: config.parameters,
            }),
          )
          .catch(() => undefined);
        if (projection === undefined) return;
        if (projection) {
          setConditions(prepareRuleGroup(projection as RuleGroupType));
          setSection("conditions");
        } else setResetting(true);
      } else setResetting(true);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreparing(false);
    }
  };
  const resetConditions = () => {
    definitionEdited.current = true;
    setSource(starters[0]!.source);
    setConfigText(starterConfigText(starters[0]!, config ?? tea?.config));
    setConditions(defaultConditions());
    setConditionsChanged(false);
    setSection("conditions");
    setResetting(false);
    setInputError(undefined);
  };
  const description = drawing
    ? `${drawingOperators.find((item) => item.value === drawing.operator)?.label ?? drawing.operator}: ${drawingName}.`
    : conditions
      ? formatQuery(conditions, {
          format: "natural_language",
          translations: { groupSuffix: "", ruleSeparator: " " },
          fallbackExpression:
            "Add a condition to decide when this alert fires.",
          ruleProcessor: (item) => {
            const field = fields.find((entry) => entry.id === item.field);
            const operator = [
              ...(field?.operators ?? []),
              ...(field?.legacyOperators ?? []),
            ].find((entry) => entry.value === item.operator);
            const values = item.value as Record<string, string | number>;
            const keys = field?.operators.find(
              (entry) => entry.value === item.operator,
            )?.parameters ?? ["threshold"];
            return `${field?.label ?? item.field} ${operator?.label ?? item.operator} ${keys.map((key) => `${values[key] ?? "…"}${key === "bars" ? " bars" : ""}`).join(" / ")}`;
          },
        })
      : "This alert uses a custom Tea program. Open Code to review its conditions.";
  const dirty =
    (authoredName !== undefined && name !== (rule?.name ?? suggestedName)) ||
    source !== (tea?.source ?? starters[0]!.source) ||
    configText !== savedConfigText ||
    conditionsChanged ||
    repeat !== (rule?.repeat ?? false) ||
    JSON.stringify(actions) !== JSON.stringify(initialActions) ||
    actions.some((action) => editorStates[action.id]?.changed) ||
    (!!drawing &&
      JSON.stringify(drawing) !==
        JSON.stringify(
          rule?.alertable.kind === "drawing" ? rule.alertable : initialDrawing,
        ));
  const footer = (
    <DialogFooter
      className={
        renderFooter
          ? "neutral-controls mb-0 flex-row justify-end bg-transparent"
          : "bg-transparent pt-6"
      }
    >
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={onClose}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        form={`${id}-form`}
        disabled={disabled || stale || !name.trim() || !actionsReady}
      >
        {disabled ? "Saving…" : rule ? "Save rule" : "Create rule"}
      </Button>
    </DialogFooter>
  );
  return (
    <>
      <DraftState dirty={dirty} onChange={onDirtyChange} />
      {renderTitle?.(
        <EditableRuleTitle
          name={name}
          authoredName={authoredName}
          onChange={setName}
          disabled={disabled || stale}
        />,
      )}
      {presentation === "dialog" && (
        // With the grid's gap-4, If sits one step gap (spacing-8) below the title, as Then does below If.
        <DialogHeader className="pb-4">
          <DialogTitle>
            {rule ? "Edit alert rule" : "Create alert rule"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configure the condition and Agent action.
          </DialogDescription>
        </DialogHeader>
      )}
      <form
        id={`${id}-form`}
        className={
          presentation === "page"
            ? "alert-rule-page-content mx-auto w-full min-w-0 max-w-3xl"
            : "min-w-0"
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || stale || !name.trim()) return;
          setInputError(undefined);
          setPreparing(true);
          onBusyChange?.(true);
          void (async () => {
            let submitting = false;
            try {
              if (!actionsReady)
                throw new Error(
                  "Complete each action’s message and select an Agent model.",
                );
              let alertable: AlertSave["value"]["alertable"];
              if (drawing) alertable = drawing;
              else {
                if (conditions && !barsInputs.length && !indicatorId)
                  throw new Error("Select a symbol before saving.");
                const built = await build();
                if (!built) return;
                const parsed = readAlertConfig(built.configText);
                alertable = {
                  kind: "tea",
                  source: built.source,
                  config:
                    starter &&
                    built.source === source &&
                    (!tea ||
                      source !== tea.source ||
                      configText !== savedConfigText)
                      ? simpleConfig(starter, source, parsed)
                      : parsed,
                };
              }
              const savedActions: AlertSave["actions"][number][] = [];
              for (const action of actions) {
                const original = snapshot.find((item) => item.id === action.id);
                let target: TriggerTarget;
                if (action.target.kind === "notification")
                  target = action.target;
                else {
                  const editor = editors.current.get(action.id);
                  const saved = action.target.prompt;
                  if (!action.enabled && !editor?.changed && saved)
                    target = { ...action.target, prompt: saved };
                  else {
                    if (!editor?.ready)
                      throw new Error(
                        "Write a message and select an Agent model.",
                      );
                    const next = await editor.read();
                    target = {
                      ...action.target,
                      prompt: saved
                        ? {
                            ...saved,
                            ...(editor.partsChanged
                              ? { parts: next.parts }
                              : {}),
                            ...(editor.modelChanged
                              ? { model: next.model }
                              : {}),
                            ...(editor.workspaceChanged
                              ? { workspaceId: next.workspaceId }
                              : {}),
                          }
                        : next,
                    };
                  }
                }
                savedActions.push({
                  ...(original
                    ? { id: original.id, expectedRevision: original.revision }
                    : {}),
                  name: action.name || name.trim(),
                  enabled: action.enabled,
                  target,
                });
              }
              submitting = true;
              await save.mutateAsync({
                ...(rule
                  ? {
                      rule: {
                        id: rule.id,
                        expectedRevision: rule.revision,
                      },
                    }
                  : {}),
                value: {
                  name: name.trim(),
                  enabled: rule?.enabled ?? true,
                  repeat,
                  alertable,
                },
                actions: savedActions,
                removedActions: snapshot
                  .filter(
                    (item) => !actions.some((action) => action.id === item.id),
                  )
                  .map((item) => ({
                    id: item.id,
                    expectedRevision: item.revision,
                  })),
              });
              onDirtyChange?.(false);
              onClose();
            } catch (error) {
              if (!submitting)
                setInputError(
                  error instanceof Error ? error.message : String(error),
                );
            } finally {
              setPreparing(false);
              onBusyChange?.(false);
            }
          })();
        }}
      >
        <FieldSet
          disabled={disabled || stale}
          className="alert-workflow min-w-0"
        >
          <section className="alert-workflow-step" aria-labelledby={`${id}-if`}>
            <h2 id={`${id}-if`} className="alert-workflow-label">
              If
            </h2>
            <div className="alert-workflow-rail">
              <Avatar
                key={symbolLogo ?? "letter"}
                className="alert-workflow-icon border bg-background"
              >
                {symbolLogo ? (
                  <AvatarImage
                    src={symbolLogo}
                    alt={`${symbol} logo`}
                    className="bg-white p-1"
                  />
                ) : null}
                <AvatarFallback
                  aria-hidden="true"
                  className="rounded-none text-base font-medium"
                >
                  {Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "A"}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="min-w-0">
              <div className="alert-workflow-heading">
                <h3 className="alert-workflow-title flex-1">
                  <EditableRuleTitle
                    name={name}
                    authoredName={authoredName}
                    onChange={setName}
                    disabled={disabled || stale}
                    className="h-auto max-w-full py-0 font-sans"
                  />
                </h3>
                <Tabs
                  value={repeat ? "repeat" : "once"}
                  onValueChange={(value) => setRepeat(value === "repeat")}
                  className="alert-workflow-frequency gap-0"
                >
                  <TabsList aria-label="Frequency">
                    <TabsTrigger value="once" disabled={disabled || stale}>
                      Once
                    </TabsTrigger>
                    <TabsTrigger value="repeat" disabled={disabled || stale}>
                      Repeat
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="once" className="sr-only">
                    Fire once, then disable this alert.
                  </TabsContent>
                  <TabsContent value="repeat" className="sr-only">
                    Keep monitoring after this alert fires.
                  </TabsContent>
                </Tabs>
              </div>
              <p className="mt-2 text-sm leading-normal text-muted-foreground">
                {description}
              </p>
              <div
                role="group"
                aria-label="Condition editor"
                className="mt-4 flex flex-wrap items-center gap-2"
              >
                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={section === "conditions"}
                  disabled={disabled || stale}
                  aria-controls={`${id}-conditions`}
                  aria-expanded={section === "conditions"}
                  onPressedChange={(pressed) =>
                    void selectSection("conditions", pressed)
                  }
                >
                  <ListTreeIcon aria-hidden="true" />
                  Conditions
                </Toggle>
                {!drawing && (
                  <Toggle
                    variant="outline"
                    size="sm"
                    pressed={section === "code"}
                    disabled={disabled || stale}
                    aria-controls={`${id}-code`}
                    aria-expanded={section === "code"}
                    onPressedChange={(pressed) =>
                      void selectSection("code", pressed)
                    }
                  >
                    <CodeIcon aria-hidden="true" />
                    Code
                  </Toggle>
                )}
                {drawing && renderChart && (
                  <Toggle
                    variant="outline"
                    size="sm"
                    pressed={section === "chart"}
                    disabled={disabled || stale}
                    aria-controls={`${id}-chart`}
                    aria-expanded={section === "chart"}
                    onPressedChange={(pressed) =>
                      setSection(pressed ? "chart" : null)
                    }
                  >
                    <ChartCandlestick aria-hidden="true" />
                    Chart
                  </Toggle>
                )}
                {section === "code" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Toggle
                        size="sm"
                        className="ml-auto"
                        aria-label="Wrap code"
                        pressed={wrapCode}
                        onPressedChange={setWrapCode}
                      >
                        <WrapTextIcon aria-hidden="true" />
                      </Toggle>
                    </TooltipTrigger>
                    <TooltipContent>Wrap code</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div
                id={`${id}-conditions`}
                hidden={section !== "conditions"}
                className="mt-4 space-y-4"
              >
                {drawing ? (
                  <>
                    <div className="alert-drawing-fields grid gap-3">
                      <Field>
                        <FieldLabel>Symbol</FieldLabel>
                        <Input readOnly value={drawing.inputs.listing.symbol} />
                      </Field>
                      <Field>
                        <FieldLabel>Event</FieldLabel>
                        <Input readOnly value="Price" />
                      </Field>
                      <Field>
                        <FieldLabel>Condition</FieldLabel>
                        <Select
                          value={drawing.operator}
                          disabled={!drawingType}
                          onValueChange={(value) => {
                            const operator = drawingOperators.find(
                              (item) => item.value === value,
                            )?.value;
                            if (operator) setDrawing({ ...drawing, operator });
                          }}
                        >
                          <SelectTrigger aria-label="Condition">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {drawingOperators.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel>Value</FieldLabel>
                      <Input readOnly value={drawingName} />
                    </Field>
                  </>
                ) : (
                  <>
                    {indicatorId ? (
                      <Field>
                        <FieldLabel htmlFor={`${id}-input`}>Input</FieldLabel>
                        <Input
                          id={`${id}-input`}
                          readOnly
                          value={indicatorInput}
                        />
                      </Field>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        <Field className="min-w-0 grow basis-40">
                          <FieldLabel>Symbol</FieldLabel>
                          {renderListingPicker({
                            value: marketInputs ?? null,
                            onChange: (series) => {
                              if (series) {
                                definitionEdited.current = true;
                                setMarket(series);
                              }
                            },
                          })}
                        </Field>
                        <Field className="w-28 max-w-full shrink-0">
                          <FieldLabel>Interval</FieldLabel>
                          <Select
                            value={marketInputs?.resolution ?? "1d"}
                            disabled={!marketInputs}
                            onValueChange={(resolution) => {
                              if (marketInputs)
                                setMarket({
                                  ...marketInputs,
                                  resolution: resolution as Resolution,
                                });
                            }}
                          >
                            <SelectTrigger aria-label="Interval">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {[
                                "1s",
                                "1m",
                                "5m",
                                "15m",
                                "30m",
                                "1h",
                                "4h",
                                "1d",
                                "1W",
                                "1M",
                              ].map((value) => (
                                <SelectItem key={value} value={value}>
                                  {value}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                    )}
                    {conditions && (
                      <ConditionsEditor
                        query={conditions}
                        onChange={(query) => {
                          definitionEdited.current = true;
                          setConditions(query);
                          setConditionsChanged(true);
                          setInputError(undefined);
                        }}
                        fields={fields}
                        disabled={disabled || stale}
                      />
                    )}
                  </>
                )}
              </div>
              <div
                id={`${id}-code`}
                hidden={section !== "code"}
                className="mt-4 space-y-4"
              >
                {section === "code" && (
                  <Suspense fallback={<p role="status">Opening editor…</p>}>
                    <CodeEditor
                      language="tea"
                      height="300px"
                      value={source}
                      options={{
                        readOnly: disabled || stale,
                        ariaLabel: "Alert Tea source",
                        wordWrap: wrapCode ? "on" : "off",
                      }}
                      onChange={(value) => {
                        definitionEdited.current = true;
                        setSource(value ?? "");
                        setConditions(null);
                        setConditionsChanged(false);
                        setInputError(undefined);
                      }}
                    />
                    <details>
                      <summary className="cursor-pointer text-sm font-medium">
                        Configuration
                      </summary>
                      <CodeEditor
                        language="json"
                        height="240px"
                        value={configText}
                        options={{
                          readOnly: disabled || stale,
                          ariaLabel: "Alert parameters JSON",
                          wordWrap: wrapCode ? "on" : "off",
                        }}
                        onChange={(value) => {
                          definitionEdited.current = true;
                          setConfigText(value ?? "");
                          setConditions(null);
                          setConditionsChanged(false);
                        }}
                      />
                    </details>
                  </Suspense>
                )}
              </div>
              {section === "chart" && drawing && renderChart ? (
                <div id={`${id}-chart`} className="mt-4 min-w-0">
                  {renderChart(drawing)}
                </div>
              ) : null}
            </div>
          </section>
          {actions.map((action, index) => (
            <AlertActionNode
              key={action.id}
              action={action}
              label={index === 0 ? "Then" : "And"}
              disabled={disabled || stale}
              focus={action.id === focusActionId}
              onRemove={() => {
                setActions((current) =>
                  current.filter((item) => item.id !== action.id),
                );
                const next = actions[index + 1] ?? actions[index - 1];
                setFocusActionId(next?.id);
                if (!next) addButton.current?.focus();
              }}
              onChange={(next) =>
                setActions((current) =>
                  current.map((item) => (item.id === next.id ? next : item)),
                )
              }
              renderPromptEditor={renderPromptEditor}
              onEditorChange={onEditorChange}
              onCancel={onClose}
            />
          ))}
          <div className="alert-workflow-step">
            <div className="alert-workflow-rail col-start-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={addButton}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="alert-workflow-icon"
                    aria-label="Add action"
                    disabled={disabled || stale}
                  >
                    <PlusIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="neutral-controls">
                  <DropdownMenuItem onSelect={() => addAction("notification")}>
                    <BellIcon aria-hidden="true" /> Desktop notification
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => addAction("agent_prompt")}>
                    <BotIcon aria-hidden="true" /> AI agent
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </FieldSet>
        {stale ? (
          <FieldError className="mt-4">
            {ruleUnavailable
              ? "This rule was deleted. Your draft is preserved, but it can no longer be saved."
              : "This rule or its actions changed elsewhere. Close and reopen before saving."}
          </FieldError>
        ) : inputError ? (
          <FieldError className="mt-4">{inputError}</FieldError>
        ) : null}
        {!renderFooter ? footer : null}
      </form>
      {renderFooter?.(footer)}
      <Dialog open={resetting} onOpenChange={setResetting}>
        <DialogContent className="sm:max-w-md lg:max-w-md xl:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset code to default conditions?</DialogTitle>
            <DialogDescription>
              This code cannot be represented as conditions. Continuing replaces
              your code, parameters and child request bindings with a default
              price condition. Your name, frequency and Agent draft are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setResetting(false)}
            >
              Keep code
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={resetConditions}
            >
              Reset to Conditions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditableRuleTitle({
  name,
  authoredName,
  onChange,
  disabled,
  className,
}: {
  name: string;
  authoredName: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const previousName = useRef(authoredName);
  const input = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (restoreFocus.current) {
      title.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);
  const start = () => {
    previousName.current = authoredName;
    setEditing(true);
  };
  return editing ? (
    <Input
      ref={input}
      aria-label="Alert name"
      placeholder="Alert name"
      required
      maxLength={160}
      value={name}
      disabled={disabled}
      aria-invalid={!name.trim()}
      className={cn("h-8 font-studio text-base shadow-none", className)}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => {
        if (name.trim()) setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape" || (event.key === "Enter" && name.trim())) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") onChange(previousName.current);
          restoreFocus.current = true;
          setEditing(false);
        }
      }}
    />
  ) : (
    <Button
      ref={title}
      type="button"
      variant="ghost"
      disabled={disabled}
      className={cn(
        "h-8 min-w-0 shrink justify-start px-0 font-studio text-base",
        className,
      )}
      aria-label={`Rename alert: ${name || "New alert"}`}
      title="Double-click or press Enter to rename"
      onDoubleClick={start}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "F2") {
          event.preventDefault();
          start();
        }
      }}
    >
      <span className="truncate">{name || "Name your alert"}</span>
    </Button>
  );
}

function simpleConfig(
  starter: AlertStarter,
  source: string,
  config: AlertConfig,
): AlertConfig {
  const legacy = starter.legacySources.includes(source);
  const parameters = { ...config.parameters };
  const keys = legacy
    ? ["threshold"]
    : starter.parameters.map((parameter) => parameter.name);
  for (const key of keys) {
    const parameter = starter.parameters.find((item) => item.name === key)!;
    const raw = parameters[key] ?? parameter.defaultValue;
    const value =
      typeof raw === "string" ? (raw.trim() ? Number(raw) : NaN) : raw;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      ("integer" in parameter &&
        parameter.integer &&
        !Number.isSafeInteger(value))
    )
      throw new Error(`Enter a valid ${parameter.label.toLowerCase()}.`);
    parameters[key] = value;
  }
  if (legacy) {
    if (
      !starter.legacyOperators.some(
        (operator) => operator.value === parameters.op,
      )
    )
      throw new Error("Select an alert condition.");
  } else {
    const descriptor = starter.operators.find(
      (item) => item.value === parameters.op,
    );
    if (!descriptor) throw new Error("Select an alert condition.");
    if (
      descriptor.group === "channel" &&
      !(Number(parameters.lower) < Number(parameters.upper))
    )
      throw new Error("The lower bound must be less than the upper bound.");
    if (
      descriptor.group === "movement" &&
      !(Number(parameters.amount) > 0 && Number(parameters.bars) >= 1)
    )
      throw new Error("Enter a positive movement and bar count.");
  }
  return { ...config, parameters };
}
