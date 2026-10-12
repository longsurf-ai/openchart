// Purpose: Edit one formula column's output, parameters and data settings against its saved code.
import { replaceEqualDeep } from "@tanstack/react-query";
import * as Tea from "@openchart/tea";
import { Code2, RotateCw, Trash2 } from "lucide-react";
import { lazy, Suspense, useContext, useId, useState } from "react";
import { Button } from "@openchart/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openchart/app/components/ui/dialog";
import { Input } from "@openchart/app/components/ui/input";
import { CardItem } from "@openchart/app/components/ui/settings/card";
import { DropdownControl } from "@openchart/app/components/ui/settings/dropdown-control";
import { ConfirmationDialog } from "@openchart/app/components/ui/dialog/confirmation-dialog/confirmation-dialog";
import { parseTeaParameterOverrides } from "@openchart/app/components/ui/tea-parameter-fields/parse-parameter-overrides";
import { TeaParameterFields } from "@openchart/app/components/ui/tea-parameter-fields/tea-parameter-fields";
import { useTeaDefinition, useTeaSource } from "@openchart/app/hooks/use-tea";
import { WorkspaceFileNavigation } from "@openchart/app/lib/workspace/workspace";
import type {
  FormulaMetric,
  FormulaSource,
  FormulaSettings,
  Watchlist,
} from "../api/queries";
import type { Column } from "../utils/tree";
import { WatchlistSymbolPicker } from "./context";

const CodeEditor = lazy(() =>
  import("@openchart/app/components/ui/code-editor").then((module) => ({
    default: module.CodeEditor,
  })),
);

