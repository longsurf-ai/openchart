// Purpose: Validate a Formula column's edited choices against its saved snapshot before an atomic update.
import { Effect, Schema } from "effect";
import { Revision, Transition } from "@openchart/server/lib/resource";
import {
  WatchlistColumnId,
  WatchlistColumnTitle,
  WatchlistFormulaMetric,
} from "../column";
import { WatchlistId } from "../entity";
import {
  currentWatchlist,
  formulaColumn,
  resolveWatchlist,
  saveColumns,
  validateFormula,
} from "./formula";

/** Complete replacement settings. Omit title to restore the derived title. */
export const ConfigureFormulaColumnInput = Schema.Struct({
  id: WatchlistId,
  expectedRevision: Revision,
  columnId: WatchlistColumnId,
  title: Schema.optionalKey(WatchlistColumnTitle),
  parameterOverrides: WatchlistFormulaMetric.fields.parameterOverrides,
  output: WatchlistFormulaMetric.fields.output,
  bars: WatchlistFormulaMetric.fields.bars,
});

/**
 * Validates settings against the saved program outside the write transaction.
 * Saves all choices at the expected revision, preserving ID, visibility, source,
 * and snapshot. Omitted title clears it. Returns the complete Watchlist; invalid
 * settings/conflicts leave it unchanged, and temporary compilation is released.
 * @example yield* Transactor.run(watchlistResource.transitions.configureFormulaColumn(input));
 */
export const configureFormulaColumn = Transition.make({
  input: ConfigureFormulaColumnInput,
  resolve: (input) =>
    Effect.gen(function* () {
      const current = yield* resolveWatchlist(input);
      const column = yield* formulaColumn(current, input.columnId);
      yield* validateFormula(
        { entry: column.metric.source.path, sources: column.metric.snapshot },
        input,
      );
    }),
  apply: (tx, input) =>
    Effect.gen(function* () {
      const current = yield* currentWatchlist(tx, input);
      const column = yield* formulaColumn(current, input.columnId);
      const replacement = {
        id: column.id,
        visible: column.visible,
        ...(input.title === undefined ? {} : { title: input.title }),
        metric: {
          ...column.metric,
          parameterOverrides: input.parameterOverrides,
          output: input.output,
          bars: input.bars,
        },
      };
      return yield* saveColumns(
        tx,
        current,
        current.columns.map((item) =>
          item.id === column.id ? replacement : item,
        ),
      );
    }),
});
