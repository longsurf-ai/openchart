// Purpose: Publish OpenChart Datasets after the enabled account passes OpenChart admission.
import { Context, Effect, Layer, Stream } from "effect";
import {
  openchartBars,
  openchartCalendar,
  openchartSymbology,
} from "@openchart/server/data/providers/openchart/datasets/definitions";
import { OpenChartClient } from "./client";
import { configuredDatasets } from "@openchart/server/data/providers/configured";
import { makeDataset } from "@openchart/server/data/dataset/dataset";
import type { DatasetFailure } from "@openchart/server/data/dataset";
import type { AccessCheckedDatasetProvider } from "@openchart/server/data/provider";
import { config } from "./config";
import { feeds } from "@openchart/server/data/providers/openchart/feed/feed";
import { makeAccessCheck } from "./access";
import {
  cachedSelectBars,
  streamBars,
} from "@openchart/server/data/providers/openchart/datasets/bars";
import { searchSymbols } from "@openchart/server/data/providers/openchart/datasets/symbology";
import { cachedSelectCalendar } from "@openchart/server/data/providers/openchart/datasets/calendar";
/** OpenChart credentials remain owned by Access. @example OpenChartProvider.layer; */
export class OpenChartProvider extends Context.Service<
  OpenChartProvider,
  AccessCheckedDatasetProvider
>()("data/providers/OpenChart") {
  /** Source-owned Feed bindings; construction acquires no resources. */
  static readonly feeds = feeds;

  /** Reuses the shared account transport; reset re-evaluates readiness. @example OpenChartProvider.layer.pipe(Layer.provide(openchartLayer)); */
  static readonly layer = Layer.effect(
    OpenChartProvider,
    Effect.gen(function* () {
      const client = yield* OpenChartClient;
      const checkAccess = yield* makeAccessCheck;
      const configured = yield* configuredDatasets(
        config,
        Effect.fn("OpenChartProvider.acquire")(function* (retired) {
          const history = yield* cachedSelectBars(client);
          const bars = yield* makeDataset(openchartBars, {
            select: history.select,
            stream: (query) =>
              streamBars(client, query, retired).pipe(
                Effect.map(invalidateHistoryOnResync(history.invalidate)),
              ),
          });
          const symbols = yield* makeDataset(openchartSymbology, {
            search: (query) => searchSymbols(client, query),
          });
          const calendar = yield* makeDataset(openchartCalendar, {
            select: yield* cachedSelectCalendar(client),
          });
          return [bars, symbols, calendar];
        }),
        checkAccess,
      );
      return {
        definitions: [openchartBars, openchartSymbology, openchartCalendar],
        watch: () => client.changes.pipe(Stream.switchMap(() => configured)),
        checkAccess,
        refresh: () => client.reset(),
      };
    }),
  );
}

function invalidateHistoryOnResync(invalidate: Effect.Effect<void>) {
  return Stream.tapError((error: DatasetFailure) =>
    error.reason._tag === "Dataset.StreamInterrupted" &&
    error.reason.kind === "resync"
      ? invalidate
      : Effect.void,
  );
}
