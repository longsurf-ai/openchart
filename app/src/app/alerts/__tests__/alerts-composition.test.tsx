// Purpose: Chart quick creation and line projection use the same Alertable/editor contracts.
import {
  AuiConfig,
  AuiProvider,
  ModelContextClient,
} from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext, type PropsWithChildren, type ReactNode } from "react";
import { EMPTY } from "rxjs";
import { v2 } from "@openchart/chart-core";
import { Chart } from "@openchart/chart-core/chart/state";
import { ProviderId } from "@openchart/market";
import { beforeAll, afterEach, expect, test, vi } from "vitest";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import {
  encodedBarsInputs,
  type AlertConfig,
  type AlertRule,
  type AlertStarter,
} from "@openchart/app/features/alerts/api/queries";
import { TooltipProvider } from "@openchart/app/components/ui/tooltip";
import { AlertRuleDialog } from "@openchart/app/features/alerts/components/alert-rule-dialog";
import { alertPromptEditor } from "@openchart/app/app/alerts/alert-prompt-editor";
import { ChartAlertsProvider } from "@openchart/app/app/alerts/chart-alerts";
import {
  ChartAlertButton,
  ChartAlertContext,
} from "@openchart/app/features/chart/components/alert-button";
import { createCell } from "@openchart/app/features/chart/api/queries";
import { getMainSeries } from "@openchart/app/features/chart/utils/resource";
import { ChartContext } from "@openchart/app/lib/chart/context";
import {
  createChartStore,
  type ChartRuntime,
} from "@openchart/app/lib/chart/store";
const state = vi.hoisted(() => ({
  transport: undefined as AppTransport | undefined,
}));
vi.mock("@openchart/app/hooks/use-widget", () => ({
  useWidget: () => ({ transport: state.transport }),
}));
vi.mock("@openchart/app/hooks/use-logo", () => ({
  useLogo: () => ({ data: null }),
}));
vi.mock("@openchart/app/features/chart/components/widget", () => ({
  chartWidget: { Provider: ({ children }: PropsWithChildren) => children },
}));
vi.mock("@openchart/app/app/alerts/use-alerts-agent", () => ({
  useAlertsAgent: () => ({
    agent: "analyst",
    model: { providerID: "codex", modelID: "tier1" },
  }),
}));
vi.mock("@openchart/app/app/alerts/alert-listing-picker", () => ({
  renderAlertListingPicker: () => null,
}));
const inputs = {
  provider: "test",
  listing: { symbol: "AAPL", currency: "USD" },
  resolution: "1m",
  session: "regular",
  adjustment: "raw",
} as Extract<AlertRule["alertable"], { kind: "drawing" }>["inputs"];
type TeaRule = Extract<AlertRule["alertable"], { kind: "tea" }>;
// tRPC types stored configs with mutable arrays and branded IDs; fixtures hold the same JSON.
const stored = (config: AlertConfig) => config as unknown as TeaRule["config"];
const starter = {
  id: "price",
  source: "price source",
  label: "Price",
  legacySources: ["legacy price"],
  legacyOperators: [{ value: "crosses", label: "Crosses" }],
  operators: [
    {
      value: "crossing",
      label: "Crossing",
      group: "threshold",
      parameters: ["threshold"],
    },
    {
      value: "inside_channel",
      label: "Inside Channel",
      group: "channel",
      parameters: ["lower", "upper"],
    },
    {
      value: "moving_up",
      label: "Moving Up",
      group: "movement",
      parameters: ["amount", "bars"],
    },
  ],
  parameters: [
    { name: "threshold", defaultValue: 0 },
    { name: "lower", defaultValue: 0 },
    { name: "upper", defaultValue: 1 },
    { name: "amount", defaultValue: 1 },
    { name: "bars", defaultValue: 1 },
  ],
} as unknown as AlertStarter;
const rule = (id: string, source: string, op: string): AlertRule => ({
  id: id as AlertRule["id"],
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  name: id,
  enabled: true,
  repeat: false,
  alertable: {
    kind: "tea",
    source,
    config: stored({
      ...encodedBarsInputs(inputs),
      parameters: {
        ...(source === starter.source
          ? { lower: 0, upper: 1, amount: 1, bars: 1 }
          : {}),
        op,
        threshold: 200,
      },
      requests: {},
    }),
  },
});
/** A rule saved from generated conditions, e.g. by the axis + or the Conditions tab. */
const generated = (
  id: string,
  source: string,
  op: string,
  indicatorId?: string,
): AlertRule => {
  const parameters = {
    c0_op: op,
    c0_threshold: 70,
    c0_lower: 0,
    c0_upper: 1,
  };
  return {
    ...rule(id, source, op),
    alertable: {
      kind: "tea",
      source,
      config: stored(
        indicatorId
          ? { indicatorId, parameters, requests: {} }
          : { ...encodedBarsInputs(inputs), parameters, requests: {} },
      ),
    },
  };
};
/** Stands in for the server's alert_rule.readConditions over this file's fixture sources. */
const readConditions = async ({
  source,
  parameters,
}: {
  source: string;
  parameters: Record<string, unknown>;
}) => {
  const field = {
    [starter.source]: "price",
    "legacy price": "price",
    "generated price": "price",
    "generated histogram": "indicator.histogram",
    "generated two": "price",
    // Same threshold operators as Price, on another scale.
    "rsi source": "rsi",
    "generated volume": "volume",
  }[source];
  if (!field) return null;
  const read = (key: string) =>
    parameters[source.startsWith("generated") ? `c0_${key}` : key];
  const leaf = {
    field,
    operator: read("op"),
    value: {
      threshold: read("threshold"),
      lower: 0,
      upper: 1,
      amount: 1,
      bars: 1,
    },
  };
  return {
    combinator: "and",
    rules: source === "generated two" ? [leaf, leaf] : [leaf],
  };
};
const clients: QueryClient[] = [];
function mount(rules: unknown[] = [], children: ReactNode = <Probe />) {
  const save = vi.fn().mockResolvedValue({ rule: {}, actions: [] });
  const buildConditions = vi.fn().mockResolvedValue({
    source: "generated source",
    parameters: { c0_threshold: 70.25 },
  });
  state.transport = {
    url: "test",
    rpc: {
      resources: {
        macro: { saveAlertRule: { mutate: save } },
        alert_rule: {
          starters: { query: vi.fn().mockResolvedValue([starter]) },
          buildConditions: { query: buildConditions },
          readConditions: { query: vi.fn(readConditions) },
          list: {
            query: vi
              .fn()
              .mockResolvedValue({ items: rules, nextCursor: null }),
          },
        },
        trigger: {
          list: {
            query: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
          },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <AuiProvider config={AuiConfig({ modelContext: ModelContextClient() })}>
        <ChartAlertsProvider>{children}</ChartAlertsProvider>
      </AuiProvider>
    </QueryClientProvider>,
  );
  return { save, buildConditions };
}
function Probe() {
  const alert = useContext(ChartAlertContext)!;
  return (
    <>
      <button
        disabled={alert.pending}
        onClick={() => alert.create({ inputs, threshold: 201 }, true)}
      >
        Create chart alert
      </button>
      <output aria-label="Alert lines">
        {alert.lines
          .map(
            (line) =>
              `${line.id}=${"indicator" in line ? `${line.indicator.indicatorId}.${line.indicator.output}` : line.inputs.listing.symbol}@${line.thresholdParameter}:${line.threshold}`,
          )
          .join(",")}
      </output>
      <output aria-label="Drawing alerts">
        {alert.drawingAlerts
          ?.map((rule) => `${rule.id}:${rule.drawingId}`)
          .join(",")}
      </output>
    </>
  );
}
beforeAll(() => {
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: MouseEvent,
  });
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.clearAllMocks();
});
test("chart quick creation atomically stores crossing source, clicked series and Agent defaults", async () => {
  const { save } = mount();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Create chart alert" }),
    ).toBeEnabled(),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Create chart alert" }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]![0]).toMatchObject({
    value: {
      enabled: true,
      repeat: false,
      alertable: {
        kind: "tea",
        source: starter.source,
        config: {
          ...encodedBarsInputs(inputs),
          parameters: {
            op: "crossing",
            threshold: 201,
            lower: 0,
            upper: 1,
            amount: 1,
            bars: 1,
          },
          requests: {},
        },
      },
    },
    actions: [
      {
        target: { kind: "notification", message: "{symbol} {title}: {value}" },
      },
      {
        target: {
          kind: "agent_prompt",
          prompt: {
            agent: "analyst",
            model: { providerID: "codex", modelID: "tier1" },
            parts: [
              {
                type: "text",
                text: "Explain this move from this alert: {message}",
              },
            ],
          },
        },
      },
    ],
  });
});
test("only one projected threshold condition on price or an Indicator output becomes a chart line", async () => {
  const warn = vi.spyOn(console, "warn");
  const drawing = (id: string): AlertRule => ({
    ...rule(id, starter.source, "crossing"),
    alertable: {
      kind: "drawing",
      drawingId: `drw_${id}` as Extract<
        AlertRule["alertable"],
        { kind: "drawing" }
      >["drawingId"],
      inputs,
      operator: "crossing",
    },
  });
  const tsla = rule("tsla", starter.source, "crossing");
  mount([
    rule("threshold", starter.source, "crossing"),
    // Same source and parameters on another market: one shared projection.
    {
      ...tsla,
      alertable: {
        ...(tsla.alertable as TeaRule),
        config: {
          ...(tsla.alertable as TeaRule).config,
          ...encodedBarsInputs({
            ...inputs,
            listing: { symbol: "TSLA", currency: "USD" },
          }),
        },
      },
    },
    // Bars inputs on two markets share no market, so price draws no line.
    {
      ...rule("mixed", starter.source, "crossing"),
      alertable: {
        kind: "tea",
        source: starter.source,
        config: {
          ...encodedBarsInputs(inputs),
          inputs: {
            ...encodedBarsInputs(inputs).inputs,
            spy: encodedBarsInputs({
              ...inputs,
              listing: { symbol: "SPY", currency: "USD" },
            }).inputs.bars,
          },
          parameters: { op: "crossing", threshold: 200 },
          requests: {},
        },
      },
    },
    rule("legacy", "legacy price", "crosses"),
    rule("channel", starter.source, "inside_channel"),
    rule("custom", "custom source", "crossing"),
    rule("rsi", "rsi source", "crossing"),
    generated("volume", "generated volume", "crossing"),
    generated("conditions", "generated price", "crossing"),
    // The shape the axis + saves for an Indicator output.
    generated("follows", "generated histogram", "crossing", "ind_ao"),
    generated("two", "generated two", "crossing"),
    generated("moving", "generated histogram", "moving_up", "ind_ao"),
    {
      ...generated("disabled", "generated histogram", "crossing", "ind_ao"),
      enabled: false,
    },
    {
      ...rule("indicator", starter.source, "crossing"),
      alertable: {
        kind: "tea",
        source: starter.source,
        config: {
          indicatorId: "ind_rsi",
          parameters: { op: "crossing", threshold: 70 },
          requests: {},
        },
      },
    },
    drawing("saved"),
    drawing("another"),
  ]);
  // Starters keep `threshold`; generated single conditions hold it in c0_threshold.
  await waitFor(() =>
    expect(screen.getByLabelText("Alert lines")).toHaveTextContent(
      /^threshold=AAPL@threshold:200,tsla=TSLA@threshold:200,legacy=AAPL@threshold:200,conditions=AAPL@c0_threshold:70,follows=ind_ao\.histogram@c0_threshold:70$/,
    ),
  );
  expect(screen.getByLabelText("Drawing alerts")).toHaveTextContent(
    "saved:drw_saved,another:drw_another",
  );
  expect(warn).not.toHaveBeenCalledWith(
    expect.stringContaining("Duplicate Queries"),
  );
  warn.mockRestore();
});
test("the axis + in an Indicator pane offers its alertable outputs and saves a rule that follows the Indicator", async () => {
  const base = createCell(
    {
      provider: ProviderId.make("test"),
      listing: { symbol: "AAPL", currency: "USD" },
    },
    { resolution: "1m", session: "regular", adjustment: "raw" },
  );
  const output = (id: string, name: string) => ({
    id,
    role: "normal",
    source: { kind: "indicator", indicatorId: "ind_rsi", output: name },
  });
  const cell = {
    ...base,
    panes: [
      ...base.panes,
      {
        id: "pan_rsi",
        series: [output("srs_rsi", "rsi"), output("srs_level", "overbought")],
      },
    ],
  } as typeof base;
  const main = getMainSeries(cell);
  const chartState = v2.createState({ id: cell.id });
  v2.ChartStateUtils.addSeries(chartState, { id: main.id, type: "Line" });
  v2.ChartStateModel.getSeriesObject(chartState, main.id)!.role = "main";
  for (const [id, values] of [
    ["srs_rsi", [40, 60]],
    ["srs_level", [70, 70]],
  ] as const)
    v2.ChartStateUtils.addSeries(chartState, {
      id,
      type: "Line",
      pane: 1,
      yAxisId: "pane:pan_rsi",
      data: values.map((value, time) => ({ time, value })),
    });
  const store = createChartStore(chartState);
  const { width, height } = chartState.config.chart.dimensions;
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
  const chart: ChartRuntime = {
    id: cell.id,
    store,
    renderer: {
      canvas,
      seriesValueAtY: (id: string) => (id === "srs_rsi" ? 70.25 : 70),
    } as unknown as v2.ChartRenderer,
    output$: EMPTY,
    mutate: (recipe) => store.setState(recipe, true),
  };
  const { save, buildConditions } = mount(
    [],
    <TooltipProvider>
      <ChartContext.Provider value={chart}>
        <section data-chart-cell={cell.id}>
          <div ref={(node) => node?.append(canvas)} />
          {/* IndicatorSource registers only numeric and plot outputs, not the horizontal line. */}
          <ChartAlertButton
            cell={cell}
            alertable={new Map([["ind_rsi", new Set(["rsi"])]])}
          />
        </section>
      </ChartContext.Provider>
    </TooltipProvider>,
  );
  const layout = Chart.computeLayout(chartState.config);
  const pane = v2.ChartPaneLayout.paneLayouts(
    chartState.panes,
    layout.areaHeight,
  )[1]!;
  fireEvent(
    canvas,
    new MouseEvent("pointermove", {
      bubbles: true,
      clientX: layout.areaX + layout.areaWidth - 10,
      clientY: pane.top + pane.height / 2,
    }),
  );
  // The pointer stays at the axis; the keyboard opens the frozen menu.
  act(() => screen.getByRole("button", { name: "Add alert at 70.25" }).focus());
  await userEvent.keyboard("{Enter}");
  expect(
    screen.queryByRole("group", { name: /overbought/ }),
  ).not.toBeInTheDocument();
  const item = within(
    screen.getByRole("group", { name: "rsi · 70.25" }),
  ).getByRole("menuitem", { name: "Add alert at threshold" });
  await waitFor(() => expect(item).not.toHaveAttribute("aria-disabled"));
  await userEvent.click(item);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(buildConditions).toHaveBeenCalledWith({
    query: {
      combinator: "and",
      rules: [
        {
          field: "indicator.rsi",
          operator: "crossing",
          value: expect.objectContaining({ threshold: 70.25 }),
        },
      ],
    },
  });
  expect(save.mock.calls[0]![0]).toMatchObject({
    value: {
      name: "AAPL rsi Crossing 70.25",
      alertable: {
        kind: "tea",
        source: "generated source",
        config: {
          indicatorId: "ind_rsi",
          parameters: { c0_threshold: 70.25 },
          requests: {},
        },
      },
    },
    actions: [{ target: { kind: "notification" } }],
  });
  // Following the Indicator, the rule names no inputs; the server builds them from its cell.
  expect(save.mock.calls[0]![0].value.alertable.config).not.toHaveProperty(
    "inputs",
  );
});

