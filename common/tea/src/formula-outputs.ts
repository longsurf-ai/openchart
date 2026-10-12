// Purpose: Select independent scalar numeric outputs for Formula columns without rejecting unrelated outputs.
import { DataType } from "apache-arrow";
import type { CompileResponse, FieldPath } from "./tea";
import { describeTeaVisual } from "./visuals";

/** One number per attempt: a scalar output, or the series member of a Plot. */
export type FormulaOutput = {
  readonly name: string;
  readonly kind: "numeric" | "series";
  readonly path: FieldPath;
};

/**
 * Lists scalar numeric and nominal Plot outputs a Formula column can select.
 * Unsupported siblings, append outputs, and nested/list visuals are omitted.
 * An indicator declaration is optional; this is output eligibility, not chart
 * binding validation. Returns an empty array when no output is eligible.
 * This pure projection performs no execution, mutation, I/O, or cleanup.
 *
 * @example
 * formulaOutputs(compiled); // [{ name: "value", kind: "numeric", path: ["value"] }]
 */
export function formulaOutputs({
  definition,
}: Pick<CompileResponse, "definition">): FormulaOutput[] {
  return definition.outputs.fields.flatMap((field): FormulaOutput[] => {
    if (field.metadata.get("tea:write") !== "set") return [];
    if (DataType.isFloat(field.type) || DataType.isInt(field.type))
      return [{ name: field.name, kind: "numeric", path: [field.name] }];
    const visual = describeTeaVisual(field);
    if (visual?.kind === "series" && visual.listDepth === 0)
      return [
        { name: field.name, kind: "series", path: [field.name, "series"] },
      ];
    return [];
  });
}
