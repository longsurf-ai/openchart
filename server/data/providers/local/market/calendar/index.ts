// Purpose: Scoped Effect access to the existing read-only local calendar Dataset.

import { Context, Effect, Layer, Stream } from "effect";
import { DatasetFailure, DatasetReasons } from "@openchart/server/data/dataset";
import { calendar } from "./definition";
import { makeDataset, type IDatasetProvider } from "@openchart/server/data";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { readCalendarData } from "./data";
import { selectDays } from "./schedule";

/** Reads the caller-owned connection once; its schema and contents remain unchanged.
 * @example const dataset = yield* makeCalendarDataset(database);
 */
export const makeCalendarDataset = Effect.fn("makeCalendarDataset")(function* (
  database: NodeSQLiteDatabase,
) {
  const data = yield* Effect.try({
    try: () => readCalendarData(database),
    catch: (cause) =>
      cause instanceof DatasetFailure
        ? cause
        : new DatasetFailure(new DatasetReasons.InvalidResult(), { cause }),
  });
  return yield* makeDataset(calendar, {
    select: (query) =>
      Effect.try({
        try: () => selectDays(data, query),
        catch: (cause) =>
          cause instanceof DatasetFailure
            ? cause
            : new DatasetFailure(new DatasetReasons.InvalidResult(), {
                cause,
              }),
      }),
  });
});

/** Provider activation owns the cached calendar rows, never the caller's database connection. */
export class CalendarProvider extends Context.Service<
  CalendarProvider,
  IDatasetProvider
>()("data/CalendarProvider") {
  /** Construct local calendar access. @example CalendarProvider.layer(database); */
  static layer(database: NodeSQLiteDatabase) {
    return Layer.succeed(CalendarProvider, {
      definitions: [calendar],
      watch: () =>
        Stream.unwrap(
          makeCalendarDataset(database).pipe(
            Effect.map((dataset) =>
              Stream.concat(Stream.succeed([dataset]), Stream.never),
            ),
            Effect.orDie,
          ),
        ),
    });
  }
}
