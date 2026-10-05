// Purpose: Edit only explicit choices; declarations/defaults always belong to the compiled Tea program.
import * as Tea from "@openchart/tea";
import { useState, type ComponentProps } from "react";
import { TeaParameterFields } from "@openchart/app/components/ui/tea-parameter-fields/tea-parameter-fields";
import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@openchart/app/components/ui/dialog";
import { useWidgetControls } from "@openchart/app/hooks/use-widget";

interface IndicatorInputsProps {
  compiled: Pick<Tea.CompileResponse, "definition" | "declaration">;
  overrides: Tea.ParameterOverrides;
  onSave: (values: Tea.ParameterOverrides) => Promise<void>;
}

/** Parse editable text while retaining only explicit choices; Tea owns defaults and constraints. @example parseIndicatorOverrides(compiled.definition, { length: "20" }); */
export function parseIndicatorOverrides(
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

/** Edit explicit inputs in either the picker or series settings. @example <IndicatorInputsForm compiled={compiled} overrides={{}} onSave={save} /> */
export function IndicatorInputsForm({
  compiled: { definition },
  overrides,
  onOverridesChange,
  validationError,
  onSave,
  onSavingChange,
  formId,
  hideSubmit = false,
  submitLabel = "Save",
  disabled = false,
  resolved,
  choices,
}: IndicatorInputsProps & {
  /**
   * The values a run bound, from its config: a parameter whose default
   * follows the chart shows the run's until one is chosen.
   */
  resolved?: Tea.ParameterOverrides;
  /** Choices the host offers for a parameter; see {@link TeaParameterFields}. */
  choices?: ComponentProps<typeof TeaParameterFields>["choices"];
  onOverridesChange?: (overrides: Tea.ParameterOverrides) => void;
  validationError?: string;
  onSavingChange?: (saving: boolean) => void;
  formId?: string;
  hideSubmit?: boolean;
  submitLabel?: string;
  disabled?: boolean;
}) {
  const [localDraft, setLocalDraft] = useState(overrides);
  const draft = onOverridesChange ? overrides : localDraft;
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <form
      id={formId}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (saving || disabled) return;
        setSaving(true);
        onSavingChange?.(true);
        setError(undefined);
        void (async () => {
          try {
            const values = parseIndicatorOverrides(definition, draft);
            // The mutation owner reports save failures; retain this draft for another attempt.
            await onSave(values).catch(() => {});
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setSaving(false);
            onSavingChange?.(false);
          }
        })();
      }}
    >
      <TeaParameterFields
        parameters={definition.parameters.map((parameter) =>
          parameter.chartDefault && resolved?.[parameter.name] !== undefined
            ? { ...parameter, value: resolved[parameter.name] }
            : parameter,
        )}
        choices={choices}
        value={draft}
        onChange={(values) => {
          setError(undefined);
          (onOverridesChange ?? setLocalDraft)(values);
        }}
        disabled={saving || disabled}
      />
      {validationError || error ? (
        <p role="alert" className="text-sm text-destructive">
          {validationError || error}
        </p>
      ) : null}
      {hideSubmit ? null : (
        <Button
          type="submit"
          size="sm"
          className="self-end"
          disabled={saving || disabled}
        >
          {saving ? "Saving…" : submitLabel}
        </Button>
      )}
    </form>
  );
}

/** Ask for inputs before attaching a script that requires them. @example <IndicatorInputsDialog compiled={compiled} overrides={{}} onSave={save} onClose={close} /> */
export function IndicatorInputsDialog({
  compiled,
  overrides,
  onSave,
  onClose,
}: IndicatorInputsProps & { onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  useWidgetControls(true);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md lg:max-w-md xl:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {compiled.declaration?.title ?? "Indicator"} inputs
          </DialogTitle>
          <DialogDescription>
            Use the script’s defaults or save a value for this chart.
          </DialogDescription>
        </DialogHeader>
        <IndicatorInputsForm
          compiled={compiled}
          overrides={overrides}
          onSavingChange={setSaving}
          onSave={async (values) => {
            await onSave(values);
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