type Target = {
  source: FormulaSource;
  column?: Column;
  revision: number;
};
/** One settings draft remains mounted while Open code reveals the Workspace. Save validates against the edited revision; failures preserve the draft. Cancel drops it. @example <FormulaColumnDialog target={target} open onClose={close} onSuspend={hide} pending={pending} onSave={save} onReload={reload} onRemove={remove} /> */
export function FormulaColumnDialog({
  target,
  open,
  pending,
  onClose,
  onSuspend,
  onSave,
  onReload,
  onRemove,
  conflict,
  onLoadSaved,
}: {
  target: Target;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSuspend: () => void;
  onSave: (settings: FormulaSettings, revision: number) => Promise<unknown>;
  onReload: (revision: number) => Promise<Watchlist>;
  onRemove: () => Promise<unknown>;
  conflict?: "changed" | "removed";
  onLoadSaved?: () => void;
}) {
  const metric =
    target.column?.metric.kind === "formula" ? target.column.metric : undefined;
  const [title, setTitle] = useState(target.column?.title ?? "");
  const [output, setOutput] = useState(metric?.output ?? "");
  const [overrides, setOverrides] = useState<Tea.ParameterOverrides>(
    metric?.parameterOverrides ?? {},
  );
  const [bars, setBars] = useState<FormulaMetric["bars"]>(
    metric?.bars ?? { resolution: "1d" },
  );
  const [savedCode, setSavedCode] = useState(false);
  const [codePath, setCodePath] = useState<string>(target.source.path);
  const id = useId();
  const openCode = useContext(WorkspaceFileNavigation);
  const symbolPicker = useContext(WatchlistSymbolPicker);
  const definition = useTeaDefinition(
    metric
      ? { entry: target.source.path, sources: metric.snapshot }
      : target.source,
  );
  const live = useTeaSource(target.source);
  const changed =
    metric &&
    live.program &&
    replaceEqualDeep(metric.snapshot, live.program.sources) !== metric.snapshot;
  const outputs = definition.compiled
    ? Tea.formulaOutputs(definition.compiled)
    : [];
  const selectedOutput = output || outputs[0]?.name || "";
  let validation: string | undefined;
  let parsedOverrides = overrides;
  if (definition.compiled) {
    try {
      parsedOverrides = parseTeaParameterOverrides(
        definition.compiled.definition,
        overrides,
      );
      if (!outputs.some((item) => item.name === selectedOutput))
        validation = "Choose an available numeric output.";
    } catch (error) {
      validation = error instanceof Error ? error.message : String(error);
    }
  }
  const busy = pending || definition.pending || !!conflict;
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <>
      <Dialog
        open={open && !savedCode}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent className="sm:max-w-lg lg:max-w-lg xl:max-w-lg">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && !validation && definition.compiled)
                void onSave(
                  {
                    title: title.trim() || undefined,
                    output: selectedOutput,
                    parameterOverrides: parsedOverrides,
                    bars,
                  },
                  target.revision,
                ).then(onClose, () => {});
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {metric ? "Column settings" : "Add formula column"}
              </DialogTitle>
              <DialogDescription>
                Choose the value to show for each symbol.
              </DialogDescription>
            </DialogHeader>
            <div className="my-5 max-h-[60vh] space-y-5 overflow-y-auto text-sm">
              {conflict ? (
                <div role="alert" className="space-y-2 rounded-md border p-3">
                  <p>
                    {conflict === "removed"
                      ? "This column was removed. Your draft is still here, but it cannot be saved."
                      : "This column changed while settings were open. Your draft has been preserved."}
                  </p>
                  {conflict === "changed" ? (
                    <ConfirmationDialog
                      title="Load saved settings"
                      body="Discard your unsaved changes and load the latest saved settings for this column?"
                      icon="info"
                      cancelButtonText="Keep draft"
                      pending={pending}
                      triggerButton={
                        <Button type="button" variant="outline" size="sm">
                          Load saved settings
                        </Button>
                      }
                      confirmButton={
                        <Button
                          type="button"
                          disabled={pending}
                          onClick={onLoadSaved}
                        >
                          Discard draft and load
                        </Button>
                      }
                    />
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-3">
                <CardItem
                  title="Name"
                  htmlFor={`${id}-name`}
                  actions={
                    <Input
                      id={`${id}-name`}
                      className="h-8 w-52"
                      placeholder="Use code and output name"
                      maxLength={200}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      disabled={pending}
                    />
                  }
                />
                <CardItem
                  title="Output"
                  htmlFor={`${id}-output`}
                  actions={
                    <div className="w-52">
                      <DropdownControl
                        id={`${id}-output`}
                        aria-label="Output"
                        value={selectedOutput}
                        options={outputs.map((item) => ({
                          value: item.name,
                          name: item.name,
                        }))}
                        onChange={(value) => setOutput(String(value))}
                        disabled={busy}
                      />
                    </div>
                  }
                />
                <CardItem
                  title="Interval"
                  htmlFor={`${id}-interval`}
                  actions={
                    <div className="w-52">
                      <DropdownControl
                        id={`${id}-interval`}
                        aria-label="Interval"
                        value={bars.resolution}
                        options={[
                          "1s",
                          "1m",
                          "5m",
                          "15m",
                          "30m",
                          "1h",
                          "4h",
                          "1d",
                          "1W",
                          "1M",
                        ].map((value) => ({ value, name: value }))}
                        onChange={(resolution) =>
                          setBars({
                            ...bars,
                            resolution:
                              resolution as FormulaMetric["bars"]["resolution"],
                          })
                        }
                        disabled={pending}
                      />
                    </div>
                  }
                />
              </div>
              {definition.pending ? (
                <p role="status" className="text-muted-foreground">
                  Reading code…
                </p>
              ) : definition.error ? (
                <div role="alert">
                  <p>{definition.error.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={definition.retry}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <section aria-label="Parameters">
                  <h3 className="mb-3 font-medium">Parameters</h3>
                  {definition.compiled &&
                  (definition.compiled.definition.parameters.length > 0 ||
                    Object.keys(overrides).length > 0) ? (
                    <TeaParameterFields
                      symbolPicker={symbolPicker}
                      parameters={definition.compiled.definition.parameters}
                      value={overrides}
                      onChange={setOverrides}
                      disabled={pending}
                    />
                  ) : (
                    <p className="text-muted-foreground">
                      This code has no parameters.
                    </p>
                  )}
                </section>
              )}
              {validation ? (
                <p role="alert" className="text-destructive">
                  {validation}
                </p>
              ) : null}
              <details>
                <summary className="cursor-pointer text-muted-foreground">
                  Data settings
                </summary>
                <div className="mt-3 space-y-3">
                  <CardItem
                    title="Session"
                    actions={
                      <DropdownControl
                        aria-label="Session"
                        value={bars.session ?? "default"}
                        options={[
                          { value: "default", name: "Provider default" },
                          { value: "regular", name: "Regular" },
                          { value: "extended", name: "Extended" },
                          { value: "24h", name: "24 hours" },
                        ]}
                        onChange={(session) => {
                          const rest = { ...bars };
                          delete rest.session;
                          setBars(
                            session === "default"
                              ? rest
                              : {
                                  ...rest,
                                  session: session as NonNullable<
                                    FormulaMetric["bars"]["session"]
                                  >,
                                },
                          );
                        }}
                        disabled={pending}
                      />
                    }
                  />
                  <CardItem
                    title="Adjustment"
                    actions={
                      <DropdownControl
                        aria-label="Adjustment"
                        value={bars.adjustment ?? "default"}
                        options={[
                          { value: "default", name: "Provider default" },
                          { value: "raw", name: "Raw" },
                          { value: "split", name: "Splits" },
                          {
                            value: "split_dividend",
                            name: "Splits and dividends",
                          },
                        ]}
                        onChange={(adjustment) => {
                          const rest = { ...bars };
                          delete rest.adjustment;
                          setBars(
                            adjustment === "default"
                              ? rest
                              : {
                                  ...rest,
                                  adjustment: adjustment as NonNullable<
                                    FormulaMetric["bars"]["adjustment"]
                                  >,
                                },
                          );
                        }}
                        disabled={pending}
                      />
                    }
                  />
                </div>
              </details>
              {changed ? (
                <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <p className="text-muted-foreground">
                    Code has changed. This column still uses the saved version.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      void onReload(target.revision).catch(() => {});
                    }}
                  >
                    <RotateCw /> Reload
                  </Button>
                </div>
              ) : null}
              {metric && live.error ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground">
                    Source code is unavailable. The column continues using its
                    saved code.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={live.retry}
                  >
                    Retry source read
                  </Button>
                </div>
              ) : null}
            </div>
            <DialogFooter className="flex-wrap gap-y-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={pending || (!openCode && !metric)}
                onClick={() => {
                  if (metric && live.error) setSavedCode(true);
                  else if (openCode) {
                    openCode(target.source);
                    onSuspend();
                  }
                }}
              >
                <Code2 /> Open code
              </Button>
              <div className="flex items-center gap-2">
                {metric ? (
                  <ConfirmationDialog
                    title="Remove column"
                    body="Remove this column and its settings? Its code file will stay in your workspace."
                    pending={pending}
                    triggerButton={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove column"
                        disabled={pending}
                      >
                        <Trash2 />
                      </Button>
                    }
                    confirmButton={
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={pending}
                        onClick={() => {
                          void onRemove().then(onClose, () => {});
                        }}
                      >
                        Remove column
                      </Button>
                    }
                  />
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy || !!validation || !definition.compiled}
                >
                  {metric ? "Save" : "Add column"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={savedCode} onOpenChange={setSavedCode}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Saved code</DialogTitle>
            <DialogDescription>
              The saved version used by this column.
            </DialogDescription>
          </DialogHeader>
          {metric ? (
            <>
              <DropdownControl
                aria-label="Code file"
                value={codePath}
                options={Object.keys(metric.snapshot).map((path) => ({
                  value: path,
                  name: path,
                }))}
                onChange={(path) => setCodePath(String(path))}
              />
              <div className="h-96">
                <Suspense fallback={<p role="status">Opening editor…</p>}>
                  <CodeEditor
                    language="tea"
                    value={metric.snapshot[codePath] ?? ""}
                    options={{ readOnly: true }}
                  />
                </Suspense>
              </div>
            </>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavedCode(false)}>
              Back to settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
