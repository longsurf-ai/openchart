// Purpose: Effect Dataset methods and requirements derive from the concrete declaration.
import { Effect, Stream, type Scope } from "effect";
import { echo, bars } from "@openchart/server/data/dataset/tests/fixtures";
import {
  type DatasetError,
  type SelectResult,
  type StreamResult,
} from "@openchart/server/data/dataset";
import { calendar } from "@openchart/server/data/providers/local";
import { makeDataset, type Dataset } from "./dataset";

declare const dataset: Dataset<typeof bars>;
declare const located: DatasetError;
function contracts() {
  // @ts-expect-error a declaration alone is not a ready, scoped Dataset
  const unready: Dataset = { definition: bars };
  void unready;
  const selected: Effect.Effect<
    SelectResult<typeof bars>,
    DatasetError
  > = dataset.select({ symbol: "A", time: { from: 0 }, count: 2 });
  const subscribed: Effect.Effect<
    Stream.Stream<StreamResult<typeof bars>, DatasetError>,
    DatasetError,
    Scope.Scope
  > = dataset.stream({ symbol: "A" });
  void selected;
  void subscribed;
  // @ts-expect-error bars have no search
  dataset.search({ query: "A" });
  // @ts-expect-error select requires its time range
  dataset.select({ symbol: "A" });
  // @ts-expect-error native Effect scope is required before execution
  void Effect.runPromise(subscribed);
  // @ts-expect-error missing declared search and stream
  makeDataset(echo, { select: () => Effect.succeed([]) });
  makeDataset(calendar, {
    select: () => Effect.succeed([]),
    // @ts-expect-error undeclared streaming method
    stream: () => Effect.succeed(Stream.empty),
  });
  makeDataset(calendar, {
    // @ts-expect-error Providers fail with DatasetFailure; makeDataset adds the location
    select: () => Effect.fail(located),
  });
}

void contracts;
