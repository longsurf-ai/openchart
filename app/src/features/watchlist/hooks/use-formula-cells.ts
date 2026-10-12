// Purpose: Read the widget's transient formula results without restarting execution from rows.
import { useObservable, useObservableState } from "observable-hooks";
import {
  auditTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from "rxjs";
import {
  useWatchlistPlacement,
  type FormulaValues,
} from "../components/context";

const EMPTY_VALUES: FormulaValues = {};
/** Subscribe to one row's formula cells; the all-row runtime retains offscreen computations. Subscription ends on unmount. @example const cells = useFormulaCells(item.id); */
export function useFormulaCells(itemId: string) {
  const { formulaValues } = useWatchlistPlacement();
  return useObservableState(
    useObservable(
      (inputs$) =>
        inputs$.pipe(
          switchMap(([values, id]) =>
            values.pipe(
              map((all) => all[id]),
              distinctUntilChanged(),
            ),
          ),
        ),
      [formulaValues, itemId],
    ),
  );
}
/** Sample formula sorting at most four times per second; unsorted views ignore values. Subscription ends on unmount. @example useSortFormulaValues(sort !== null) */
export function useSortFormulaValues(enabled: boolean): FormulaValues {
  const { formulaValues } = useWatchlistPlacement();
  return useObservableState(
    useObservable(
      (inputs$) =>
        inputs$.pipe(
          switchMap(([active, values]) =>
            active
              ? values.pipe(auditTime(250), startWith(values.value))
              : of(EMPTY_VALUES),
          ),
        ),
      [enabled, formulaValues],
    ),
    EMPTY_VALUES,
  );
}
