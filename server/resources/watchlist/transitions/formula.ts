// Purpose: Share Formula snapshot validation and revision-safe column writes among watchlist transitions.
import { isDeepStrictEqual } from "node:util";
import { Effect, Schema, Struct } from "effect";
import {
  ResourceNotFound,
  ResourceStateInvalid,
  Transactor,
  Transition,
} from "@openchart/server/lib/resource";
import { STRICT_PARSE_OPTIONS } from "@openchart/server/lib/resource/definition";
import {
  checkRevision,
  loadExisting,
  toEntity,
} from "@openchart/server/lib/resource/entity-operations";
import { ENVELOPE_FIELD_NAMES } from "@openchart/server/lib/resource/envelope";
import { resourceIssues } from "@openchart/server/lib/resource/invariant";
import type { Tx } from "@openchart/server/lib/resource/store";
import * as Tea from "@openchart/server/tea";
import type { WatchlistColumn, WatchlistFormulaMetric } from "../column";
import { WatchlistEntity } from "../entity";
import { watchlistStore } from "../store";

/** Load and check a watchlist in the caller's transaction; never opens external I/O. */
export const currentWatchlist = Effect.fn("Watchlist.current")(function* (
  tx: Tx,
  input: { id: string; expectedRevision: number },
) {
  const row = yield* loadExisting(watchlistStore, "watchlist", tx, input.id);
  yield* checkRevision("watchlist", row, input.expectedRevision);
  return yield* toEntity("watchlist", WatchlistEntity, row);
});

/** Read the expected state before compiling outside the final write transaction. */
export const resolveWatchlist = (input: {
  id: string;
  expectedRevision: number;
}) => Transactor.run(Transition.from((tx) => currentWatchlist(tx, input)));

/** Find one Formula configuration; missing columns and built-in columns fail without writes. */
export const formulaColumn = Effect.fn("Watchlist.formulaColumn")(function* (
  watchlist: WatchlistEntity,
  columnId: string,
) {
  const column = watchlist.columns.find(({ id }) => id === columnId);
  if (!column)
    return yield* new ResourceNotFound({
      resource: "watchlist_column",
      id: columnId,
    });
  if (column.metric.kind !== "formula")
    return yield* formulaInvalid("This column is not a Formula column.");
  return { ...column, metric: column.metric };
});

function formulaInvalid(message: string) {
  return new ResourceStateInvalid({
    resource: "watchlist",
    reason: message,
    issues: [{ code: "watchlist.invalid_formula", path: "/columns", message }],
  });
}

/**
 * Compile and validate selected output and overrides; release the temporary
 * compiled node on success and failure. Workspace requests capture every import.
 */
export const validateFormula = Effect.fn("Watchlist.validateFormula")(
  function* (
    request: Tea.CompileRequest,
    config: Pick<WatchlistFormulaMetric, "output" | "parameterOverrides">,
  ) {
    const tea = yield* Tea.Service;
    const node = yield* Effect.acquireRelease(
      tea.compile(request),
      (compiled) => tea.dispose({ id: compiled.id }).pipe(Effect.orDie),
    );
    yield* Effect.try({
      try: () => {
        Tea.teaParameters(node.definition, config.parameterOverrides);
        if (
          !Tea.formulaOutputs(node).some(({ name }) => name === config.output)
        )
          throw new Error(
            `Output “${config.output}” is not a scalar numeric or Plot output.`,
          );
      },
      catch: (cause) =>
        formulaInvalid(
          cause instanceof Error
            ? cause.message
            : "Invalid Formula configuration.",
        ),
    });
    return node.sources;
  },
  Effect.scoped,
);

/** Validate and atomically replace columns; equal configurations retain their revision. */
export const saveColumns = Effect.fn("Watchlist.saveColumns")(function* (
  tx: Tx,
  current: WatchlistEntity,
  columns: readonly WatchlistColumn[],
) {
  if (isDeepStrictEqual(current.columns, columns)) return current;
  const candidate = yield* Schema.decodeUnknownEffect(
    WatchlistEntity,
    STRICT_PARSE_OPTIONS,
  )({ ...current, columns }).pipe(
    Effect.mapError(
      (error) =>
        new ResourceStateInvalid({
          resource: "watchlist",
          reason: error.message,
          issues: resourceIssues(error.issue),
        }),
    ),
  );
  const saved = yield* watchlistStore.save(tx, current.id, {
    revision: current.revision + 1,
    body: Struct.omit(candidate, ENVELOPE_FIELD_NAMES),
  });
  return yield* toEntity("watchlist", WatchlistEntity, saved);
});
