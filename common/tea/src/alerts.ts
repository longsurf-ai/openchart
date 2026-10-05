// Purpose: Find the alertcondition() outputs of a compiled Tea node by their nominal type.
import { DataType, type Schema } from "apache-arrow";

/**
 * Compiler-owned identity of `struct Alert {title, message}` in Tea's shipped
 * `visual` library, the only value `alertcondition()` emits.
 */
export const teaAlertTypeId = "visual.Alert";

/**
 * Names of the columns written by `alertcondition()` or typed `alert()`, in declaration order.
 *
 * A column is recognized only by the `tea:typeId` of its list-unwrapped value
 * field, the same nominal mechanism as {@link describeTeaVisual}. Visuals,
 * numbers and a user struct with identical `{title, message}` fields are never
 * alerts. Typed `visual.AlertEvent<Payload>` specializations are recognized by
 * their compiler-owned generic identity. Pure: reads the schema, allocates the
 * result and owns no cleanup.
 *
 * `alertcondition(id, condition, title, message)` appends to column `id`, so
 * each row holds a list, never null. Every attempt replaces its step's list:
 * `[{title, message}]` when the condition held on that attempt, `[]` when it
 * did not. A non-empty list therefore means "this attempt fired"; several calls
 * sharing one `id` may append several elements. Typed `alert()` adds a `data`
 * struct to each element, retaining per-occurrence facts and identity.
 *
 * @example
 * const [alert] = teaAlertOutputs(node.outputs); // "cross"
 * const fired = (row[alert] as unknown[]).length > 0;
 */
export function teaAlertOutputs(outputs: Schema): string[] {
  return outputs.fields.flatMap((field) => {
    let value = field;
    while (DataType.isList(value.type)) value = value.type.valueField;
    const typeId = value.metadata.get("tea:typeId");
    return typeId === teaAlertTypeId || typeId?.startsWith("visual.AlertEvent<")
      ? [field.name]
      : [];
  });
}
