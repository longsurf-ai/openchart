// Purpose: Bundle saved Tea templates and their Simple editor parameter metadata.

/** Parameter names shared by new templates. @example const threshold = parameters[alertStarterParameters.threshold]; */
export const alertStarterParameters = {
  operator: "op",
  threshold: "threshold",
  lower: "lower",
  upper: "upper",
  amount: "amount",
  bars: "bars",
} as const;

const legacyAlertStarterOperators = [
  { value: "exceeds", label: "Exceeds" },
  { value: "below", label: "Falls below" },
  { value: "crosses", label: "Crosses" },
] as const;

/** Form metadata for the 13 conditions; source remains the execution definition.
 * @example const thresholds = alertStarterOperators.filter((op) => op.group === "threshold");
 */
export const alertStarterOperators = [
  {
    value: "crossing",
    label: "Crossing",
    group: "threshold",
    parameters: ["threshold"],
  },
  {
    value: "crossing_up",
    label: "Crossing Up",
    group: "threshold",
    parameters: ["threshold"],
  },
  {
    value: "crossing_down",
    label: "Crossing Down",
    group: "threshold",
    parameters: ["threshold"],
  },
  {
    value: "greater_than",
    label: "Greater Than",
    group: "threshold",
    parameters: ["threshold"],
  },
  {
    value: "less_than",
    label: "Less Than",
    group: "threshold",
    parameters: ["threshold"],
  },
  {
    value: "entering_channel",
    label: "Entering Channel",
    group: "channel",
    parameters: ["lower", "upper"],
  },
  {
    value: "exiting_channel",
    label: "Exiting Channel",
    group: "channel",
    parameters: ["lower", "upper"],
  },
  {
    value: "inside_channel",
    label: "Inside Channel",
    group: "channel",
    parameters: ["lower", "upper"],
  },
  {
    value: "outside_channel",
    label: "Outside Channel",
    group: "channel",
    parameters: ["lower", "upper"],
  },
  {
    value: "moving_up",
    label: "Moving Up",
    group: "movement",
    parameters: ["amount", "bars"],
    unit: "absolute",
  },
  {
    value: "moving_down",
    label: "Moving Down",
    group: "movement",
    parameters: ["amount", "bars"],
    unit: "absolute",
  },
  {
    value: "moving_up_percent",
    label: "Moving Up %",
    group: "movement",
    parameters: ["amount", "bars"],
    unit: "percent",
  },
  {
    value: "moving_down_percent",
    label: "Moving Down %",
    group: "movement",
    parameters: ["amount", "bars"],
    unit: "percent",
  },
] as const;

const parameters = [
  { name: "threshold", label: "Threshold", defaultValue: 0 },
  { name: "lower", label: "Lower bound", defaultValue: 0 },
  { name: "upper", label: "Upper bound", defaultValue: 1 },
  {
    name: "amount",
    label: "Change",
    defaultValue: 1,
    minimum: 0,
    exclusiveMinimum: true,
  },
  { name: "bars", label: "Bars", defaultValue: 1, minimum: 1, integer: true },
] as const;

// Kept byte-for-byte so existing stored scripts can still be identified. They
// retain their historical strict ta.cross semantics and two-parameter config.
const legacyStarter = (id: string, label: string, series: string) => ({
  id,
  label,
  source: [
    "import ta",
    'op = input.string("exceeds", "Operator", ["exceeds", "below", "crosses"])',
    'threshold = input.float(0.0, "Threshold")',
    `value = ${series}`,
    "exceeds = value > threshold",
    "below = value < threshold",
    "crosses = ta.cross(value, threshold)",
    'emit "value" value',
    `alertcondition("alert", op == "exceeds" ? exceeds : op == "below" ? below : crosses, "${label}", "${label} met its threshold condition")`,
  ].join("\n"),
  operators: legacyAlertStarterOperators,
});

