// Purpose: Capture and validate a Tea program before appending an independent Formula column.
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
  resolveWatchlist,
  saveColumns,
  validateFormula,
} from "./formula";

/** Complete choices for a new Formula column; source is captured during this operation. */
export const AddFormulaColumnInput = Schema.Struct({
  id: WatchlistId,
  expectedRevision: Revision,
  title: Schema.optionalKey(WatchlistColumnTitle),
  source: WatchlistFormulaMetric.fields.source,
  parameterOverrides: WatchlistFormulaMetric.fields.parameterOverrides,
  output: WatchlistFormulaMetric.fields.output,
  bars: WatchlistFormulaMetric.fields.bars,
});

/**
 * Compiles the source and all imports outside the write transaction, validates
 * parameters/output, then appends a visible Formula column with a new ID.
 * Returns the complete Watchlist. Invalid code/configuration or a revision
 * conflict saves nothing; the temporary compiled node is always released.
 * @example yield* Transactor.run(watchlistResource.transitions.addFormulaColumn(input));
 */
export const addFormulaColumn = Transition.make({
  input: AddFormulaColumnInput,
  resolve: (input) =>
    Effect.gen(function* () {
      yield* resolveWatchlist(input);
      const snapshot = yield* validateFormula(
        { ...input.source, includeSources: true },
        input,
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
      return yield* saveColumns(tx, current, [
        ...current.columns,
        {
          id: WatchlistColumnId.create(),
          visible: true,
          ...(input.title === undefined ? {} : { title: input.title }),
          metric: {
            kind: "formula",
            source: input.source,
            snapshot,
            parameterOverrides: input.parameterOverrides,
            output: input.output,
            bars: input.bars,
          },
        },
      ]);
    }),
});
