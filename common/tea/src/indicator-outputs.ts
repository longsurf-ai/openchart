// Purpose: Decide which compiled outputs a chart can bind and an alert can read; shared by the chart and server macros.
import { DataType } from "apache-arrow";
import type { CompileResponse, FieldPath } from "./tea";
import { describeTeaVisual, type VisualKind } from "./visuals";

export type IndicatorOutput = {
  name: string;
  kind: "numeric" | VisualKind;
};

/** Reject unsupported output kinds before persisting bindings. @example const outputs = indicatorOutputs(response); */
export function indicatorOutputs({
  declaration,
  definition,
}: Pick<CompileResponse, "definition" | "declaration">): IndicatorOutput[] {
  if (declaration?.kind !== "indicator")
    throw new Error(
      'Start this Tea file with an indicator() declaration: indicator("My indicator", overlay = false)',
    );
  const fields = definition.outputs.fields.filter((field) =>
    field.metadata.has("tea:write"),
  );
  if (!fields.length) throw new Error("This script has no chart outputs.");
  return fields.map((field) => {
    const visual = describeTeaVisual(field);
    if (field.metadata.get("tea:write") === "set") {
      if (DataType.isFloat(field.type) || DataType.isInt(field.type))
        return { name: field.name, kind: "numeric" };
      if (visual?.listDepth === 0)
        return { name: field.name, kind: visual.kind };
    }
    throw new Error(
      `Output “${field.name}” is not a supported scalar numeric or visual output.`,
    );
  });
}

/**
 * An indicator output with one number per attempt, and the path an alert's map
 * reads it at: `[name]` for a numeric output, `[name, "series"]` for a plot,
 * whose number is the `series` field of its struct.
 */
export type IndicatorSeriesOutput = {
  readonly name: string;
  readonly kind: "numeric" | "series";
  readonly path: FieldPath;
};

/**
 * The outputs an alert condition can read as `indicator.<name>`: numeric
 * outputs and plots. Other visuals, such as horizontal lines and vertical
 * profiles, carry no number per attempt.
 *
 * @example
 * indicatorSeriesOutputs(response);
 * // [{ name: "basis", kind: "series", path: ["basis", "series"] }]
 */
export function indicatorSeriesOutputs(
  response: Pick<CompileResponse, "definition" | "declaration">,
): IndicatorSeriesOutput[] {
  return indicatorOutputs(response).flatMap(
    ({ name, kind }): IndicatorSeriesOutput[] =>
      kind === "numeric" || kind === "series"
        ? [{ name, kind, path: kind === "series" ? [name, "series"] : [name] }]
        : [],
  );
}
