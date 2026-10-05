// Purpose: Derive ordinal, normal-price Tea boundaries from the current Drawing Resource.
import {
  FIB_CHANNEL_LEVELS,
  FIB_RETRACEMENT_LEVELS,
} from "@openchart/chart-core/drawing/geometry";
import { drawingBoundary } from "@openchart/chart-core/drawing/boundary";
import type { DrawingAlertDefinition } from "@openchart/server/resources/alert-rule/schema";
import type { DrawingEntity } from "@openchart/server/resources/drawing";
import * as Tea from "@openchart/tea";
import {
  drawingBoundarySource,
  MAX_DRAWING_BOUNDARY_ANCHORS,
} from "./drawing-boundary-source";

const source = (ratios: readonly number[]) =>
  [
    'kind = input.string("extended_line", "Drawing kind")',
    'op = input.string("crossing", "Condition")',
    ...[1, 2, 3].flatMap((anchor) => [
      `t${anchor} = input.float(0.0, "Anchor ${anchor} time")`,
      `p${anchor} = input.float(0.0, "Anchor ${anchor} price")`,
      `var float actual${anchor} = na`,
      `if na(actual${anchor})`,
      `    if time == t${anchor}`,
      `        actual${anchor} := bar_index`,
      `    else if not na(time[1]) and time[1] < t${anchor} and time > t${anchor}`,
      `        actual${anchor} := t${anchor} - time[1] <= time - t${anchor} ? bar_index - 1 : bar_index`,
      `q${anchor} = na(actual${anchor}) and t${anchor} > time and not na(time[1]) and time > time[1] ? bar_index + (t${anchor} - time) / (time - time[1]) : actual${anchor}`,
    ]),
    'horizontal = kind == "horizontal_line" or kind == "horizontal_ray"',
    'retracement = kind == "fib_retracement"',
    'channel = kind == "parallel_channel" or kind == "fib_channel"',
    "slope = horizontal or retracement ? 0.0 : (p2 - p1) / (q2 - q1)",
    "level = horizontal or retracement ? p1 : p1 + slope * (bar_index - q1)",
    "offset = retracement ? p2 - p1 : p3 - (p1 + slope * (q3 - q1))",
    "other = level + offset",
    "lower = level < other ? level : other",
    "upper = level > other ? level : other",
    'ready = kind == "horizontal_line" or (not na(q1) and (horizontal or (not na(q2) and (retracement ? p1 != p2 : q1 != q2))) and (not channel or (not na(q3) and offset != 0)))',
    ...[
      ["extent", "bar_index"],
      ["previous_extent", "(bar_index - 1)"],
    ].map(
      ([name, index]) =>
        `${name} = kind == "trend_line" ? ${index} >= math.min(q1, q2) and ${index} <= math.max(q1, q2) : kind == "ray" ? (q2 > q1 ? ${index} >= q1 : ${index} <= q1) : kind == "horizontal_ray" ? ${index} >= q1 : retracement ? ${index} >= math.min(q1, q2) : true`,
    ),
    "valid = ready and extent",
    // Resolve both samples from the same geometry, even when its last anchor is
    // first observed on the current bar. A previous computed level can be NaN.
    "previous_valid = ready and previous_extent and not na(close[1])",
    ...ratios.flatMap((ratio, index) => [
      `boundary${index} = ${ratio === 0 ? "level" : `level + offset * ${ratio}`}`,
      `distance${index} = close - boundary${index}`,
      `previous_distance${index} = close[1] - (boundary${index} - slope)`,
      `up${index} = valid and previous_valid and previous_distance${index} < 0 and distance${index} >= 0`,
      `down${index} = valid and previous_valid and previous_distance${index} > 0 and distance${index} <= 0`,
      `crossed${index} = op == "crossing_up" ? up${index} : op == "crossing_down" ? down${index} : up${index} or down${index}`,
    ]),
    `crossing = ${ratios.map((_, index) => `crossed${index}`).join(" or ")}`,
    "inside_channel = valid and close > lower and close < upper",
    "outside_channel = valid and (close < lower or close > upper)",
    "entering_channel = valid and previous_valid and (close[1] < lower - slope or close[1] > upper - slope) and close >= lower and close <= upper",
    "exiting_channel = valid and previous_valid and close[1] >= lower - slope and close[1] <= upper - slope and outside_channel",
    'condition = op == "crossing" or op == "crossing_up" or op == "crossing_down" ? crossing : op == "entering_channel" ? entering_channel : op == "exiting_channel" ? exiting_channel : op == "inside_channel" ? inside_channel : outside_channel',
    'emit "ready" ready ? 1.0 : 0.0',
    'emit "value" close',
    'emit "level" level',
    'emit "lower" channel or retracement ? lower : level',
    'emit "upper" channel or retracement ? upper : level',
    // One occurrence per confirmed bar, with every crossed Fibonacci boundary in its saved facts.
    ...(ratios.length > 1
      ? ratios.map(
          (ratio, index) =>
            `emit "crossed_level_${ratio}" crossed${index} ? boundary${index} : na`,
        )
      : []),
    'alertcondition("alert", barstate.isconfirmed and condition, "Drawing alert", "Price met its drawing condition")',
  ].join("\n");

