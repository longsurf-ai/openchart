// Purpose: Bind every visible Formula column to every saved row through one widget-owned Tea group.
import { barsSeries } from "@openchart/feed";
import * as Tea from "@openchart/tea";
import { replaceEqualDeep } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useObservable, useSubscription } from "observable-hooks";
import { map, switchMap, type BehaviorSubject } from "rxjs";

import { useBarsCapabilitiesMany } from "@openchart/app/hooks/use-bars";
import {
  useTeaGroup,
  type TeaGroupRequest,
  type TeaLatestState,
} from "@openchart/app/hooks/use-tea";
import type { Watchlist } from "../api/queries";
import type { FormulaValue, FormulaValues } from "../components/context";

function allItems(
  sections: Watchlist["sections"],
): Watchlist["sections"][number]["items"] {
  return sections.flatMap((section) => [
    ...section.items,
    ...allItems(section.sections),
  ]);
}

function project(
  state: TeaLatestState | undefined,
  output: string,
): FormulaValue {
  if (!state || state.status === "loading") return { status: "loading" };
  if (state.status === "error")
    return {
      status: "error",
      error: state.error?.message ?? "Formula execution failed.",
    };
  if (!state.compiled)
    return {
      status: "error",
      error: "Formula output metadata is unavailable.",
    };
  const selected = Tea.formulaOutputs(state.compiled).find(
    ({ name }) => name === output,
  );
  if (!selected)
    return {
      status: "error",
      error: `Output “${output}” is unavailable. Open column settings to select an output.`,
    };
  const row = state.data?.get(0);
  let value: unknown = row;
  for (const field of selected.path) {
    value =
      value !== null && typeof value === "object"
        ? (value as Readonly<Record<string, unknown>>)[field]
        : undefined;
  }
  return typeof value === "number" && Number.isFinite(value)
    ? {
        status: "ready",
        value,
        time: state.time,
        identity: state.executionKey && `${state.executionKey}:${output}`,
      }
    : { status: "empty", time: state.time };
}

/**
 * Run a watchlist's visible Formula columns for all saved rows, including
 * collapsed/offscreen sections. Market capabilities resolve omitted settings
 * within the saved interval; unsupported explicit settings fail in the cell.
 * One `useTeaGroup` shares matching executions within this mount, independent
 * of column IDs and selected outputs. Latest values are published only to the
 * supplied widget-local subject; unavailable numbers remain empty and failures
 * carry retry actions. Unmount clears transient values and releases all runs;
 * hiding removes only that column's consumers. No resource writes occur.
 * @example <FormulaRuntime watchlist={watchlist} values={formulaValues} />
 */
export function FormulaRuntime({
  watchlist,
  values,
}: {
  watchlist: Watchlist;
  values: BehaviorSubject<FormulaValues>;
}) {
  const [from] = useState(() => Date.now());
  const columns = useMemo(
    () =>
      watchlist.columns.filter(
        (column) =>
          column.visible !== false && column.metric.kind === "formula",
      ),
    [watchlist.columns],
  );
  const items = useMemo(
    () => (columns.length ? allItems(watchlist.sections) : []),
    [columns.length, watchlist.sections],
  );
  const listings = useMemo(
    () => items.map(({ provider, listing }) => ({ provider, listing })),
    [items],
  );
  const capabilities = useBarsCapabilitiesMany(listings, { silent: true });
  const { requests, cells } = useMemo(() => {
    const requests: TeaGroupRequest[] = [];
    const cells: {
      key: string;
      itemId: string;
      columnId: string;
      output: string;
      unavailable?: FormulaValue;
    }[] = [];
    for (const [index, item] of items.entries()) {
      const capability = capabilities[index];
      for (const column of columns) {
        const formula = column.metric;
        if (formula.kind !== "formula") continue;
        const key = `${item.id}:${column.id}`;
        const cell: (typeof cells)[number] = {
          key,
          itemId: item.id,
          columnId: column.id,
          output: formula.output,
        };
        cells.push(cell);
        const retry = () => {
          void capability?.refetch();
        };
        if (capability?.isError) {
          cell.unavailable = {
            status: "error",
            error: capability.error.message,
            retry,
          };
          continue;
        }
        if (!capability?.data) {
          cell.unavailable = { status: "loading" };
          continue;
        }
        const settings = capability.data.find(
          (option) =>
            option.resolution === formula.bars.resolution &&
            (formula.bars.session === undefined ||
              option.session === formula.bars.session) &&
            (formula.bars.adjustment === undefined ||
              option.adjustment === formula.bars.adjustment),
        );
        if (!settings) {
          cell.unavailable = {
            status: "error",
            error:
              "The selected interval, session and adjustment are unavailable for this symbol.",
            retry,
          };
          continue;
        }
        requests.push({
          key,
          node: {
            source: { entry: formula.source.path, sources: formula.snapshot },
            parameters: formula.parameterOverrides,
            ...Tea.barsInputs(barsSeries(item, settings)),
            requests: {},
            from,
            to: "now",
            countBack: 1,
            warmupBars: Tea.standardWarmupBars,
          },
        });
      }
    }
    return { requests, cells };
  }, [items, columns, capabilities, from]);
  const { states, retry } = useTeaGroup(requests);
  const retries = useRef(new Map<string, () => void>());
  retries.current = new Map(
    cells.map((cell) => [
      cell.key,
      cell.unavailable?.retry ?? (() => retry(cell.key)),
    ]),
  );
  useSubscription(
    useObservable(
      (inputs) =>
        inputs.pipe(
          switchMap(([cells, states]) =>
            states.pipe(map((states) => ({ cells, states }))),
          ),
        ),
      [cells, states],
    ),
    ({ cells, states }) => {
      const next: Record<string, Record<string, FormulaValue>> = {};
      for (const cell of cells) {
        const state =
          cell.unavailable ?? project(states.get(cell.key), cell.output);
        const previous = values.value[cell.itemId]?.[cell.columnId];
        (next[cell.itemId] ??= {})[cell.columnId] =
          state.status === "error"
            ? {
                ...state,
                retry:
                  previous?.retry ?? (() => retries.current.get(cell.key)?.()),
              }
            : state;
      }
      // Preserve unchanged cells and rows for selective row subscriptions.
      const retained = replaceEqualDeep(values.value, next);
      if (retained !== values.value) values.next(retained);
    },
  );
  useEffect(() => () => values.next({}), [values]);
  return null;
}