/** Rename through the If title, the editor's only name control. */
async function rename(current: string | RegExp, next: string) {
  await userEvent.dblClick(
    await screen.findByRole("button", {
      name: typeof current === "string" ? `Rename alert: ${current}` : current,
    }),
  );
  const input = screen.getByRole("textbox", { name: "Alert name" });
  await userEvent.clear(input);
  await userEvent.type(input, `${next}{Enter}`);
}

function mountUnsupportedPrompt(agentEnabled: boolean) {
  const saved = rule("alr_saved", starter.source, "crossing");
  const parts = [
    { type: "text", text: "First saved instruction" },
    { type: "text", text: "Second saved instruction" },
  ];
  const target = {
    kind: "agent_prompt",
    binding: { key: "alert:saved" },
    prompt: {
      agent: "analyst",
      model: { providerID: "codex", modelID: "tier1" },
      parts,
    },
  };
  const actions = [
    {
      id: "trg_notification",
      revision: 1,
      name: "Notification",
      enabled: true,
      event: { kind: "alert", ruleId: saved.id },
      target: { kind: "notification", message: "Original notification" },
    },
    {
      id: "trg_agent",
      revision: 2,
      name: "Saved Agent",
      enabled: agentEnabled,
      event: { kind: "alert", ruleId: saved.id },
      target,
    },
  ];
  const save = vi.fn().mockResolvedValue({ rule: saved, actions });
  const transport = {
    url: "unsupported-prompt-test",
    rpc: {
      resources: {
        macro: { saveAlertRule: { mutate: save } },
        alert_rule: {
          starters: { query: vi.fn().mockResolvedValue([starter]) },
        },
        trigger: {
          list: {
            query: vi
              .fn()
              .mockResolvedValue({ items: actions, nextCursor: null }),
          },
        },
      },
    },
  } as unknown as AppTransport;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <AuiProvider config={AuiConfig({ modelContext: ModelContextClient() })}>
        <TooltipProvider>
          <AlertRuleDialog
            transport={transport}
            rule={saved}
            renderListingPicker={() => <button type="button">AAPL</button>}
            renderPromptEditor={alertPromptEditor(transport)}
            onClose={() => {}}
          />
        </TooltipProvider>
      </AuiProvider>
    </QueryClientProvider>,
  );
  return { save, target };
}