/**
 * Derive an inert Tea definition from authoritative drawing anchors. Observation
 * must cover historical `from` with a preceding bar and establish two recent bars
 * for future projection. `readyOutput` must equal 1; missing historical anchors fail.
 * The authoring boundary owns normal-price/main-axis/ordinal-X restrictions.
 * Fibonacci rules cross any painted ratio; one occurrence records all crossed boundaries.
 * Throws TeaError for unsupported geometry, mismatched markets or conditions.
 * @example const execution = drawingTeaDefinition(drawing, rule.alertable);
 */
export function drawingTeaDefinition(
  drawing: DrawingEntity,
  definition: DrawingAlertDefinition,
): {
  source: string;
  config: Tea.NodeConfig;
  from?: number;
  warmupBars: number;
  readyOutput: string;
} {
  const { data, provider, listing } = drawing;
  const boundary = drawingBoundary(data);
  const input = definition.inputs;
  const invalid = (message: string): never => {
    throw new Tea.Error({ code: "invalid_request", message });
  };
  if (
    drawing.id !== definition.drawingId ||
    provider !== input.provider ||
    listing.symbol !== input.listing.symbol ||
    listing.venue !== input.listing.venue ||
    listing.currency !== input.listing.currency
  )
    invalid("Drawing and alert must refer to the same drawing and market");
  const horizontal =
    data.type === "horizontal_line" || data.type === "horizontal_ray";
  const retracement = data.type === "fib_retracement";
  const channel =
    data.type === "parallel_channel" || data.type === "fib_channel";
  if (
    !horizontal &&
    !retracement &&
    !channel &&
    !boundary &&
    data.type !== "trend_line" &&
    data.type !== "ray" &&
    data.type !== "extended_line"
  )
    invalid("This drawing kind does not support alerts");
  if (
    boundary
      ? definition.operator !== "crossing" && definition.operator !== "touching"
      : definition.operator === "touching" ||
        (data.type === "parallel_channel") !==
          definition.operator.endsWith("_channel")
  )
    invalid("Choose a condition supported by this drawing kind");
  const anchors = boundary
    ? data.anchors
    : data.anchors.slice(0, horizontal ? 1 : channel ? 3 : 2);
  if (!boundary && anchors.length !== (horizontal ? 1 : channel ? 3 : 2))
    invalid("Drawing anchors are incomplete");
  if (new Set(anchors.flatMap((anchor) => anchor.axisId ?? [])).size > 1)
    invalid("Drawing alert anchors must share the same price axis");
  // Parsed anchors already hold bounded epoch seconds and finite prices.
  const times = anchors.map((anchor) => {
    if (
      boundary &&
      (Math.abs(anchor.price) > 1e70 ||
        (anchor.price !== 0 && Math.abs(anchor.price) < 1e-70))
    )
      return invalid(
        "Drawing prices exceed the supported Float64 geometry range",
      );
    return anchor.time * 1000;
  });
  if (!boundary && !horizontal && !retracement && times[0] === times[1])
    invalid("Drawing alert line anchors need distinct times");
  if (boundary && anchors.length > MAX_DRAWING_BOUNDARY_ANCHORS)
    invalid(
      `Drawing alerts support up to ${MAX_DRAWING_BOUNDARY_ANCHORS.toLocaleString("en-US")} points; this drawing has ${anchors.length.toLocaleString("en-US")}`,
    );
  if (boundary)
    return {
      source: drawingBoundarySource(boundary, times),
      config: {
        ...Tea.barsInputs(input),
        parameters: { op: definition.operator },
        requests: {},
      },
      from: Math.floor(
        times.reduce((earliest, time) => Math.min(earliest, time), Infinity),
      ),
      readyOutput: "ready",
      warmupBars: 2,
    };
  return {
    source: source(
      retracement
        ? FIB_RETRACEMENT_LEVELS
        : data.type === "fib_channel"
          ? FIB_CHANNEL_LEVELS
          : [0],
    ),
    config: {
      ...Tea.barsInputs(input),
      parameters: {
        kind: data.type,
        op: definition.operator,
        ...Object.fromEntries(
          [0, 1, 2].flatMap((index) => [
            [`t${index + 1}`, times[index] ?? times[0]!],
            [`p${index + 1}`, (anchors[index] ?? anchors[0]!).price],
          ]),
        ),
      },
      requests: {},
    },
    ...(data.type === "horizontal_line"
      ? {}
      : { from: Math.floor(Math.min(...times)) }),
    readyOutput: "ready",
    warmupBars: data.type === "horizontal_line" ? 1 : 2,
  };
}
