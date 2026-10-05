// Purpose: Resolve explicit Tea inputs against a compiled Definition; shared by the chart and server macros.
import type { Definition, Parameter } from "./metadata";

export type ParameterOverrides = Record<string, number | boolean | string>;

/**
 * Materialize this Definition's defaults without saving them. A parameter
 * whose default depends on the chart ({@link Parameter.chartDefault}) stays
 * out unless overridden, so each run resolves it for its own chart.
 * Unknown/invalid choices fail.
 * @example teaParameters(response.definition, {length: 20});
 */
export function teaParameters(
  definition: Pick<Definition, "parameters">,
  overrides: ParameterOverrides,
): ParameterOverrides {
  for (const name of Object.keys(overrides))
    if (!definition.parameters.some((parameter) => parameter.name === name))
      throw new Error(
        `Parameter “${name}” no longer exists. Reset or replace its override.`,
      );
  return Object.fromEntries(
    definition.parameters.flatMap((parameter) => {
      const explicit = Object.hasOwn(overrides, parameter.name);
      if (!explicit && parameter.chartDefault) return [];
      const value = explicit
        ? overrides[parameter.name]
        : (parameter.value ?? parameter.defaultValue);
      validateParameter(parameter, value);
      return [[parameter.name, value]];
    }),
  ) as ParameterOverrides;
}

function validateParameter(parameter: Parameter, value: unknown) {
  const label = parameter.title || parameter.name;
  if (value === null || value === undefined)
    throw new Error(`Enter a value for ${label}.`);
  const valid =
    parameter.type === "int"
      ? Number.isSafeInteger(value)
      : parameter.type === "float"
        ? Number.isFinite(value)
        : typeof value === (parameter.type === "bool" ? "boolean" : "string");
  if (!valid) throw new Error(`Invalid value for ${label}.`);
  const constraint = parameter.constraints;
  if (
    constraint?.kind === "range" &&
    typeof value === "number" &&
    ((constraint.minval !== null && value < constraint.minval) ||
      (constraint.maxval !== null && value > constraint.maxval))
  )
    throw new Error(`${label} is outside the script's allowed range.`);
  if (
    constraint?.kind === "options" &&
    !constraint.options.some((option) => option === value)
  )
    throw new Error(`${label} is not one of the script's allowed options.`);
  if (
    parameter.type === "enum" &&
    !parameter.enumType?.members.some((member) => member.name === value)
  )
    throw new Error(`${label} is not a member of the script's enum.`);
  if (
    parameter.type === "color" &&
    !/^#[\da-f]{6}([\da-f]{2})?$/i.test(String(value))
  )
    throw new Error(`${label} must be #RRGGBB or #RRGGBBAA.`);
}
