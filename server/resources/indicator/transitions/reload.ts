// Purpose: Re-snapshot an Indicator's Workspace script and imports; unchanged files keep its revision.
import { isDeepStrictEqual } from "node:util";
import { Transactor, Transition } from "@openchart/server/lib/resource";
import {
  checkRevision,
  loadExisting,
  toEntity,
} from "@openchart/server/lib/resource/entity-operations";
import {
  ENVELOPE_FIELD_NAMES,
  Revision,
} from "@openchart/server/lib/resource/envelope";
import {
  IndicatorEntity,
  IndicatorId,
} from "@openchart/server/resources/indicator/entity";
import { indicatorStore } from "@openchart/server/resources/indicator/store";
import * as Tea from "@openchart/server/tea";
import { Effect, Schema, Struct } from "effect";

/**
 * Takes a new snapshot of the Indicator's source file and every import it
 * reaches, outside the transaction, then saves it at the expected revision.
 * A snapshot equal to the stored one writes nothing, so the revision and
 * anything following it stay put. Fails with the Tea compile error when the
 * file is gone or no longer compiles; the stored snapshot is unchanged.
 * @example yield* Transactor.run(Transition.bindInput(reload, {id, expectedRevision}));
 */
export const reload = Transition.make({
  input: Schema.Struct({ id: IndicatorId, expectedRevision: Revision }),
  resolve: ({ id }) =>
    Effect.gen(function* () {
      const current = yield* Transactor.run(
        Transition.from((tx) =>
          loadExisting(indicatorStore, "indicator", tx, id).pipe(
            Effect.flatMap((row) =>
              toEntity("indicator", IndicatorEntity, row),
            ),
          ),
        ),
      );
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const tea = yield* Tea.Service;
          const node = yield* Effect.acquireRelease(
            tea.compile({ ...current.source, includeSources: true }),
            (node) => tea.dispose({ id: node.id }).pipe(Effect.orDie),
          );
          return node.sources!;
        }),
      );
    }),
  apply: (tx, { id, expectedRevision }, snapshot) =>
    Effect.gen(function* () {
      const row = yield* loadExisting(indicatorStore, "indicator", tx, id);
      yield* checkRevision("indicator", row, expectedRevision);
      const current = yield* toEntity("indicator", IndicatorEntity, row);
      if (isDeepStrictEqual(current.snapshot, snapshot)) return current;
      const saved = yield* indicatorStore.save(tx, id, {
        revision: row.revision + 1,
        body: { ...Struct.omit(current, ENVELOPE_FIELD_NAMES), snapshot },
      });
      return yield* toEntity("indicator", IndicatorEntity, saved);
    }),
});
