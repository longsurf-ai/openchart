// Purpose: Present saved event facts without consulting current Rule definitions or market inputs.
import type { AlertEvent } from "../api/queries";

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value))
    return value.toLocaleString("en-US", { maximumSignificantDigits: 21 });
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function field(value: unknown, key: string): unknown {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

const thresholdOperators = new Set([
  "exceeds",
  "below",
  "crosses",
  "crossing",
  "crossing_up",
  "crossing_down",
  "greater_than",
  "less_than",
]);

/**
 * Format only saved scalar facts; missing facts stay absent. An explicit value
 * wins over values.value. A single threshold parameter is shown only for a
 * threshold operator; composite conditions retain their full JSON in details.
 * Pure presentation with no I/O, cleanup or failure effects.
 * @example const facts = alertEventFacts(event);
 */
export function alertEventFacts(event: AlertEvent) {
  const { data } = event.detail;
  const parameters = data.parameters;
  const operator = field(parameters, "op");
  const generatedOperator = field(parameters, "c0_op");
  const hasOtherConditions =
    parameters &&
    typeof parameters === "object" &&
    Object.keys(parameters).some((key) => /^c[1-9]\d*_/.test(key));
  const threshold =
    scalar(data.threshold) ??
    (operator === undefined ||
    (typeof operator === "string" && thresholdOperators.has(operator))
      ? scalar(field(parameters, "threshold"))
      : undefined) ??
    (!hasOtherConditions &&
    typeof generatedOperator === "string" &&
    thresholdOperators.has(generatedOperator)
      ? scalar(field(parameters, "c0_threshold"))
      : undefined);
  return {
    value: scalar(data.value) ?? scalar(field(data.values, "value")),
    threshold,
    symbol: scalar(data.symbol),
    provider: scalar(data.provider),
    resolution: scalar(data.resolution),
  };
}

/**
 * Group an already ordered page sequence by the selected display calendar day.
 * Occurrence time supplies labels, never the row's creation time. Calendar
 * arithmetic keeps Yesterday correct across daylight-saving changes.
 * Local defaults to the device zone; callers supply a valid IANA zone or UTC.
 * Pure; callers choose when to refresh the current date.
 * @example const groups = groupAlertEvents(events, new Date(), "America/New_York");
 */
export function groupAlertEvents(
  events: readonly AlertEvent[],
  now: Date,
  timezone = "local",
) {
  const timeZone = timezone === "local" ? undefined : timezone;
  const dateOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  } as const;
  const date = new Intl.DateTimeFormat("en-US", { ...dateOptions, timeZone });
  const today = date.format(now);
  // Subtract a calendar day from the selected zone's date, not 24 elapsed hours
  // from the instant: DST can make yesterday 23 or 25 hours long.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((value) => value.type === type)!.value);
  const yesterday = new Intl.DateTimeFormat("en-US", {
    ...dateOptions,
    timeZone: "UTC",
  }).format(Date.UTC(part("year"), part("month") - 1, part("day") - 1));
  const groups = new Map<
    string,
    { key: string; label: string; events: AlertEvent[] }
  >();
  for (const event of events) {
    const day = date.format(event.time);
    let group = groups.get(day);
    if (!group) {
      const prefix =
        day === today ? "Today · " : day === yesterday ? "Yesterday · " : "";
      group = {
        key: day,
        label: `${prefix}${day}`,
        events: [],
      };
      groups.set(day, group);
    }
    group.events.push(event);
  }
  return [...groups.values()];
}
