// Purpose: Render Tea parameter controls for the chart's Indicator inputs.
import { useId } from "react";
import * as Tea from "@openchart/tea";
import { Button } from "@openchart/app/components/ui/button";
import { Input } from "@openchart/app/components/ui/input";
import { Switch } from "@openchart/app/components/ui/form/switch";
import { CardItem } from "@openchart/app/components/ui/settings/card";
import { DropdownControl } from "@openchart/app/components/ui/settings/dropdown-control";

// An `input.source` picks one of the Bars columns.
const sourceOptions = Tea.barsSchema.fields.map((field) => field.name);

/** Render declarations and explicit overrides without owning a form or persistence. @example <TeaParameterFields parameters={node.parameters} value={draft} onChange={setDraft} /> */
export function TeaParameterFields({
  parameters,
  value: draft,
  onChange,
  choices = {},
  disabled = false,
}: {
  parameters: readonly Tea.Parameter[];
  value: Tea.ParameterOverrides;
  onChange: (value: Tea.ParameterOverrides) => void;
  /**
   * Choices the host offers for a parameter, by name, each with the name it
   * shows, such as the bars a chart can read for an auto script's
   * `timeframe`; `""` shows as "Default". They replace declared options.
   */
  choices?: Readonly<
    Record<string, readonly { readonly value: string; readonly name: string }[]>
  >;
  disabled?: boolean;
}) {
  const id = useId();
  const reset = (name: string) => {
    const next = { ...draft };
    delete next[name];
    onChange(next);
  };
  const set = (name: string, value: string | number | boolean) =>
    onChange({ ...draft, [name]: value });
  return (
    <>
      <div className="text-sm">
        {parameters.map((parameter) => {
          const explicit = Object.hasOwn(draft, parameter.name);
          const value = explicit
            ? draft[parameter.name]
            : (parameter.value ?? parameter.defaultValue);
          const numeric =
            parameter.type === "int" || parameter.type === "float";
          const options =
            choices[parameter.name] ??
            (parameter.constraints?.kind === "options"
              ? parameter.constraints.options
              : (parameter.enumType?.members.map((member) => member.name) ??
                (parameter.type === "source" ? sourceOptions : undefined))
            )?.map((option) => ({
              value: String(option),
              name: String(option),
            }));
          const fieldId = `${id}-${parameter.name}`;
          return (
            <CardItem
              key={parameter.name}
              className="flex-wrap gap-3"
              classNameWrapperAction="ml-auto max-w-full"
              title={parameter.title || parameter.name}
              htmlFor={fieldId}
              actions={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {explicit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={`Reset ${parameter.title || parameter.name}`}
                      disabled={disabled}
                      onClick={() => reset(parameter.name)}
                    >
                      Use script default
                    </Button>
                  ) : null}
                  {parameter.type === "bool" ? (
                    <Switch
                      id={fieldId}
                      checked={value === true}
                      onCheckedChange={(checked) =>
                        set(parameter.name, checked)
                      }
                      disabled={disabled}
                    />
                  ) : options ? (
                    <div className="w-40">
                      <DropdownControl
                        id={fieldId}
                        value={String(value ?? "")}
                        selectedLabel={
                          value == null
                            ? "Choose a value"
                            : value === "" && choices[parameter.name]
                              ? "Default"
                              : undefined
                        }
                        options={[
                          ...(value == null
                            ? [{ value: "", name: "Choose a value" }]
                            : []),
                          ...options,
                        ]}
                        onChange={(next) =>
                          set(
                            parameter.name,
                            numeric ? Number(next) : String(next),
                          )
                        }
                        disabled={disabled}
                      />
                    </div>
                  ) : (
                    <Input
                      id={fieldId}
                      type={numeric ? "number" : "text"}
                      className={numeric ? "h-8 w-20" : "h-8 w-40"}
                      value={String(value ?? "")}
                      step={parameter.type === "int" ? 1 : "any"}
                      onChange={(event) =>
                        set(parameter.name, event.target.value)
                      }
                      disabled={disabled}
                    />
                  )}
                </div>
              }
            />
          );
        })}
      </div>
      {Object.keys(draft)
        .filter(
          (name) => !parameters.some((parameter) => parameter.name === name),
        )
        .map((name) => (
          <div key={name} role="alert" className="text-sm text-destructive">
            Parameter “{name}” was removed.{" "}
            <Button type="button" variant="link" onClick={() => reset(name)}>
              Remove override
            </Button>
          </div>
        ))}
    </>
  );
}
