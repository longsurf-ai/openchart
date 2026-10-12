// Purpose: Refresh a Formula snapshot only when the saved selection and overrides remain valid.
import { Effect, Schema } from "effect";
import { Revision, Transition } from "@openchart/server/lib/resource";
import { WatchlistColumnId } from "../column";
import { WatchlistId } from "../entity";
import {
  currentWatchlist,
  formulaColumn,
  resolveWatchlist,
  saveColumns,
  validateFormula,
} from "./formula";

/** Identifies one Formula column and the complete watchlist revision being edited. */
export const ReloadFormulaColumnInput = Schema.Struct({
  id: WatchlistId,
  expectedRevision: Revision,
  columnId: WatchlistColumnId,
});

/**
 * Captures source and imports outside the write transaction and validates the
 * existing output/overrides. Returns the complete Watchlist, keeping its revision
 * for identical code. Missing/invalid code, removed output/parameter, or a
 * revision conflict preserves the old snapshot. Temporary compilation is freed.
 * @example yield* Transactor.run(watchlistResource.transitions.reloadFormulaColumn(input));
 */
export const reloadFormulaColumn = Transition.make({
  input: ReloadFormulaColumnInput,
  resolve: (input) =>
    Effect.gen(function* () {
      const current = yield* resolveWatchlist(input);
      const column = yield* formulaColumn(current, input.columnId);
      const snapshot = yield* validateFormula(
        { ...column.metric.source, includeSources: true },
        column.metric,
      );
      if (!snapshot)
        return yield* Effect.die(
          "Workspace compilation did not return its requested sources",
        );
      return snapshot;
    }),
  apply: (tx, input, snapshot) =>
    Effect.gen(function* () {
      const current = yield* currentWatchlist(tx, input);
      const column = yield* formulaColumn(current, input.columnId);
      return yield* saveColumns(
        tx,
        current,
        current.columns.map((item) =>
          item.id === column.id
            ? { ...column, metric: { ...column.metric, snapshot } }
            : item,
        ),
      );
    }),
});
