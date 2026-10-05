// Purpose: Add a Workspace script to a chart cell, asking for required inputs, from the picker or a Workspace tab.
import * as Tea from "@openchart/tea";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChartLine, RotateCw } from "lucide-react";
import { TooltipIconButton } from "@openchart/app/components/ui/tooltip-icon-button/tooltip-icon-button";
import {
  chartCommand,
  indicatorList,
  type IndicatorResource,
} from "@openchart/app/features/chart/api/queries";
import { useTeaDefinition } from "@openchart/app/hooks/use-tea";
import type { AppTransport } from "@openchart/app/lib/transport/transport";
import { IndicatorInputsDialog } from "./indicator-inputs-dialog";
import { targetCell } from "./symbol-control";

/**
 * Add a resolved script to the cell (the Dashboard's target cell when omitted).
 * `add(resolve)` awaits `resolve` (an install, or a save first), then mounts
 * `flow`, which decides on the file's content as read after that step: it asks
 * for required inputs or adds the script as is. Failures toast; a failed chart
 * save keeps the choice for a retry. Render `flow` while adding; unmount
 * releases its compilation and adds nothing.
 * @example const adder = useAddIndicator({ transport, chartId, cellId, onAdded: close }); adder.add(async () => file);
 */
export function useAddIndicator({
  transport,
  chartId,
  cellId,
  onAdded,
}: {
  transport: AppTransport;
  chartId: string;
  cellId?: string;
  onAdded?: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useMutation(chartCommand(transport, queryClient, chartId));
  // The picked file, from its resolve step until it is added or its inputs are dismissed.
  const [source, setSource] = useState<{
    source: Tea.WorkspaceSources;
    overrides: Tea.ParameterOverrides;
  }>();
  const commit = async (
    source: Tea.WorkspaceSources,
    overrides: Tea.ParameterOverrides,
  ) => {
    // The server snapshots, compiles and binds the outputs.
    await save.mutateAsync((chart) => {
      const cell = targetCell(chart, cellId);
      if (!cell) throw new Error("This chart has no cell to add to.");
      return transport.rpc.resources.macro.addIndicator.mutate({
        chartId,
        expectedRevision: chart.revision,
        cellId: cell.id,
        source,
        parameterOverrides: overrides,
      });
    });
    onAdded?.();
  };
  const pick = useMutation({
    meta: { errorTitle: "Couldn’t add indicator" },
    retry: false,
    mutationFn: async ({
      resolve,
      overrides,
    }: {
      resolve: () => Promise<Tea.WorkspaceSources>;
      overrides: Tea.ParameterOverrides;
    }) => ({ source: await resolve(), overrides }),
    onSuccess: (picked) => setSource(picked),
  });
  const place = useMutation({
    meta: { errorTitle: "Couldn’t add indicator" },
    retry: false,
    mutationFn: async ({
      source,
      failure,
      overrides,
    }: {
      source: Tea.WorkspaceSources;
      failure?: Error;
      overrides: Tea.ParameterOverrides;
    }) => {
      if (failure) throw failure;
      // The chart save reports its own failure; the choice stays for a retry.
      await commit(source, overrides).catch(() => {});
    },
  });
  return {
    add: (
      resolve: () => Promise<Tea.WorkspaceSources>,
      overrides: Tea.ParameterOverrides = {},
    ) => pick.mutate({ resolve, overrides }),
    pending: pick.isPending || source !== undefined || place.isPending,
    error: pick.error ?? place.error,
    reset: () => {
      pick.reset();
      place.reset();
    },
    flow: source ? (
      <AddIndicatorFlow
        source={source.source}
        overrides={source.overrides}
        onDecided={(failure) => {
          setSource(undefined);
          place.mutate({ ...source, failure });
        }}
        onSave={(overrides) => commit(source.source, overrides)}
        onClose={() => setSource(undefined)}
      />
    ) : null,
  };
}

/** A compiled script's next step: add it as is, ask for required inputs, or fail on outputs the chart cannot show. */
function nextStep(
  compiled: Pick<Tea.CompileResponse, "definition" | "declaration">,
  overrides: Tea.ParameterOverrides,
): "add" | "inputs" | Error {
  try {
    Tea.indicatorOutputs(compiled);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  try {
    Tea.teaParameters(compiled.definition, overrides);
    return "add";
  } catch {
    return "inputs";
  }
}

/**
 * One pick: once its current content compiles, asks for required inputs, or hands
 * `onDecided` a failure or nothing to add as is. It decides once: later file
 * changes or failed re-reads neither end the add nor rebuild the open dialog,
 * which keeps the first definition; the server snapshots the file at Save.
 */
function AddIndicatorFlow({
  source,
  overrides,
  onDecided,
  onSave,
  onClose,
}: {
  source: Tea.WorkspaceSources;
  overrides: Tea.ParameterOverrides;
  onDecided: (failure?: Error) => void;
  onSave: (overrides: Tea.ParameterOverrides) => Promise<void>;
  onClose: () => void;
}) {
  const { compiled, error, pending } = useTeaDefinition(source);
  const [inputs, setInputs] =
    useState<Pick<Tea.CompileResponse, "definition" | "declaration">>();
  // A ref, not state: the owner (or Strict Mode) can re-run this before its unmount lands.
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || pending) return;
    decided.current = true;
    const step = error ?? nextStep(compiled!, overrides);
    if (step === "inputs") setInputs(compiled);
    else onDecided(step === "add" ? undefined : step);
  }, [pending, error, compiled, overrides, onDecided]);
  return inputs ? (
    <IndicatorInputsDialog
      compiled={inputs}
      overrides={overrides}
      onSave={onSave}
      onClose={onClose}
    />
  ) : null;
}

