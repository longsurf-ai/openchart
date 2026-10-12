// Purpose: Parse editable Tea parameter text while retaining only explicit choices.
import * as Tea from "@openchart/tea";

/**
 * Parse numeric input text and validate explicit choices against Tea declarations.
 * Defaults remain owned by the program; this returns a new overrides object and
 * never changes the draft. Invalid, empty, or removed values throw Tea's validation
 * error for the form to display. This synchronous helper owns no resources.
 * @example parseTeaParameterOverrides(compiled.definition, { length: "20" });
 */
export function parseTeaParameterOverrides(
  definition: Pick<Tea.CompileResponse["definition"], "parameters">,
  draft: Tea.ParameterOverrides,
): Tea.ParameterOverrides {
  const values = { ...draft };
  for (const parameter of definition.parameters) {
    const value = values[parameter.name];
    if (
      (parameter.type === "int" || parameter.type === "float") &&
      typeof value === "string"
    )
      values[parameter.name] = value.trim() === "" ? NaN : Number(value);
  }
  Tea.teaParameters(definition, values);
  return values;
}