test("a disabled unsupported Agent prompt leaves Edit usable and saves its original Parts intact", async () => {
  const { save, target } = mountUnsupportedPrompt(false);
  expect(
    await screen.findByText(
      "This saved prompt cannot be edited in the composer.",
    ),
  ).toBeVisible();
  await rename(/^Rename alert:/, "Updated notification rule");
  expect(screen.getByRole("button", { name: "Paused · Enable" })).toBeVisible();
  const submit = screen.getByRole("button", { name: "Save rule" });
  expect(submit).toBeEnabled();
  await userEvent.click(submit);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]![0].value.name).toBe("Updated notification rule");
  expect(save.mock.calls[0]![0].actions[1]).toMatchObject({
    enabled: false,
    target,
  });
});

test("an enabled unsupported Agent prompt shows its restore failure and blocks Save until removed", async () => {
  const { save } = mountUnsupportedPrompt(true);
  expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  expect(
    screen.getByText("This saved prompt cannot be edited in the composer."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Save rule" })).toBeDisabled();

  await rename(/^Rename alert:/, "Keep notification only");
  await userEvent.click(
    screen.getByRole("button", { name: "Remove Analyze with Codex" }),
  );
  expect(screen.getByRole("button", { name: "Save rule" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Save rule" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]![0].actions).toHaveLength(1);
  expect(save.mock.calls[0]![0].removedActions).toHaveLength(1);
});