/**
 * A Workspace tab's chart action: Reload on chart when the chart already runs this
 * file, else Add to chart in the target cell. Both save unsaved edits first. Sized
 * (`size-8`) to match the Workspace tab bar's other controls.
 * @example <AddToChartAction transport={transport} chartId={chartId} file={file} prepare={prepare} />
 */
export function AddToChartAction({
  transport,
  chartId,
  cellId,
  file,
  prepare,
}: {
  transport: AppTransport;
  chartId: string;
  cellId?: string;
  file: Tea.WorkspaceSources;
  prepare: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const indicators = useQuery(indicatorList(transport, chartId));
  const adder = useAddIndicator({ transport, chartId, cellId });
  const reload = useMutation({
    meta: { errorTitle: "Couldn’t reload on chart" },
    retry: false,
    mutationFn: async (running: IndicatorResource[]) => {
      await prepare();
      return Promise.all(
        running.map((indicator) =>
          transport.rpc.resources.indicator.reload.mutate({
            id: indicator.id,
            expectedRevision: indicator.revision,
          }),
        ),
      );
    },
    // Reload keeps the revision when the file matches the snapshot.
    onSuccess: (reloaded, running) =>
      toast.success(
        reloaded.some(
          (indicator, index) => indicator.revision !== running[index]!.revision,
        )
          ? "Reloaded on chart"
          : "The chart already runs this file",
      ),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: indicatorList(transport, chartId).queryKey,
      }),
  });
  const running =
    indicators.data?.filter(
      (indicator) =>
        indicator.source.workspaceId === file.workspaceId &&
        indicator.source.path === file.path,
    ) ?? [];
  // An add settles before its list refetch lands; waiting on it keeps a second click from adding a copy.
  const busy =
    indicators.isPending ||
    indicators.isFetching ||
    adder.pending ||
    reload.isPending;
  return (
    <>
      {running.length ? (
        <TooltipIconButton
          className="size-8"
          tooltip="Reload on chart"
          disabled={busy}
          onClick={() => reload.mutate(running)}
        >
          <RotateCw />
        </TooltipIconButton>
      ) : (
        <TooltipIconButton
          className="size-8"
          tooltip="Add to chart"
          disabled={busy}
          onClick={() =>
            adder.add(async () => {
              await prepare();
              return file;
            })
          }
        >
          <ChartLine />
        </TooltipIconButton>
      )}
      {adder.flow}
    </>
  );
}