const starter = (id: string, label: string, series: string) => ({
  id,
  label,
  source: [
    "import ta",
    `op = input.string("greater_than", "Operator", [${alertStarterOperators.map((op) => JSON.stringify(op.value)).join(", ")}])`,
    'threshold = input.float(0.0, "Threshold")',
    'lower = input.float(0.0, "Lower bound")',
    'upper = input.float(1.0, "Upper bound")',
    'amount = input.float(1.0, "Change", minval = 0.0)',
    'bars = input.int(1, "Bars", minval = 1)',
    `value = ${series}`,
    "previous = value[1]",
    "crossing_up = not na(previous) and previous < threshold and value >= threshold",
    "crossing_down = not na(previous) and previous > threshold and value <= threshold",
    "crossing = crossing_up or crossing_down",
    "greater_than = value > threshold",
    "less_than = value < threshold",
    "channel_valid = lower < upper",
    "inside_channel = channel_valid and value > lower and value < upper",
    "outside_channel = channel_valid and (value < lower or value > upper)",
    "entering_channel = channel_valid and not na(previous) and (previous < lower or previous > upper) and value >= lower and value <= upper",
    "exiting_channel = channel_valid and not na(previous) and previous >= lower and previous <= upper and outside_channel",
    "change = ta.change(value, bars)",
    "percent = value[bars] == 0 ? na : ta.roc(value, bars)",
    "moving_up = amount > 0 and change >= amount",
    "moving_down = amount > 0 and change <= -amount",
    "moving_up_percent = amount > 0 and percent >= amount",
    "moving_down_percent = amount > 0 and percent <= -amount",
    `condition = ${alertStarterOperators.map((operator) => `op == "${operator.value}" ? ${operator.value} : `).join("")}false`,
    'emit "value" value',
    `alertcondition("alert", condition, "${label}", "${label} met its condition")`,
  ].join("\n"),
  operators: alertStarterOperators,
  parameters,
  legacySources: [legacyStarter(id, label, series).source],
  legacyOperators: legacyAlertStarterOperators,
});

/**
 * Three exact-source Simple projections. Saved bytes never follow catalog
 * updates. Crossings include arrival at the threshold; inside/outside are
 * strict. Enter/exit require a sampled point in the closed channel, so a jump
 * across both boundaries does neither. Movement compares with exactly N bars
 * ago and includes equality; absent history and a zero percentage base do not
 * fire. These explicit edge policies are not a claim of full TradingView parity.
 * @example const price = alertStarters.find((starter) => starter.id === "price");
 */
export const alertStarters = [
  starter("price", "Price", "close"),
  starter("volume", "Volume", "volume"),
  starter("rsi", "RSI (14)", "ta.rsi(close, 14)"),
];

/**
 * A rule that follows an Indicator reads its outputs as columns with this
 * prefix, `indicator.<output>`; see followIndicatorNodes.
 */
export const indicatorPrefix = "indicator.";

/**
 * The starter body over one followed Indicator output, `indicator.<output>`.
 * Only generated conditions use it; it is never a saved starter source.
 * @example const body = indicatorStarter("indicator.rsi").source;
 */
export function indicatorStarter(field: `indicator.${string}`) {
  return starter(
    "indicator",
    field.slice(indicatorPrefix.length),
    `input.series(${JSON.stringify(field)})`,
  );
}

/** Minimum starter history; advanced scripts get Tea's standard warmup.
 * @example const warmup = alertStarterWarmup(source, parameters);
 */
export function alertStarterWarmup(
  source: string,
  config: Readonly<Record<string, string | number | boolean>>,
): number {
  const starter = alertStarters.find((starter) => starter.source === source);
  if (!starter) return 0;
  const bars = config.bars;
  return (
    (starter.id === "rsi" ? 15 : 1) +
    (typeof bars === "number" && Number.isSafeInteger(bars) && bars > 0
      ? bars
      : 0)
  );
}

/** Validate interdependent Simple inputs after matching the exact saved source.
 * Unknown custom sources belong to the Tea compiler and are not interpreted.
 * @example const error = validateAlertStarterParameters(source, config.parameters);
 */
export function validateAlertStarterParameters(
  source: string,
  values: Readonly<Record<string, string | number | boolean>>,
): string | null {
  if (!alertStarters.some((starter) => starter.source === source)) return null;
  return validateStarterValues(values);
}

/** Validate interdependent starter inputs: operator, channel bounds and movement.
 * @example const error = validateStarterValues({ op: "greater_than", threshold: 70 });
 */
export function validateStarterValues(
  values: Readonly<Record<string, string | number | boolean>>,
): string | null {
  const operator = alertStarterOperators.find(
    (operator) => operator.value === values.op,
  );
  if (!operator) return "Choose a supported alert condition";
  if (
    operator.group === "channel" &&
    !(
      typeof values.lower === "number" &&
      typeof values.upper === "number" &&
      values.lower < values.upper
    )
  )
    return "Lower bound must be less than upper bound";
  if (operator.group === "movement") {
    if (!(
      typeof values.amount === "number" &&
      Number.isFinite(values.amount) &&
      values.amount > 0
    ))
      return "Change must be positive";
    if (!(
      typeof values.bars === "number" &&
      Number.isSafeInteger(values.bars) &&
      values.bars > 0
    ))
      return "Bars must be a positive integer";
  }
  return null;
}
