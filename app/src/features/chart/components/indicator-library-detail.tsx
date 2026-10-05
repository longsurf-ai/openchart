// Purpose: Explain one resolved study using its authored guide and canonical Tea inputs.
import { useId, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Copy, FileCode2 } from "lucide-react";
import * as Tea from "@openchart/tea";
import { Button } from "@openchart/app/components/ui/button";
import { Markdown } from "@openchart/app/components/ui/markdown/markdown";
import type { IndicatorCatalogEntry } from "@openchart/app/features/chart/api/indicator-scripts";
import { useErrorToast } from "@openchart/app/hooks/use-error-toast";
import { useTeaDefinition } from "@openchart/app/hooks/use-tea";
import {
  IndicatorInputsForm,
  parseIndicatorOverrides,
} from "./indicator-inputs-dialog";

/** Explain only the selected source; compilation owns inputs, and the existing Add flow owns snapshots and writes. @example <IndicatorLibraryDetail source={source} scope="My scripts" busy={busy} onBack={back} onAdd={add} onOpenSource={open} onModify={modify} /> */
export function IndicatorLibraryDetail({
  source,
  entry,
  scope,
  busy,
  preview,
  onBack,
  onAdd,
  onOpenSource,
  onModify,
}: {
  source: Tea.WorkspaceSources;
  entry?: IndicatorCatalogEntry;
  scope: string;
  busy: boolean;
  /** The study's preview; it reports the values its run bound. */
  preview: (
    parameters: Tea.ParameterOverrides,
    onResolved: (parameters: Tea.ParameterOverrides | undefined) => void,
  ) => ReactNode;
  onBack: () => void;
  onAdd: (values: Tea.ParameterOverrides) => void;
  onOpenSource: () => void;
  onModify: () => void;
}) {
  const inputsFormId = useId();
  const [overrides, setOverrides] = useState<Tea.ParameterOverrides>({});
  // What the preview ran with: defaults that follow the chart show the
  // example's, as a chart's settings show its own.
  const [resolved, setResolved] = useState<Tea.ParameterOverrides>();
  const { compiled, pending, error, retry } = useTeaDefinition(source);
  const inputs = useMemo(() => {
    if (!compiled) return {};
    try {
      return {
        parameters: parseIndicatorOverrides(compiled.definition, overrides),
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [compiled, overrides]);
  const incompatible = useMemo(() => {
    if (!compiled) return undefined;
    try {
      Tea.indicatorOutputs(compiled);
      return undefined;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  }, [compiled]);
  useErrorToast(error, {
    id: `indicator-library:${source.workspaceId}:${source.path}`,
    title: "Couldn’t prepare this study",
    retry,
  });
  const copy = useMutation({
    retry: false,
    meta: { errorTitle: "Couldn’t copy this prompt" },
    mutationFn: (prompt: string) => navigator.clipboard.writeText(prompt),
  });
  const name =
    entry?.name ??
    compiled?.declaration?.title ??
    source.path.split("/").at(-1)!;
  const [intro, ...readingGuide] =
    entry?.description.split(/(?<=[.!?])\s+/) ?? [];
  const hasInputs = !compiled || compiled.definition.parameters.length > 0;
  const showInputs = pending || hasInputs || !!error || !!incompatible;
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3 pr-12 text-sm lg:px-5 lg:pr-12">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onBack}>
          <ArrowLeft className="size-4" />
          {scope}
        </Button>
        <span aria-hidden="true" className="text-muted-foreground">
          /
        </span>
        <span className="min-w-0 truncate font-medium">{name}</span>
      </header>
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 lg:px-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-studio text-xl font-medium">{name}</h1>
            {entry ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {entry.category}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {intro ?? "A study saved in your Workspace."}
          </p>
        </div>
        {inputs.parameters && !incompatible ? (
          preview(inputs.parameters, setResolved)
        ) : inputs.error ? (
          <div className="flex aspect-[3/1] items-center justify-center rounded-lg border p-4 text-sm text-muted-foreground">
            Correct the inputs below to update the chart.
          </div>
        ) : null}
        <div
          className={
            showInputs
              ? "indicator-library-detail-columns grid gap-4"
              : "grid gap-4"
          }
        >
          <section className="min-w-0 space-y-2 rounded-lg border p-3">
            <h2 className="text-sm font-semibold">How to read it</h2>
            {entry ? (
              <Markdown
                text={readingGuide.join(" ") || entry.description}
                className="prose-p:my-0"
              />
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">
                Open the source to read your study, or describe a change to the
                Agent. Adjust the inputs to see the study on this market.
              </p>
            )}
          </section>
          {showInputs ? (
            <section className="min-w-0 space-y-3 rounded-lg border p-3">
              <h2 className="text-sm font-semibold">Inputs</h2>
              {pending ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Reading study inputs…
                </p>
              ) : error ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    This study couldn’t be prepared.
                  </p>
                  <Button size="sm" variant="outline" onClick={retry}>
                    Retry
                  </Button>
                </div>
              ) : incompatible ? (
                <p role="alert" className="text-sm text-muted-foreground">
                  This script can’t be added to a chart: {incompatible}
                </p>
              ) : compiled ? (
                <IndicatorInputsForm
                  compiled={compiled}
                  resolved={resolved}
                  // A preview reads only its example's bars, so an auto
                  // script's Timeframe has none to offer; the chart picks.
                  choices={
                    compiled.declaration?.timeframe === "auto"
                      ? { timeframe: [] }
                      : undefined
                  }
                  overrides={overrides}
                  onOverridesChange={setOverrides}
                  validationError={inputs.error}
                  disabled={busy}
                  formId={inputsFormId}
                  hideSubmit
                  onSave={async (values) => {
                    onAdd(values);
                  }}
                />
              ) : null}
            </section>
          ) : null}
        </div>
        {entry ? (
          <section className="space-y-2 rounded-lg bg-muted/40 px-3 pb-3 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Source prompt</h2>
              <Button
                variant="ghost"
                size="sm"
                disabled={copy.isPending}
                onClick={() => copy.mutate(entry.prompt)}
              >
                <Copy className="size-4" />
                {copy.isSuccess ? "Copied" : "Copy prompt"}
              </Button>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {entry.prompt}
            </p>
          </section>
        ) : (
          <section className="space-y-2 rounded-lg bg-muted/40 p-3">
            <h2 className="text-sm font-semibold">Make it your own</h2>
            <p className="text-sm text-muted-foreground">
              This file has no saved creation prompt. Describe what you want to
              change.
            </p>
          </section>
        )}
      </main>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-3 lg:px-5">
        {!entry ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onModify}
          >
            Modify with Agent
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onOpenSource}
          >
            <FileCode2 className="size-4" /> Open source
          </Button>
          {!error && !incompatible ? (
            <Button
              type={hasInputs ? "submit" : "button"}
              form={hasInputs ? inputsFormId : undefined}
              size="sm"
              disabled={busy || pending || !compiled || !!inputs.error}
              onClick={hasInputs ? undefined : () => onAdd({})}
            >
              {busy ? "Adding…" : "Add to chart"}
            </Button>
          ) : null}
        </div>
      </footer>
    </>
  );
}
