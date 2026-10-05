// Purpose: Use React Query Builder's native tree editing with the existing condition field metadata.
import { useMemo } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import {
  QueryBuilder,
  prepareRuleGroup,
  type RuleGroupType,
  type ValueEditorProps,
} from "react-querybuilder";
import { QueryBuilderShadcn } from "@openchart/app/components/ui/query-builder";
import { Input } from "@openchart/app/components/ui/input";
import type { AlertStarter } from "@openchart/app/features/alerts/api/queries";
import "react-querybuilder/dist/query-builder.css";
import "./conditions-editor.css";

/** One selectable condition field: a starter, or an Indicator output that reuses a starter's operators and values. */
export type ConditionField = Pick<
  AlertStarter,
  "id" | "label" | "operators" | "parameters"
> & {
  readonly legacyOperators: readonly AlertStarter["legacyOperators"][number][];
};

/** Blank condition values use the same defaults as the bundled Tea templates. */
export const conditionValues = {
  threshold: 0,
  lower: 0,
  upper: 1,
  amount: 1,
  bars: 1,
};

/** One default price condition, ready for an independently selected Bars binding. @example const draft = defaultConditions(); */
export function defaultConditions(): RuleGroupType {
  return prepareRuleGroup({
    combinator: "and",
    rules: [
      {
        field: "price",
        operator: "greater_than",
        value: { ...conditionValues },
      },
    ],
  });
}

function ConditionValue({
  value,
  handleOnChange,
  operator,
  context,
  field,
  disabled,
}: ValueEditorProps) {
  const fields = context as readonly ConditionField[];
  const definition = fields.find((item) => item.id === field);
  const keys = definition?.operators.find((item) => item.value === operator)
    ?.parameters ?? ["threshold"];
  const values = value as Record<string, string | number>;
  return (
    <div className="flex min-w-0 flex-1 basis-28 flex-wrap gap-2">
      {keys.map((key) => (
        <Input
          key={key}
          type="number"
          aria-label={
            definition?.parameters.find((item) => item.name === key)?.label ??
            key
          }
          title={key}
          disabled={disabled}
          className="min-w-0 flex-1 basis-20"
          value={values[key] ?? ""}
          step={key === "bars" ? 1 : "any"}
          onChange={(event) =>
            handleOnChange({
              ...values,
              [key]:
                event.target.value === "" ? "" : Number(event.target.value),
            })
          }
        />
      ))}
    </div>
  );
}

/** The upstream library owns grouping and focus; the host owns the draft and persistence.
 * @example <ConditionsEditor query={query} onChange={setQuery} fields={starters} disabled={saving} />
 */
export function ConditionsEditor({
  query,
  onChange,
  fields,
  disabled,
}: {
  query: RuleGroupType;
  onChange: (query: RuleGroupType) => void;
  fields: readonly ConditionField[];
  disabled: boolean;
}) {
  const options = useMemo(
    () =>
      fields.map((field) => ({
        name: field.id,
        label: field.label,
        defaultValue: { ...conditionValues },
        operators: [...field.operators, ...field.legacyOperators].map(
          (operator) => ({ name: operator.value, label: operator.label }),
        ),
      })),
    [fields],
  );
  return (
    <div className="alert-conditions">
      <QueryBuilderShadcn>
        <QueryBuilder
          enableMountQueryChange={false}
          fields={options}
          query={query}
          onQueryChange={onChange}
          disabled={disabled}
          context={fields}
          controlElements={{ valueEditor: ConditionValue }}
          combinators={[
            { name: "and", label: "All (AND)" },
            { name: "or", label: "Any (OR)" },
          ]}
          translations={{
            addRule: {
              label: (
                <>
                  <PlusIcon />
                  Condition
                </>
              ),
              title: "Add condition",
            },
            addGroup: {
              label: (
                <>
                  <PlusIcon />
                  Group
                </>
              ),
              title: "Add group",
            },
            removeRule: { label: <XIcon />, title: "Remove condition" },
            removeGroup: { label: <XIcon />, title: "Remove group" },
          }}
        />
      </QueryBuilderShadcn>
    </div>
  );
}
