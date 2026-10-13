// Purpose: Share mounted research cells' answer values with the tree's sort, as live quotes do.
import { useObservable, useObservableState } from "observable-hooks";
import { useEffect } from "react";
import { auditTime, of, startWith, switchMap } from "rxjs";

import {
  useWatchlistPlacement,
  type SemanticValues,
} from "../components/context";

const NO_VALUES: SemanticValues = {};

/** Publish one mounted research cell's value to this placement's sorting cache; a missing value or unmounting removes it. @example usePublishSemanticValue(item.id, column.id, answer?.value ?? undefined); */
export function usePublishSemanticValue(
  itemId: string,
  columnId: string,
  value: string | undefined,
) {
  const { semanticValues } = useWatchlistPlacement();
  useEffect(() => {
    if (value === undefined) return;
    const write = (next: string | undefined) => {
      const row = { ...semanticValues.value[itemId] };
      if (next === undefined) delete row[columnId];
      else row[columnId] = next;
      semanticValues.next({ ...semanticValues.value, [itemId]: row });
    };
    write(value);
    return () => write(undefined);
  }, [semanticValues, itemId, columnId, value]);
}

/** Sample research sorting at most four times per second; unsorted views ignore values. Subscription ends on unmount. @example useSortSemanticValues(sortColumn?.metric.kind === "semantic") */
export function useSortSemanticValues(enabled: boolean): SemanticValues {
  const { semanticValues } = useWatchlistPlacement();
  return useObservableState(
    useObservable(
      (inputs$) =>
        inputs$.pipe(
          switchMap(([active, values]) =>
            active
              ? values.pipe(auditTime(250), startWith(values.value))
              : of(NO_VALUES),
          ),
        ),
      [enabled, semanticValues],
    ),
    NO_VALUES,
  );
}
