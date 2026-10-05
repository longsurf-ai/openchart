// Purpose: Project a bounded condition tree onto standalone Tea, without a second saved definition.
import { Schema } from "effect";
import * as Tea from "@openchart/tea";
import {
  alertStarters,
  indicatorPrefix,
  indicatorStarter,
  validateStarterValues,
} from "./starters";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;

const values = Schema.Struct({
  threshold: Schema.Finite,
  lower: Schema.Finite,
  upper: Schema.Finite,
  amount: Schema.Finite,
  bars: Schema.Finite,
}).annotate(strict);
/** A followed Indicator's output; quotes, backslashes and controls cannot reach Tea source. */
const indicatorField = Schema.TemplateLiteral([
  indicatorPrefix,
  Schema.String,
]).check(Schema.isPattern(/^indicator\.[^"\\\p{Cc}]{1,128}$/u));
const leaf = Schema.Struct({
  field: Schema.Union([
    Schema.Literals(["price", "volume", "rsi"]),
    indicatorField,
  ]),
  operator: Schema.String,
  value: values,
}).annotate(strict);
/** Editable values retain the complete starter parameter set. */
export type ConditionRule = typeof leaf.Type;
/** Recursive AND/OR structure; runtime schemas validate all leaves. */
export interface ConditionGroup {
  readonly combinator: "and" | "or";
  readonly rules: readonly (ConditionRule | ConditionGroup)[];
}
/** Boundary for the visual builder; UI-only IDs are not execution state. */
export const ConditionQuery: Schema.Codec<ConditionGroup> = Schema.Struct({
  combinator: Schema.Literals(["and", "or"]),
  rules: Schema.Array(
    Schema.Union([leaf, Schema.suspend(() => ConditionQuery)]),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
}).annotate(strict);
const decodeQuery = Schema.decodeUnknownSync(ConditionQuery);
const defaults = { threshold: 0, lower: 0, upper: 1, amount: 1, bars: 1 };
const end =
  'alertcondition("alert", condition, "Market conditions matched", "The configured market conditions matched")';

function invalid(message: string): never {
  throw new Tea.Error({ code: "invalid_request", message });
}

function block(rule: ConditionRule, index: number) {
  const indicator = rule.field.startsWith(indicatorPrefix);
  const starter = indicator
    ? indicatorStarter(rule.field as `indicator.${string}`)
    : alertStarters.find((entry) => entry.id === rule.field)!;
  const legacy =
    !indicator &&
    starter.legacyOperators.some((op) => op.value === rule.operator);
  if (!legacy && !starter.operators.some((op) => op.value === rule.operator))
    return invalid("Choose a supported condition operator.");
  const parameters = { ...rule.value, op: rule.operator };
  const error = legacy ? null : validateStarterValues(parameters);
  if (error) return invalid(error);
  const source = legacy ? starter.legacySources[0]! : starter.source;
  const body = source.slice(
    "import ta\n".length,
    source.indexOf('\nemit "value"'),
  );
  const names = [...body.matchAll(/^(\w+) = /gm)].map((match) => match[1]!);
  const pattern = new RegExp(`(?<!\\.)\\b(${names.join("|")})\\b`, "g");
  // Rename identifiers only, never the string values of input options.
  const renamed = body
    .split(/("(?:\\.|[^"\\])*")/g)
    .map((part, i) => (i % 2 ? part : part.replace(pattern, `c${index}_$1`)))
    .join("");
  const condition = legacy
    ? `c${index}_condition = c${index}_op == "exceeds" ? c${index}_exceeds : c${index}_op == "below" ? c${index}_below : c${index}_crosses`
    : "";
  return {
    source: condition ? `${renamed}\n${condition}` : renamed,
    parameters: Object.fromEntries(
      Object.entries(parameters).map(([key, value]) => [
        `c${index}_${key}`,
        value,
      ]),
    ),
  };
}

/** Compile only the supported condition language; does not observe data or run an Agent.
 * @example const generated = buildConditions(query);
 */
export function buildConditions(query: ConditionGroup) {
  const blocks: string[] = [];
  const outputs: string[] = ['emit "value" c0_value'];
  const parameters: Record<string, string | number | boolean> = {};
  let warmupBars = 1;
  const expression = (group: ConditionGroup, depth: number): string => {
    if (depth >= 8 || group.rules.length === 0)
      return invalid("Use nonempty condition groups, at most 8 levels deep.");
    return `(${group.rules
      .map((item) => {
        if ("rules" in item) return expression(item, depth + 1);
        if (blocks.length >= 32)
          return invalid("An alert supports at most 32 conditions.");
        const index = blocks.length;
        const compiled = block(item, index);
        blocks.push(compiled.source);
        outputs.push(`emit "${item.field}_${index}" c${index}_value`);
        Object.assign(parameters, compiled.parameters);
        warmupBars = Math.max(
          warmupBars,
          (item.field === "rsi" ? 15 : 1) + item.value.bars,
        );
        return `c${index}_condition`;
      })
      .join(` ${group.combinator} `)})`;
  };
  const result = expression(query, 0);
  const source = [
    "import ta",
    ...blocks,
    `condition = ${result}`,
    outputs.join("\n"),
    end,
  ].join("\n\n");
  if (source.length > 65536)
    return invalid("The generated condition script is too large.");
  return { source, parameters, warmupBars };
}

/** Recognize exact current/legacy starters and our generated programs. Arbitrary Tea is never partially converted.
 * @example const query = readConditions(source, config.parameters);
 */
export function readConditions(
  source: string,
  parameters: Readonly<Record<string, string | number | boolean>>,
): ConditionGroup | null {
  const starter = alertStarters.find(
    (entry) => entry.source === source || entry.legacySources.includes(source),
  );
  if (starter) {
    const candidate = {
      combinator: "and",
      rules: [
        {
          field: starter.id,
          operator:
            parameters.op ??
            (starter.source === source ? "greater_than" : "exceeds"),
          value: Object.fromEntries(
            Object.entries(defaults).map(([key, value]) => [
              key,
              parameters[key] ?? value,
            ]),
          ),
        },
      ],
    };
    try {
      return decodeQuery(candidate);
    } catch {
      return null;
    }
  }
  const match = /\n\ncondition = ([^\n]+)\n\n/.exec(source);
  if (!match) return null;
  const fields = [
    ...source.matchAll(
      /^c(\d+)_value = (close|volume|ta\.rsi\(close, 14\)|input\.series\("(indicator\.[^"\\]+)"\))$/gm,
    ),
  ];
  if (fields.length === 0 || fields.length > 32) return null;
  const rules = fields.map((field, index) => ({
    field:
      field[3] ??
      (field[2] === "close"
        ? "price"
        : field[2] === "volume"
          ? "volume"
          : "rsi"),
    operator: parameters[`c${index}_op`],
    value: Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [
        key,
        parameters[`c${index}_${key}`] ?? value,
      ]),
    ),
  }));
  const tokens = match[1]!.match(/c\d+_condition|and|or|[()]|\S+/g) ?? [];
  let position = 0;
  const group = (depth: number): unknown => {
    if (depth >= 8 || tokens[position++] !== "(")
      throw new Error("Unsupported group");
    const children: unknown[] = [];
    let combinator: string | undefined;
    while (position < tokens.length) {
      if (tokens[position] === "(") children.push(group(depth + 1));
      else {
        const token = /^c(\d+)_condition$/.exec(tokens[position++] ?? "");
        if (!token || !rules[Number(token[1])])
          throw new Error("Unsupported rule");
        children.push(rules[Number(token[1])]);
      }
      const next = tokens[position++];
      if (next === ")")
        return { combinator: combinator ?? "and", rules: children };
      if (
        (next !== "and" && next !== "or") ||
        (combinator && next !== combinator)
      )
        throw new Error("Unsupported operator");
      combinator = next;
    }
    throw new Error("Unclosed group");
  };
  try {
    const query = decodeQuery(group(0));
    if (position !== tokens.length || buildConditions(query).source !== source)
      return null;
    return query;
  } catch {
    return null;
  }
}

/** Preserve large movement windows when executing generated Tea through any writer.
 * @example const bars = conditionWarmup(source, parameters);
 */
export function conditionWarmup(
  source: string,
  parameters: Readonly<Record<string, string | number | boolean>>,
) {
  // Existing starters retain their own observation/warmup contract.
  if (!source.startsWith("import ta\n\nc0_")) return 0;
  const query = readConditions(source, parameters);
  return query ? buildConditions(query).warmupBars : 0;
}
