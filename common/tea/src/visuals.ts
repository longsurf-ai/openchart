// Purpose: Describe the chart meaning of Tea's nominal visual outputs, without renderer state.
import { DataType, type Field } from "apache-arrow";

/**
 * Tea declaration identity to visual meaning. Arrow owns each value's fields;
 * this table adds semantics, not a second value schema or renderer registry.
 * Recognition does not imply support for every style in a chart renderer.
 */
export const teaVisualKinds = {
  "visual.Plot": "series",
  "visual.Hline": "horizontal-line",
  "visual.Fill": "fill",
  "visual.Shape": "shape",
  "visual.Character": "character",
  "visual.Background": "background",
  "visual.BarColor": "bar-color",
  "visual.Segment": "segment",
  "visual.Zone": "zone",
  "visual.Candle": "candles",
  "visual.VerticalProfile": "vertical-profile",
} as const;

/** Chart meaning of a standard Tea visual description. */
export type VisualKind = (typeof teaVisualKinds)[keyof typeof teaVisualKinds];

/**
 * Schema-derived description of one visual output column.
 *
 * All currently recognized types describe a contribution at an execution step.
 * Each attempt replaces that step's entire contribution, including absent
 * values and empty lists. `append` orders values within an attempt; it never
 * appends one attempt's visuals to the previous attempt's visuals.
 *
 * The output name is scoped to an indicator attachment. Execution indices are
 * scoped to one observation and are not chart indices or persistent object IDs.
 */
export interface VisualOutput {
  readonly output: string;
  readonly kind: VisualKind;
  readonly write: "set" | "append";
  /** Arrow List nesting, including append's outer list. Zero means one value. */
  readonly listDepth: number;
}

/**
 * Read a visual output's meaning from its compiler-owned Arrow field.
 *
 * Lists preserve their element's meaning and their explicit write mode. No
 * numeric column, user struct, event or opaque resource handle becomes a visual
 * merely by resembling one. Those fields, and execution coordinates, return
 * null. Resource handles need drawing descriptions before they can be rendered.
 * This function allocates only a description and owns no execution or cleanup.
 *
 * @throws For invalid write metadata, append without a List, or a recognized
 * nominal visual type on a non-Struct field.
 * @example
 * const visual = describeTeaVisual(node.outputs.fields.find(f => f.name === "sma")!);
 * // { output: "sma", kind: "series", write: "set", listDepth: 0 }
 */
export function describeTeaVisual(field: Field): VisualOutput | null {
  const write = field.metadata.get("tea:write");
  if (write === undefined) return null;
  if (write !== "set" && write !== "append")
    throw new Error(`Invalid Tea write mode for output “${field.name}”.`);

  let value = field;
  let listDepth = 0;
  while (DataType.isList(value.type)) {
    value = value.type.valueField;
    listDepth++;
  }
  if (write === "append" && listDepth === 0)
    throw new Error(`Tea append output “${field.name}” must be a List.`);

  const typeId = value.metadata.get("tea:typeId");
  if (typeId === undefined || !Object.hasOwn(teaVisualKinds, typeId))
    return null;
  if (!DataType.isStruct(value.type))
    throw new Error(`Tea visual output “${field.name}” must contain a Struct.`);

  return {
    output: field.name,
    kind: teaVisualKinds[typeId as keyof typeof teaVisualKinds],
    write,
    listDepth,
  };
}
